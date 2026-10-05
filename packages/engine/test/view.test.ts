import { DEFAULT_LIMITS, REQUEST_VERSION, type ViolatedOutcome } from '@invariant-trail/contracts';
import { describe, expect, it } from 'vitest';
import {
  describeState,
  diffViews,
  explainCounterexample,
  getTemplate,
  runExploration,
  type ProtocolState,
} from '../src';

const template = getTemplate('booking-confirmation')!;
const preset = template.presets.find((p) => p.id === 'retry-after-lost-response')!;

function counterexample(): ViolatedOutcome {
  const outcome = runExploration({
    version: REQUEST_VERSION,
    templateId: template.id,
    invariantId: preset.invariantId,
    design: preset.design,
    faults: preset.faults,
    limits: DEFAULT_LIMITS,
  });
  if (outcome.status !== 'violated') throw new Error('expected a violation');
  return outcome;
}

describe('state view', () => {
  it('labels stored data with friendly names and covers every owner of data', () => {
    const cx = counterexample().counterexample;
    const sections = describeState(template, preset.design, cx.initial as unknown as ProtocolState);
    expect(sections.map((s) => s.id)).toEqual(['clients', 'network', 'service', 'store', 'budget']);
    const store = sections.find((s) => s.id === 'store')!;
    expect(store.rows.find((r) => r.id === 'db.booking.status')).toMatchObject({
      label: 'Booking status',
      value: 'pending',
    });
    expect(store.rows.find((r) => r.id === 'db.wasCancelled')?.value).toBe('no');
  });

  it('marks rows that changed in a step and highlights violation evidence', () => {
    const { counterexample: cx } = counterexample();
    const last = cx.steps[cx.steps.length - 1]!;
    const before = describeState(template, preset.design, last.before as unknown as ProtocolState);
    const after = describeState(template, preset.design, last.after as unknown as ProtocolState);
    const diff = diffViews(before, after, cx.violation.paths);
    const store = diff.find((s) => s.id === 'store')!;
    const emails = store.rows.find((r) => r.id === 'db.confirmationsSent')!;
    expect(emails).toMatchObject({ change: 'changed', previous: '1', value: '2', evidence: true });
    const network = diff.find((s) => s.id === 'network')!;
    expect(network.rows.some((r) => r.change === 'removed')).toBe(true);
  });

  it('reports no changes between identical states', () => {
    const { counterexample: cx } = counterexample();
    const view = describeState(template, preset.design, cx.initial as unknown as ProtocolState);
    const diff = diffViews(view, view);
    expect(diff.flatMap((s) => s.rows).every((r) => r.change === 'unchanged')).toBe(true);
  });
});

describe('causal explanation', () => {
  it('lists only the steps that changed the evidence, in order', () => {
    const { counterexample: cx } = counterexample();
    const causes = explainCounterexample(template, preset.design, cx);
    // Emails go 0 -> 1 on step 2 and 1 -> 2 on step 5; the loss and retry steps are not evidence.
    expect(causes.map((c) => c.stepIndex)).toEqual([2, 5]);
    expect(causes[1]!.rows[0]).toMatchObject({
      label: 'Confirmation emails sent',
      previous: '1',
      value: '2',
    });
  });
});
