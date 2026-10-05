import {
  EMPTY_STATS,
  type ExplorationOutcome,
  type ExplorationStats,
  type Limits,
} from '@invariant-trail/contracts';
import { cancelledOutcome } from '@invariant-trail/engine';
import type { RunHandle, Runner } from './runner';

export interface RunListener {
  onProgress(runId: number, stats: ExplorationStats): void;
  onDone(runId: number, outcome: ExplorationOutcome): void;
}

interface ActiveRun {
  id: number;
  handle: RunHandle;
  listener: RunListener;
  limits: Limits | null;
  stats: ExplorationStats;
  finished: boolean;
  graceTimer: ReturnType<typeof setTimeout> | null;
}

function limitsOf(request: unknown): Limits | null {
  if (typeof request !== 'object' || request === null || !('limits' in request)) return null;
  return (request as { limits: Limits | null }).limits ?? null;
}

/**
 * Owns the lifecycle of explorations. Every run gets an increasing id; callbacks from any run that
 * is not the current one are dropped, so a slow earlier run can never overwrite a newer result.
 */
export class ExplorationController {
  private nextId = 1;
  private active: ActiveRun | null = null;

  constructor(
    private readonly runner: Runner,
    private readonly cancelGraceMs = 1500,
  ) {}

  get currentRunId(): number | null {
    return this.active && !this.active.finished ? this.active.id : null;
  }

  /** Starts a run. Any run still in progress is superseded and dropped. */
  start(request: unknown, listener: RunListener): number {
    this.discardActive();
    const run: ActiveRun = {
      id: this.nextId++,
      handle: { cancel: () => undefined, dispose: () => undefined },
      listener,
      limits: limitsOf(request),
      stats: { ...EMPTY_STATS },
      finished: false,
      graceTimer: null,
    };
    this.active = run;
    const isCurrent = (): boolean => this.active === run && !run.finished;
    run.handle = this.runner(request, {
      onProgress: (stats) => {
        if (!isCurrent()) return;
        run.stats = stats;
        listener.onProgress(run.id, stats);
      },
      onDone: (outcome) => {
        if (!isCurrent()) return;
        this.finish(run);
        listener.onDone(run.id, outcome);
      },
    });
    return run.id;
  }

  /** Requests cancellation of the current run; a host that stays silent is stopped after a grace period. */
  cancel(): void {
    const run = this.active;
    if (!run || run.finished || run.graceTimer) return;
    run.handle.cancel();
    run.graceTimer = setTimeout(() => {
      if (this.active !== run || run.finished) return;
      this.finish(run);
      run.handle.dispose();
      run.listener.onDone(run.id, cancelledOutcome(run.stats, run.limits));
    }, this.cancelGraceMs);
  }

  dispose(): void {
    this.discardActive();
  }

  private finish(run: ActiveRun): void {
    run.finished = true;
    if (run.graceTimer) clearTimeout(run.graceTimer);
    run.graceTimer = null;
  }

  private discardActive(): void {
    const run = this.active;
    if (!run) return;
    this.finish(run);
    run.handle.dispose();
    this.active = null;
  }
}
