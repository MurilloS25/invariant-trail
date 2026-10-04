import type { ExplorationOutcome, ExplorationStats } from '@invariant-trail/contracts';
import { invalidOutcome, runExplorationAsync } from '@invariant-trail/engine';

function failureText(error: unknown): string {
  return `model error: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300);
}

export interface RunCallbacks {
  onProgress(stats: ExplorationStats): void;
  onDone(outcome: ExplorationOutcome): void;
}

export interface RunHandle {
  /** Asks the run to stop. It still reports a `cancelled` outcome with its counters. */
  cancel(): void;
  /** Drops the run immediately. No further callbacks are made. */
  dispose(): void;
}

/** Starts one exploration. `request` is untrusted and is validated by the engine. */
export type Runner = (request: unknown, callbacks: RunCallbacks) => RunHandle;

export type WorkerRequest = { type: 'start'; request: unknown } | { type: 'cancel' };
export type WorkerResponse =
  { type: 'progress'; stats: ExplorationStats } | { type: 'done'; outcome: ExplorationOutcome };

const CHUNK = 250;

/** Runs the same engine code on the calling thread, yielding between chunks. */
export const inlineRunner: Runner = (request, callbacks) => {
  const signal = { aborted: false };
  let disposed = false;
  void runExplorationAsync(request, {
    signal,
    checkEvery: CHUNK,
    onProgress: (stats) => {
      if (!disposed) callbacks.onProgress(stats);
    },
  }).then(
    (outcome) => {
      if (!disposed) callbacks.onDone(outcome);
    },
    (error: unknown) => {
      if (!disposed) callbacks.onDone(invalidOutcome([failureText(error)]));
    },
  );
  return {
    cancel: () => {
      signal.aborted = true;
    },
    dispose: () => {
      disposed = true;
      signal.aborted = true;
    },
  };
};

/** One module Web Worker per run, so superseding a run is just terminating its worker. */
export const workerRunner: Runner = (request, callbacks) => {
  let worker: Worker;
  try {
    worker = new Worker(new URL('./exploration.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return inlineRunner(request, callbacks);
  }
  let fallback: RunHandle | null = null;
  let finished = false;
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    if (finished) return;
    const message = event.data;
    if (typeof message !== 'object' || message === null) return;
    if (message.type === 'progress') callbacks.onProgress(message.stats);
    else {
      finished = true;
      worker.terminate();
      callbacks.onDone(message.outcome);
    }
  };
  worker.onerror = () => {
    if (finished) return;
    finished = true;
    worker.terminate();
    // The worker could not start (for example, blocked by the environment): run in-page instead.
    fallback = inlineRunner(request, callbacks);
  };
  worker.postMessage({ type: 'start', request } satisfies WorkerRequest);
  return {
    cancel: () => {
      if (fallback) fallback.cancel();
      else if (!finished) worker.postMessage({ type: 'cancel' } satisfies WorkerRequest);
    },
    dispose: () => {
      finished = true;
      worker.terminate();
      fallback?.dispose();
    },
  };
};

export function defaultRunner(): Runner {
  return typeof Worker === 'undefined' ? inlineRunner : workerRunner;
}
