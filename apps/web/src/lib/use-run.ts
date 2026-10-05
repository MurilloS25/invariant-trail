'use client';

import { EMPTY_STATS, type ExplorationRequest } from '@invariant-trail/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ExplorationController } from './controller';
import { defaultRunner, type Runner } from './runner';
import type { RunState } from './workspace-state';

/**
 * One exploration at a time, with stale-result protection from the controller. Used by the guided
 * lessons; the sandbox keeps its own reducer because its settings and result are coupled.
 */
export function useRun(runner?: Runner) {
  const [run, setRun] = useState<RunState>({ phase: 'idle' });
  const controller = useRef<ExplorationController | null>(null);

  useEffect(() => {
    const created = new ExplorationController(runner ?? defaultRunner());
    controller.current = created;
    return () => {
      created.dispose();
      controller.current = null;
    };
  }, [runner]);

  const start = useCallback((request: ExplorationRequest) => {
    const active = controller.current;
    if (!active) return;
    const runId = active.start(request, {
      onProgress: (id, stats) =>
        setRun((current) =>
          current.phase === 'running' && current.runId === id ? { ...current, stats } : current,
        ),
      onDone: (id, outcome) =>
        setRun((current) =>
          current.phase === 'running' && current.runId === id
            ? { phase: 'done', runId: id, outcome, request }
            : current,
        ),
    });
    setRun({ phase: 'running', runId: runId, stats: { ...EMPTY_STATS } });
  }, []);

  const cancel = useCallback(() => controller.current?.cancel(), []);

  const reset = useCallback(() => {
    controller.current?.dispose();
    setRun({ phase: 'idle' });
  }, []);

  return { run, start, cancel, reset };
}
