import { DEFAULT_LIMITS, REQUEST_VERSION } from '@invariant-trail/contracts';
import { getTemplate, runExploration } from '@invariant-trail/engine';
import { describe, expect, it } from 'vitest';
import { describeOutcome } from './copy';

function run(templateId: string, presetId: string, limits = DEFAULT_LIMITS) {
  const preset = getTemplate(templateId)!.presets.find((p) => p.id === presetId)!;
  return runExploration({
    version: REQUEST_VERSION,
    templateId,
    invariantId: preset.invariantId,
    design: preset.design,
    faults: preset.faults,
    limits,
  });
}

describe('outcome wording never overclaims', () => {
  it('violation', () => {
    const copy = describeOutcome(run('booking-confirmation', 'double-confirmation'));
    expect(copy.tone).toBe('violation');
    expect(copy.headline).toBe('Rule broken in 3 steps');
  });

  it('complete bounded-safe says it is limited to the model and not a proof', () => {
    const copy = describeOutcome(run('inventory-order', 'transaction-safe'));
    expect(copy.tone).toBe('holds');
    const text = copy.paragraphs.join(' ');
    expect(text).toContain('this model');
    expect(text).toContain('not a proof');
    expect(text.toLowerCase()).not.toMatch(/\b(safe|proved|guarantee)/);
  });

  it('limit-hidden bounded-safe is inconclusive and names the limit', () => {
    const copy = describeOutcome(
      run('inventory-order', 'transaction-safe', {
        maxDepth: 5,
        maxStates: 30000,
        maxBranching: 32,
      }),
    );
    expect(copy.tone).toBe('inconclusive');
    expect(copy.headline).toBe('No violation found within these limits');
    expect(copy.paragraphs.join(' ')).toContain('step limit');
  });

  it('exhausted and cancelled conclude nothing', () => {
    const exhausted = describeOutcome(
      run('booking-confirmation', 'everything-at-once', {
        maxDepth: 40,
        maxStates: 300,
        maxBranching: 32,
      }),
    );
    expect(exhausted.headline).toContain('state budget used up');
    expect(exhausted.paragraphs.join(' ')).toContain('concluded nothing');
    const cancelled = describeOutcome({
      status: 'cancelled',
      engineVersion: 'x',
      limits: null,
      stats: { ...run('booking-confirmation', 'double-confirmation').stats },
      stopReason: 'cancelled',
      limitsHit: [],
    });
    expect(cancelled.paragraphs.join(' ')).toContain('Nothing was concluded');
  });

  it('invalid input lists issues', () => {
    const copy = describeOutcome(runExploration({ nonsense: true }));
    expect(copy.tone).toBe('invalid');
    expect(copy.paragraphs.length).toBeGreaterThan(0);
  });
});
