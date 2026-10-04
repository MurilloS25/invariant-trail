import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Limits } from '@invariant-trail/contracts';
import { explore, exploreAsync, replayTrace, type Model } from '../src';
import { chain, graphModel, referenceDistance, ROOMY, type Graph } from './helpers';

describe('breadth-first exploration', () => {
  it('returns the shortest counterexample even when a longer branch is listed first', () => {
    const graph: Graph = {
      edges: { 0: [1, 4], 1: [2], 2: [3], 3: [5], 4: [5] },
      bad: [5],
    };
    const outcome = explore(graphModel(graph), ROOMY);
    expect(outcome.status).toBe('violated');
    if (outcome.status !== 'violated') return;
    expect(outcome.counterexample.steps.map((s) => s.transition.id)).toEqual(['0->4#1', '4->5#0']);
    expect(outcome.minimalInModel).toBe(true);
    expect(outcome.stopReason).toBe('violation-found');
  });

  it('breaks ties between equally short paths by stable successor order', () => {
    const graph: Graph = { edges: { 0: [1, 2], 1: [3], 2: [3] }, bad: [3] };
    const outcome = explore(graphModel(graph), ROOMY);
    if (outcome.status !== 'violated') throw new Error('expected violation');
    expect(outcome.counterexample.steps.map((s) => s.transition.id)).toEqual(['0->1#0', '1->3#0']);
  });

  it('checks the initial state before expanding anything', () => {
    const outcome = explore(graphModel({ edges: { 0: [1] }, bad: [0] }), ROOMY);
    if (outcome.status !== 'violated') throw new Error('expected violation');
    expect(outcome.counterexample.steps).toHaveLength(0);
    expect(outcome.stats.statesExpanded).toBe(0);
    expect(outcome.stats.transitionsGenerated).toBe(0);
  });

  it('reports bounded-safe and complete when the whole space is enumerated', () => {
    const outcome = explore(graphModel(chain(5, null)), ROOMY);
    expect(outcome).toMatchObject({ status: 'bounded-safe', complete: true, limitsHit: [] });
    expect(outcome.stats.statesDiscovered).toBe(6);
  });

  it('deduplicates equivalent states reached along different paths', () => {
    // 6x6 grid: right and down moves. 36 states but 71 edges.
    const edges: Record<number, number[]> = {};
    for (let r = 0; r < 6; r++)
      for (let c = 0; c < 6; c++) {
        const to: number[] = [];
        if (c < 5) to.push(r * 6 + c + 1);
        if (r < 5) to.push((r + 1) * 6 + c);
        edges[r * 6 + c] = to;
      }
    const outcome = explore(graphModel({ edges, bad: [] }), ROOMY);
    expect(outcome.stats.statesDiscovered).toBe(36);
    expect(outcome.stats.duplicatesSkipped).toBe(60 - 35);
  });

  it('never merges distinct states, however many there are', () => {
    const edges: Record<number, number[]> = { 0: Array.from({ length: 50 }, (_, i) => i + 1) };
    for (let i = 1; i <= 50; i++) edges[i] = Array.from({ length: 50 }, (_, j) => 100 * i + j);
    const outcome = explore(graphModel({ edges, bad: [] }), { ...ROOMY, maxBranching: 64 });
    expect(outcome.stats.statesDiscovered).toBe(1 + 50 + 2500);
  });
});

