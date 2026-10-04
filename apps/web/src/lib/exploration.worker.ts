import { invalidOutcome, runExplorationAsync } from '@invariant-trail/engine';
import type { WorkerRequest, WorkerResponse } from './runner';

interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse): void;
}

const scope = self as unknown as WorkerScope;
const signal = { aborted: false };
let started = false;
let lastProgress = 0;

scope.onmessage = (event) => {
  const message = event.data;
  if (typeof message !== 'object' || message === null) return;
  if (message.type === 'cancel') {
    signal.aborted = true;
    return;
  }
  if (message.type !== 'start' || started) return;
  started = true;
  void runExplorationAsync(message.request, {
    signal,
    checkEvery: 250,
    onProgress: (stats) => {
      const now = performance.now();
      if (now - lastProgress < 80) return;
      lastProgress = now;
      scope.postMessage({ type: 'progress', stats });
    },
  }).then(
    (outcome) => scope.postMessage({ type: 'done', outcome }),
    (error: unknown) =>
      scope.postMessage({
        type: 'done',
        outcome: invalidOutcome([
          `model error: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300),
        ]),
      }),
  );
};
