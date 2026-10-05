import type { ExplorationOutcome, ExplorationStats } from '@invariant-trail/contracts';
import { EMPTY_STATS } from '@invariant-trail/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExplorationController } from './controller';
import { inlineRunner, type RunCallbacks, type RunHandle, type Runner } from './runner';

const outcome = (status: 'bounded-safe' | 'cancelled'): ExplorationOutcome =>
  status === 'cancelled'
    ? {
        status,
        engineVersion: 'test',
        limits: null,
        stats: { ...EMPTY_STATS, statesDiscovered: 7 },
        stopReason: 'cancelled',
        limitsHit: [],
      }
    : {
        status,
        engineVersion: 'test',
        limits: null,
        stats: { ...EMPTY_STATS },
        stopReason: 'frontier-empty',
        limitsHit: [],
        complete: true,
      };

/** A runner whose runs are completed by the test, in any order. */
function manualRunner() {
  const runs: Array<{
    request: unknown;
    callbacks: RunCallbacks;
    cancelled: boolean;
    disposed: boolean;
  }> = [];
  const runner: Runner = (request, callbacks) => {
    const run = { request, callbacks, cancelled: false, disposed: false };
    runs.push(run);
    const handle: RunHandle = {
      cancel: () => {
        run.cancelled = true;
      },
      dispose: () => {
        run.disposed = true;
      },
    };
    return handle;
  };
  return { runner, runs };
}

describe('ExplorationController', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('delivers progress and the result of the current run', () => {
    const { runner, runs } = manualRunner();
    const controller = new ExplorationController(runner);
    const onProgress = vi.fn();
    const onDone = vi.fn();
    const id = controller.start({ n: 1 }, { onProgress, onDone });
    runs[0]!.callbacks.onProgress({ ...EMPTY_STATS, statesDiscovered: 3 });
    runs[0]!.callbacks.onDone(outcome('bounded-safe'));
    expect(onProgress).toHaveBeenCalledWith(id, expect.objectContaining({ statesDiscovered: 3 }));
    expect(onDone).toHaveBeenCalledWith(id, expect.objectContaining({ status: 'bounded-safe' }));
    expect(controller.currentRunId).toBeNull();
  });

  it('drops late progress and results from a superseded run', () => {
    const { runner, runs } = manualRunner();
    const controller = new ExplorationController(runner);
    const first = { onProgress: vi.fn(), onDone: vi.fn() };
    const second = { onProgress: vi.fn(), onDone: vi.fn() };
    const firstId = controller.start({ n: 1 }, first);
    const secondId = controller.start({ n: 2 }, second);
    expect(secondId).toBeGreaterThan(firstId);
    expect(runs[0]!.disposed).toBe(true);

    // The stale run reports after being superseded, and even finishes after the newer run.
    runs[1]!.callbacks.onDone(outcome('bounded-safe'));
    runs[0]!.callbacks.onProgress({ ...EMPTY_STATS, statesDiscovered: 99 });
    runs[0]!.callbacks.onDone(outcome('bounded-safe'));

    expect(first.onProgress).not.toHaveBeenCalled();
    expect(first.onDone).not.toHaveBeenCalled();
    expect(second.onDone).toHaveBeenCalledTimes(1);
  });

  it('requests cancellation and accepts the cancelled outcome from the host', () => {
    const { runner, runs } = manualRunner();
    const controller = new ExplorationController(runner);
    const listener = { onProgress: vi.fn(), onDone: vi.fn() };
    controller.start({}, listener);
    controller.cancel();
    expect(runs[0]!.cancelled).toBe(true);
    runs[0]!.callbacks.onDone(outcome('cancelled'));
    expect(listener.onDone).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({ status: 'cancelled' }),
    );
    vi.advanceTimersByTime(5000);
    expect(listener.onDone).toHaveBeenCalledTimes(1);
  });

  it('stops a host that ignores cancellation and reports the last known counters', () => {
    const { runner, runs } = manualRunner();
    const controller = new ExplorationController(runner, 1000);
    const listener = { onProgress: vi.fn(), onDone: vi.fn() };
    controller.start({ limits: { maxDepth: 5, maxStates: 100, maxBranching: 2 } }, listener);
    const stats: ExplorationStats = { ...EMPTY_STATS, statesDiscovered: 42 };
    runs[0]!.callbacks.onProgress(stats);
    controller.cancel();
    vi.advanceTimersByTime(1000);
    expect(runs[0]!.disposed).toBe(true);
    const [, result] = listener.onDone.mock.calls[0] as [number, ExplorationOutcome];
    expect(result).toMatchObject({ status: 'cancelled', stats: { statesDiscovered: 42 } });
    // A late answer from the dropped host is ignored.
    runs[0]!.callbacks.onDone(outcome('bounded-safe'));
    expect(listener.onDone).toHaveBeenCalledTimes(1);
  });

  it('ignores cancel when nothing is running', () => {
    const { runner } = manualRunner();
    const controller = new ExplorationController(runner);
    expect(() => controller.cancel()).not.toThrow();
  });
});

describe('inline runner with the real engine', () => {
  const request = {
    version: 1,
    templateId: 'booking-confirmation',
    invariantId: 'single-confirmation',
    design: { guard: 'none' },
    faults: {
      duplicate: 1,
      lostResponse: 0,
      delay: false,
      reorder: false,
      concurrent: false,
      crash: 0,
      retry: 0,
      lateRetry: 0,
    },
    limits: { maxDepth: 32, maxStates: 30000, maxBranching: 32 },
  };

  it('finds the known counterexample', async () => {
    vi.useRealTimers();
    const controller = new ExplorationController(inlineRunner);
    const outcome = await new Promise<ExplorationOutcome>((resolve) => {
      controller.start(request, { onProgress: () => undefined, onDone: (_id, o) => resolve(o) });
    });
    expect(outcome.status).toBe('violated');
  });

  it('keeps only the newest result when two runs are started back to back', async () => {
    vi.useRealTimers();
    const controller = new ExplorationController(inlineRunner);
    const seen: Array<{ id: number; status: string }> = [];
    const done = new Promise<void>((resolve) => {
      const listener = {
        onProgress: () => undefined,
        onDone: (id: number, o: ExplorationOutcome) => {
          seen.push({ id, status: o.status });
          resolve();
        },
      };
      controller.start({ ...request, faults: { ...request.faults, duplicate: 0 } }, listener);
      controller.start(request, listener);
    });
    await done;
    await new Promise((r) => setTimeout(r, 50));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ id: 2, status: 'violated' });
  });

  it('cancels a long run for real and reports a cancelled outcome with counters', async () => {
    vi.useRealTimers();
    const controller = new ExplorationController(inlineRunner);
    const stress = {
      ...request,
      design: { guard: 'conditional-write' },
      faults: {
        duplicate: 2,
        lostResponse: 2,
        delay: true,
        reorder: true,
        concurrent: true,
        crash: 1,
        retry: 2,
        lateRetry: 1,
      },
      limits: { maxDepth: 40, maxStates: 100000, maxBranching: 64 },
    };
    const outcome = await new Promise<ExplorationOutcome>((resolve) => {
      controller.start(stress, {
        onProgress: (_id, stats) => {
          if (stats.statesDiscovered > 500) controller.cancel();
        },
        onDone: (_id, o) => resolve(o),
      });
    });
    expect(outcome.status).toBe('cancelled');
    expect(outcome.stats.statesDiscovered).toBeGreaterThan(500);
    expect(outcome.stats.statesDiscovered).toBeLessThan(100000);
  });
});
