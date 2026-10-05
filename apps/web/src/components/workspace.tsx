'use client';

import { decodeRequest, encodeRequest } from '@invariant-trail/contracts';
import { getTemplate, resolveRequest, type TemplateDef } from '@invariant-trail/engine';
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { ExplorationController } from '../lib/controller';
import { defaultRunner, type Runner } from '../lib/runner';
import {
  defaultConfig,
  initialState,
  reducer,
  toRequest,
  type Config,
} from '../lib/workspace-state';
import { LifecycleDiagram } from './diagram';
import { ReplayPanel } from './replay-panel';
import { ResultPanel } from './result-panel';
import { SetupPanel } from './setup-panel';

interface Props {
  /** Test seam: replaces the worker-based runner. */
  runner?: Runner;
  /** Test seam: skip reading and writing the address bar. */
  syncUrl?: boolean;
  /** False while another mode is showing: the address bar then belongs to that mode. */
  active?: boolean;
}

function readConfigFromUrl(): { config: Config; notice: string | null } | null {
  const search = window.location.search;
  if (search.length <= 1) return null;
  const defaults = defaultConfig();
  const parsed = decodeRequest(search, { faults: defaults.faults, limits: defaults.limits });
  if (!parsed.ok) {
    return {
      config: defaults,
      notice: `The settings in this link were not valid and were ignored (${parsed.issues[0] ?? 'unknown problem'}).`,
    };
  }
  const resolved = resolveRequest(parsed.value);
  if (!resolved.ok) {
    return {
      config: defaults,
      notice: `The settings in this link were not valid and were ignored (${resolved.issues[0] ?? 'unknown problem'}).`,
    };
  }
  const { templateId, invariantId, faults, limits } = parsed.value;
  return {
    config: { templateId, invariantId, design: resolved.value.design, faults, limits },
    notice: null,
  };
}

export function Workspace({ runner, syncUrl = true, active = true }: Props) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const controllerRef = useRef<ExplorationController | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const wasRunning = useRef(false);
  const { config, run } = state;

  useEffect(() => {
    const controller = new ExplorationController(runner ?? defaultRunner());
    controllerRef.current = controller;
    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, [runner]);

  const urlLoaded = useRef(false);
  useEffect(() => {
    if (!syncUrl || urlLoaded.current) return;
    urlLoaded.current = true;
    const loaded = readConfigFromUrl();
    if (loaded) dispatch({ type: 'load', ...loaded });
  }, [syncUrl]);

  useEffect(() => {
    if (!syncUrl || !active || !urlLoaded.current) return;
    window.history.replaceState(null, '', `?${encodeRequest(toRequest(config))}`);
  }, [config, syncUrl, active]);

  // A settings change drops the result and any run still going.
  useEffect(() => {
    if (run.phase === 'idle') controllerRef.current?.dispose();
  }, [run.phase]);

  // After a run finishes, move focus to the result so keyboard and screen-reader users land on it.
  useEffect(() => {
    if (run.phase === 'running') wasRunning.current = true;
    if (run.phase === 'done' && wasRunning.current) {
      wasRunning.current = false;
      headingRef.current?.focus();
    }
    if (run.phase === 'idle') wasRunning.current = false;
  }, [run.phase]);

  const explore = useCallback(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    const request = toRequest(config);
    const runId = controller.start(request, {
      onProgress: (id, stats) => dispatch({ type: 'progress', runId: id, stats }),
      onDone: (id, outcome) => dispatch({ type: 'runDone', runId: id, outcome, request }),
    });
    dispatch({ type: 'runStarted', runId });
  }, [config]);

  const cancel = useCallback(() => controllerRef.current?.cancel(), []);

  const template = getTemplate(config.templateId) as TemplateDef;
  const initialNode = useMemo(() => {
    const resolved = resolveRequest(toRequest(config));
    if (!resolved.ok) return template.lifecycle.nodes[0]?.id ?? '';
    return template.lifecycle.current(resolved.value.model.initial.db);
  }, [config, template]);

  return (
    <div className="workspace">
      {state.notice ? (
        <p className="notice" role="status">
          {state.notice}{' '}
          <button
            type="button"
            className="link-button"
            onClick={() => dispatch({ type: 'dismissNotice' })}
          >
            Dismiss
          </button>
        </p>
      ) : null}
      <p className="sr-only" role="status" aria-live="polite">
        {run.phase === 'running' ? 'Exploring' : ''}
      </p>
      <div className="workspace-grid">
        <div className="col-setup">
          <SetupPanel
            config={config}
            run={run}
            dispatch={dispatch}
            onExplore={explore}
            onCancel={cancel}
          />
        </div>
        <div className="col-main">
          <h3 id="workspace-heading">Sandbox</h3>
          <p className="sandbox-intro">
            Every technical control is here: choose the workflow, the safety rule, how it is built,
            and which things can go wrong, then try every possible order within your limits.
          </p>
          <section className="card about" aria-labelledby="about-heading">
            <h3 id="about-heading">{template.title}</h3>
            <p>{template.story}</p>
            <ul className="actors">
              {template.actors.map((actor) => (
                <li key={actor.name}>
                  <strong>{actor.name}.</strong> {actor.role}
                </li>
              ))}
            </ul>
            {run.phase === 'done' && run.outcome.status === 'violated' ? null : (
              <LifecycleDiagram
                title={template.title}
                lifecycle={template.lifecycle}
                current={initialNode}
              />
            )}
          </section>
          <ResultPanel run={run} config={config} headingRef={headingRef} />
          {run.phase === 'done' && run.outcome.status === 'violated' ? (
            <ReplayPanel
              outcome={run.outcome}
              request={run.request}
              step={state.step}
              onStep={(next) => dispatch({ type: 'selectStep', step: next })}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
