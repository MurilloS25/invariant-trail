import {
  EMPTY_STATS,
  LIMIT_BOUNDS,
  type ExplorationOutcome,
  type ExplorationStats,
  type Json,
  type LimitKind,
  type Limits,
  type StopReason,
  type TransitionInfo,
  type Violation,
} from '@invariant-trail/contracts';
import { canonicalize } from './canonical';
import { ModelError, toInfo, type Model, type Transition } from './model';
import { buildCounterexample, type VisitedNode } from './trace';
import { ENGINE_VERSION } from './version';

export interface ExploreOptions {
  /** Cooperative cancellation. Checked at least every `checkEvery` expansions. */
  shouldCancel?: () => boolean;
  /** Expansions between cancellation checks and progress reports. */
  checkEvery?: number;
  onProgress?: (stats: ExplorationStats) => void;
}

export interface ExploreAsyncOptions extends Omit<ExploreOptions, 'shouldCancel'> {
  /** Anything with an `aborted` flag, such as an `AbortSignal`. */
  signal?: { readonly aborted: boolean };
  /** Gives the host a chance to process messages and timers. Defaults to a macrotask yield. */
  yieldControl?: () => Promise<void>;
}

const DEFAULT_CHECK_EVERY = 256;

export function validateLimits(limits: Limits): string[] {
  const issues: string[] = [];
  for (const key of ['maxDepth', 'maxStates', 'maxBranching'] as const) {
    const value = limits?.[key];
    const bounds = LIMIT_BOUNDS[key];
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      issues.push(`${key} must be an integer`);
    } else if (value < bounds.min || value > bounds.max) {
      issues.push(`${key} must be between ${bounds.min} and ${bounds.max}`);
    }
  }
  return issues;
}

export function invalidOutcome(issues: string[], limits: Limits | null = null): ExplorationOutcome {
  return {
    status: 'invalid',
    engineVersion: ENGINE_VERSION,
    limits,
    stats: { ...EMPTY_STATS },
    stopReason: 'invalid-input',
    limitsHit: [],
    issues,
  };
}

/**
 * Resumable breadth-first explorer. `run(budget)` processes at most `budget` expansions so that
 * the sync and async drivers share exactly one code path and therefore produce identical results.
 */
export class Explorer<S extends Json> {
  private readonly visited = new Map<string, VisitedNode<S>>();
  private queue: string[] = [];
  private head = 0;
  private readonly stats: ExplorationStats = { ...EMPTY_STATS };
  private readonly limitsHit = new Set<LimitKind>();
  private result: ExplorationOutcome | null = null;

  constructor(
    private readonly model: Model<S>,
    private readonly limits: Limits,
  ) {
    try {
      const key = canonicalize(model.initial);
      this.visited.set(key, { state: model.initial, parent: null, via: null, depth: 0 });
      this.stats.statesDiscovered = 1;
      const violation = model.invariant(model.initial);
      if (violation) this.result = this.violated(key, violation);
      else this.queue.push(key);
    } catch (error) {
      this.result = invalidOutcome([describeError(error)], limits);
    }
  }

  get done(): boolean {
    return this.result !== null;
  }

  snapshot(): ExplorationStats {
    return { ...this.stats, statesDiscovered: this.visited.size };
  }

  /** Processes up to `budget` expansions. Returns the outcome once finished, otherwise null. */
  run(budget: number): ExplorationOutcome | null {
    if (this.result) return this.result;
    try {
      let spent = 0;
      while (spent < budget && this.head < this.queue.length) {
        spent++;
        const finished = this.expand(this.queue[this.head++] as string);
        if (finished) return this.result;
      }
      if (this.head >= this.queue.length) {
        this.result = this.finish('bounded-safe', 'frontier-empty');
      }
    } catch (error) {
      this.result = invalidOutcome([describeError(error)], this.limits);
    }
    return this.result;
  }

  cancel(): ExplorationOutcome {
    if (!this.result) this.result = this.finish('cancelled', 'cancelled');
    return this.result;
  }