describe('limits', () => {
  it('finds a violation exactly at maxDepth because that state is checked, not expanded', () => {
    const outcome = explore(graphModel(chain(10, 10)), { ...ROOMY, maxDepth: 10 });
    expect(outcome.status).toBe('violated');
  });

  it('cuts at maxDepth, reports the hidden depth and never claims completeness', () => {
    const outcome = explore(graphModel(chain(10, 10)), { ...ROOMY, maxDepth: 9 });
    expect(outcome).toMatchObject({
      status: 'bounded-safe',
      complete: false,
      limitsHit: ['depth'],
    });
    expect(outcome.stats.maxDepthReached).toBe(9);
    expect(outcome.stats.depthCutoffStates).toBe(1);
  });

  it('does not report a depth cut when nothing new lies beyond maxDepth', () => {
    const outcome = explore(graphModel(chain(4, null)), { ...ROOMY, maxDepth: 4 });
    expect(outcome).toMatchObject({ status: 'bounded-safe', complete: true, limitsHit: [] });
  });

  it('stops with exhausted when the state budget runs out, distinct from bounded-safe', () => {
    const edges: Record<number, number[]> = { 0: [1, 2, 3] };
    for (let i = 1; i <= 3; i++) edges[i] = [10 * i, 10 * i + 1, 10 * i + 2];
    const limits: Limits = { maxDepth: 10, maxStates: 100, maxBranching: 8 };
    const wide: Record<number, number[]> = {};
    for (let i = 0; i < 200; i++) wide[i] = [2 * i + 1, 2 * i + 2];
    const outcome = explore(graphModel({ edges: wide, bad: [] }), limits);
    expect(outcome.status).toBe('exhausted');
    expect(outcome.stopReason).toBe('state-limit');
    expect(outcome.stats.statesDiscovered).toBe(100);
    expect(edges).toBeDefined();
  });

  it('truncates successors beyond maxBranching in stable order and says so', () => {
    const graph: Graph = { edges: { 0: [1, 2, 3, 4, 5] }, bad: [5] };
    const hidden = explore(graphModel(graph), { ...ROOMY, maxBranching: 2 });
    expect(hidden).toMatchObject({
      status: 'bounded-safe',
      complete: false,
      limitsHit: ['branching'],
    });
    expect(hidden.stats.branchTruncations).toBe(1);
    const found = explore(graphModel(graph), { ...ROOMY, maxBranching: 5 });
    expect(found.status).toBe('violated');
    const kept = explore(graphModel({ edges: { 0: [1, 2, 3] }, bad: [2] }), {
      ...ROOMY,
      maxBranching: 2,
    });
    expect(kept.status).toBe('violated');
    if (kept.status === 'violated') expect(kept.minimalInModel).toBe(false);
  });
});

describe('invalid input', () => {
  it('rejects out-of-range and non-integer limits without exploring', () => {
    for (const bad of [
      { ...ROOMY, maxDepth: 0 },
      { ...ROOMY, maxDepth: 41 },
      { ...ROOMY, maxStates: 99 },
      { ...ROOMY, maxStates: 100_001 },
      { ...ROOMY, maxBranching: 0 },
      { ...ROOMY, maxBranching: 1.5 },
      { ...ROOMY, maxDepth: Number.NaN },
    ]) {
      const outcome = explore(graphModel(chain(2, 2)), bad);
      expect(outcome.status).toBe('invalid');
      expect(outcome.stats.statesDiscovered).toBe(0);
    }
  });

  it('turns model defects into invalid outcomes instead of throwing', () => {
    const duplicateIds: Model<{ n: number }> = {
      ...graphModel(chain(3, null)),
      successors: (s) => [
        { id: 'x', kind: 'action', actor: 'a', label: 'l', detail: 'd', next: { n: s.n + 1 } },
        { id: 'x', kind: 'action', actor: 'a', label: 'l', detail: 'd', next: { n: s.n + 2 } },
      ],
    };
    expect(explore(duplicateIds, ROOMY)).toMatchObject({ status: 'invalid' });

    const nonJson = { ...graphModel(chain(1, null)), initial: { n: Number.NaN } };
    expect(explore(nonJson, ROOMY)).toMatchObject({ status: 'invalid' });

    const throwing: Model<{ n: number }> = {
      ...graphModel(chain(1, null)),
      successors: () => {
        throw new Error('boom');
      },
    };
    const outcome = explore(throwing, ROOMY);
    expect(outcome.status).toBe('invalid');
    if (outcome.status === 'invalid') expect(outcome.issues[0]).toContain('boom');
  });
});

