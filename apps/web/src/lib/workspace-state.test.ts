import { EMPTY_STATS, type ExplorationOutcome } from '@invariant-trail/contracts';
import { getTemplate } from '@invariant-trail/engine';
import { describe, expect, it } from 'vitest';
import { initialState, reducer, toRequest } from './workspace-state';

const done: ExplorationOutcome = {
  status: 'cancelled',
  engineVersion: 'x',
  limits: null,
  stats: { ...EMPTY_STATS },
  stopReason: 'cancelled',
  limitsHit: [],
};

describe('workspace reducer', () => {
  it('starts on the booking retry example with a valid request', () => {
    const state = initialState();
    expect(state.config.templateId).toBe('booking-confirmation');
    expect(toRequest(state.config).version).toBe(1);
  });

  it('only accepts results for the current run', () => {
    let state = reducer(initialState(), { type: 'runStarted', runId: 2 });
    const request = toRequest(state.config);
    const stale = reducer(state, { type: 'runDone', runId: 1, outcome: done, request });
    expect(stale.run.phase).toBe('running');
    state = reducer(state, { type: 'runDone', runId: 2, outcome: done, request });
    expect(state.run.phase).toBe('done');
    expect(reducer(state, { type: 'runDone', runId: 1, outcome: done, request })).toBe(state);
  });

  it('drops the result whenever a setting changes', () => {
    let state = reducer(initialState(), { type: 'runStarted', runId: 1 });
    state = reducer(state, {
      type: 'runDone',
      runId: 1,
      outcome: done,
      request: toRequest(state.config),
    });
    for (const action of [
      { type: 'setFault', fault: 'delay', value: true } as const,
      { type: 'setInvariant', invariantId: 'no-confirm-after-cancel' } as const,
      { type: 'setDesign', option: 'guard', choice: 'none' } as const,
    ]) {
      expect(reducer(state, action).run.phase).toBe('idle');
    }
  });

  it('switching workflow adopts its first preset', () => {
    const state = reducer(initialState(), {
      type: 'selectTemplate',
      templateId: 'webhook-receipt',
    });
    const first = getTemplate('webhook-receipt')!.presets[0]!;
    expect(state.config.invariantId).toBe(first.invariantId);
    expect(reducer(state, { type: 'selectTemplate', templateId: 'nope' })).toBe(state);
  });

  it('ignores progress from other runs', () => {
    const state = reducer(initialState(), { type: 'runStarted', runId: 3 });
    const stats = { ...EMPTY_STATS, statesDiscovered: 9 };
    expect(reducer(state, { type: 'progress', runId: 2, stats })).toBe(state);
  });
});