  private expand(key: string): boolean {
    const node = this.visited.get(key) as VisitedNode<S>;
    const successors = this.model.successors(node.state);
    assertUniqueIds(successors);
    this.stats.transitionsGenerated += successors.length;

    if (node.depth >= this.limits.maxDepth) {
      // Successors are generated once so the summary can tell whether the cutoff hid anything new.
      if (successors.some((t) => !this.visited.has(canonicalize(t.next)))) {
        this.stats.depthCutoffStates++;
        this.limitsHit.add('depth');
      }
      return false;
    }

    this.stats.statesExpanded++;
    let considered = successors;
    if (successors.length > this.limits.maxBranching) {
      considered = successors.slice(0, this.limits.maxBranching);
      this.stats.branchTruncations++;
      this.limitsHit.add('branching');
    }

    for (const transition of considered) {
      const nextKey = canonicalize(transition.next);
      if (this.visited.has(nextKey)) {
        this.stats.duplicatesSkipped++;
        continue;
      }
      if (this.visited.size >= this.limits.maxStates) {
        this.result = this.finish('exhausted', 'state-limit');
        return true;
      }
      const depth = node.depth + 1;
      this.visited.set(nextKey, {
        state: transition.next,
        parent: key,
        via: toInfo(transition) as TransitionInfo,
        depth,
      });
      if (depth > this.stats.maxDepthReached) this.stats.maxDepthReached = depth;
      const violation = this.model.invariant(transition.next);
      if (violation) {
        this.result = this.violated(nextKey, violation);
        return true;
      }
      this.queue.push(nextKey);
    }
    // Release processed prefix of the queue periodically to bound memory.
    if (this.head > 4096 && this.head * 2 > this.queue.length) {
      this.queue = this.queue.slice(this.head);
      this.head = 0;
    }
    return false;
  }

  private violated(key: string, violation: Violation): ExplorationOutcome {
    const stats = this.snapshot();
    return {
      status: 'violated',
      engineVersion: ENGINE_VERSION,
      limits: this.limits,
      stats,
      stopReason: 'violation-found',
      limitsHit: [...this.limitsHit].sort(),
      // Only branching truncation can hide a shorter path: depth cutoffs happen at maxDepth,
      // which is never shallower than a violation that was just discovered.
      minimalInModel: stats.branchTruncations === 0,
      counterexample: buildCounterexample(this.visited, key, this.model.invariantId, violation),
    };
  }

  private finish(
    status: 'bounded-safe' | 'exhausted' | 'cancelled',
    stopReason: StopReason,
  ): ExplorationOutcome {
    const base = {
      engineVersion: ENGINE_VERSION,
      limits: this.limits,
      stats: this.snapshot(),
      stopReason,
      limitsHit: [...this.limitsHit].sort(),
    };
    if (status === 'bounded-safe') {
      return { ...base, status, complete: this.limitsHit.size === 0 };
    }
    return { ...base, status };
  }
}

function assertUniqueIds(successors: Transition[]): void {
  const seen = new Set<string>();
  for (const transition of successors) {
    if (seen.has(transition.id)) {
      throw new ModelError(`duplicate transition id: ${transition.id}`);
    }
    seen.add(transition.id);
  }
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `model error: ${message}`.slice(0, 300);
}

/** Synchronous exploration. Deterministic: identical inputs give identical outcomes. */
export function explore<S extends Json>(
  model: Model<S>,
  limits: Limits,
  options: ExploreOptions = {},
): ExplorationOutcome {
  const issues = validateLimits(limits);
  if (issues.length > 0) return invalidOutcome(issues);
  const chunk = Math.max(1, options.checkEvery ?? DEFAULT_CHECK_EVERY);
  const explorer = new Explorer(model, limits);
  for (;;) {
    if (options.shouldCancel?.()) return explorer.cancel();
    const outcome = explorer.run(chunk);
    if (outcome) return outcome;
    options.onProgress?.(explorer.snapshot());
  }
}

function defaultYield(): Promise<void> {
  const host = globalThis as unknown as { setTimeout?: (cb: () => void, ms: number) => unknown };
  return new Promise((resolve) => {
    if (host.setTimeout) host.setTimeout(resolve, 0);
    else resolve();
  });
}

/**
 * Chunked exploration that yields control between chunks, so a host (a Web Worker or a test) can
 * deliver a cancellation signal. Produces the same outcome as `explore` when not cancelled.
 */
export async function exploreAsync<S extends Json>(
  model: Model<S>,
  limits: Limits,
  options: ExploreAsyncOptions = {},
): Promise<ExplorationOutcome> {
  const issues = validateLimits(limits);
  if (issues.length > 0) return invalidOutcome(issues);
  const chunk = Math.max(1, options.checkEvery ?? DEFAULT_CHECK_EVERY);
  const yieldControl = options.yieldControl ?? defaultYield;
  const explorer = new Explorer(model, limits);
  for (;;) {
    if (options.signal?.aborted) return explorer.cancel();
    const outcome = explorer.run(chunk);
    if (outcome) return outcome;
    options.onProgress?.(explorer.snapshot());
    await yieldControl();
  }
}

/** Outcome for a run that was stopped from outside the engine, for example by a host timeout. */
export function cancelledOutcome(
  stats: ExplorationStats,
  limits: Limits | null,
): ExplorationOutcome {
  return {
    status: 'cancelled',
    engineVersion: ENGINE_VERSION,
    limits,
    stats: { ...stats },
    stopReason: 'cancelled',
    limitsHit: [],
  };
}