describe('cancellation and async driver', () => {
  const big: Graph = (() => {
    const edges: Record<number, number[]> = {};
    for (let i = 0; i < 5000; i++) edges[i] = [2 * i + 1, 2 * i + 2];
    return { edges, bad: [] };
  })();

  it('cancels cooperatively and reports counters so far, distinct from exhausted', () => {
    let calls = 0;
    const outcome = explore(graphModel(big), ROOMY, {
      checkEvery: 10,
      shouldCancel: () => ++calls > 3,
    });
    expect(outcome.status).toBe('cancelled');
    expect(outcome.stopReason).toBe('cancelled');
    expect(outcome.stats.statesExpanded).toBe(30);
  });

  it('cancels the async driver through an abort flag set between chunks', async () => {
    const signal = { aborted: false };
    let progress = 0;
    const outcome = await exploreAsync(graphModel(big), ROOMY, {
      checkEvery: 25,
      signal,
      yieldControl: async () => {},
      onProgress: () => {
        if (++progress === 2) signal.aborted = true;
      },
    });
    expect(outcome.status).toBe('cancelled');
    expect(outcome.stats.statesExpanded).toBe(50);
  });

  it('produces the same outcome as the sync driver when not cancelled', async () => {
    const graph: Graph = { edges: { 0: [1, 2], 1: [3], 2: [3], 3: [4] }, bad: [4] };
    const sync = explore(graphModel(graph), ROOMY);
    const async_ = await exploreAsync(graphModel(graph), ROOMY, { checkEvery: 1 });
    expect(JSON.stringify(async_)).toBe(JSON.stringify(sync));
  });
});

describe('determinism and replay', () => {
  const graph: Graph = {
    edges: {
      0: [1, 2, 3],
      1: [4, 5],
      2: [5, 6],
      3: [6],
      4: [7],
      5: [7, 8],
      6: [8],
      7: [9],
      8: [9],
    },
    bad: [9],
  };

  it('returns byte-identical outcomes for identical inputs', () => {
    const a = explore(graphModel(graph), ROOMY);
    const b = explore(graphModel(graph), ROOMY);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('replays the found counterexample from the initial state', () => {
    const outcome = explore(graphModel(graph), ROOMY);
    if (outcome.status !== 'violated') throw new Error('expected violation');
    const replay = replayTrace(graphModel(graph), outcome.counterexample);
    expect(replay).toEqual({
      ok: true,
      stepsChecked: outcome.counterexample.steps.length,
      problems: [],
    });
  });

  it('detects tampered traces', () => {
    const outcome = explore(graphModel(graph), ROOMY);
    if (outcome.status !== 'violated') throw new Error('expected violation');
    const cx = structuredClone(outcome.counterexample);
    cx.steps[1]!.after = { n: 99 };
    expect(replayTrace(graphModel(graph), cx).ok).toBe(false);

    const relabelled = structuredClone(outcome.counterexample);
    relabelled.steps[0]!.transition.label = 'something else';
    expect(replayTrace(graphModel(graph), relabelled).ok).toBe(false);

    const wrongId = structuredClone(outcome.counterexample);
    wrongId.steps[0]!.transition.id = 'nope';
    expect(replayTrace(graphModel(graph), wrongId).ok).toBe(false);

    const notViolating = structuredClone(outcome.counterexample);
    notViolating.steps.pop();
    expect(replayTrace(graphModel(graph), notViolating).ok).toBe(false);
  });

  it('annotates steps that changed the evidence and records before/after states', () => {
    const outcome = explore(graphModel(chain(3, 3)), ROOMY);
    if (outcome.status !== 'violated') throw new Error('expected violation');
    const [first] = outcome.counterexample.steps;
    expect(first?.before).toEqual({ n: 0 });
    expect(first?.after).toEqual({ n: 1 });
    expect(first?.changes).toEqual([{ path: 'n', op: 'changed', before: 0, after: 1 }]);
    expect(first?.contributes).toBe(true);
  });
});

describe('minimality (property-based, against an independent reference)', () => {
  const graphArb = fc
    .integer({ min: 2, max: 12 })
    .chain((n) =>
      fc.record({
        edges: fc.array(fc.tuple(fc.nat(n - 1), fc.nat(n - 1)), { maxLength: 40 }),
        bad: fc.array(fc.nat(n - 1), { maxLength: 3 }),
      }),
    )
    .map(({ edges, bad }): Graph => {
      const adjacency: Record<number, number[]> = {};
      for (const [from, to] of edges) (adjacency[from] ??= []).push(to);
      return { edges: adjacency, bad };
    });

  it('BFS length equals the reference shortest distance and the trace is a valid path', () => {
    fc.assert(
      fc.property(graphArb, (graph) => {
        const outcome = explore(graphModel(graph), ROOMY);
        const expected = referenceDistance(graph);
        if (expected === null) {
          expect(outcome.status).toBe('bounded-safe');
          return;
        }
        expect(outcome.status).toBe('violated');
        if (outcome.status !== 'violated') return;
        expect(outcome.counterexample.steps).toHaveLength(expected);
        expect(replayTrace(graphModel(graph), outcome.counterexample).ok).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
});
