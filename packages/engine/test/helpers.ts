import type { Json, Limits, Violation } from '@invariant-trail/contracts';
import type { Model, Transition } from '../src/model';

export const ROOMY: Limits = { maxDepth: 40, maxStates: 100_000, maxBranching: 64 };

export interface Graph {
  edges: Record<number, number[]>;
  bad: number[];
}

/** A model over an explicit graph. State is `{ n }`; transitions keep adjacency order. */
export function graphModel(graph: Graph, start = 0): Model<{ n: number }> {
  return {
    invariantId: 'toy',
    initial: { n: start },
    successors(state): Transition<{ n: number }>[] {
      return (graph.edges[state.n] ?? []).map((to, index) => ({
        id: `${state.n}->${to}#${index}`,
        kind: 'action' as const,
        actor: 'toy',
        label: `go ${to}`,
        detail: `move from ${state.n} to ${to}`,
        next: { n: to },
      }));
    },
    invariant(state): Violation | null {
      return graph.bad.includes(state.n)
        ? { message: `node ${state.n} is bad`, paths: ['n'] }
        : null;
    },
  };
}

export function chain(length: number, badAt: number | null): Graph {
  const edges: Record<number, number[]> = {};
  for (let i = 0; i < length; i++) edges[i] = [i + 1];
  return { edges, bad: badAt === null ? [] : [badAt] };
}

/** Independent reference: shortest distance from `start` to any bad node via plain relaxation. */
export function referenceDistance(graph: Graph, start = 0): number | null {
  const dist = new Map<number, number>([[start, 0]]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [from, d] of [...dist]) {
      for (const to of graph.edges[from] ?? []) {
        if ((dist.get(to) ?? Infinity) > d + 1) {
          dist.set(to, d + 1);
          changed = true;
        }
      }
    }
  }
  const candidates = graph.bad.filter((b) => dist.has(b)).map((b) => dist.get(b) as number);
  return candidates.length ? Math.min(...candidates) : null;
}

export type { Json };
