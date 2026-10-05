import { EMPTY_STATS, type ExplorationOutcome } from '@invariant-trail/contracts';
import { describe, expect, it } from 'vitest';
import { predictionFeedback } from '../components/learn';
import type { RunState } from './workspace-state';

const base = {
  engineVersion: 'x',
  limits: null,
  stats: { ...EMPTY_STATS },
  limitsHit: [] as never[],
};
const done = (outcome: ExplorationOutcome): RunState => ({
  phase: 'done',
  runId: 1,
  outcome,
  request: {} as never,
});

describe('prediction feedback', () => {
  it('judges only conclusive runs', () => {
    const cancelled = done({ ...base, status: 'cancelled', stopReason: 'cancelled' });
    const exhausted = done({ ...base, status: 'exhausted', stopReason: 'state-limit' });
    const invalid = done({
      ...base,
      status: 'invalid',
      stopReason: 'invalid-input',
      issues: ['x'],
    });
    for (const run of [cancelled, exhausted, invalid]) {
      expect(predictionFeedback('hold', run)).toContain('does not settle');
      expect(predictionFeedback('break', run)).toContain('does not settle');
    }
  });

  it('says "within its limits" when limits hid states and never praises a hold as proof', () => {
    const limited = done({
      ...base,
      status: 'bounded-safe',
      stopReason: 'frontier-empty',
      complete: false,
      limitsHit: ['depth'],
    });
    expect(predictionFeedback('hold', limited)).toContain('within its limits');
    const complete = done({
      ...base,
      status: 'bounded-safe',
      stopReason: 'frontier-empty',
      complete: true,
    });
    expect(predictionFeedback('hold', complete)).toContain('in this model');
  });

  it('stays silent without a guess or while not done', () => {
    expect(predictionFeedback(null, { phase: 'idle' })).toBeNull();
    expect(predictionFeedback('unsure', { phase: 'idle' })).toBeNull();
  });
});
