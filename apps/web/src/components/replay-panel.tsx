'use client';

import type { ExplorationRequest, ViolatedOutcome } from '@invariant-trail/contracts';
import {
  describeState,
  diffViews,
  explainCounterexample,
  resolveRequest,
  type ProtocolState,
} from '@invariant-trail/engine';
import { useMemo, useRef, type KeyboardEvent } from 'react';
import { FAULT_NAMES } from '../lib/copy';
import { LifecycleDiagram } from './diagram';
import { ChangeTable, StateSections } from './state-table';

interface Props {
  outcome: ViolatedOutcome;
  request: ExplorationRequest;
  step: number;
  onStep(step: number): void;
}

export function ReplayPanel({ outcome, request, step, onStep }: Props) {
  const resolved = useMemo(() => resolveRequest(request), [request]);
  const stoneRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const { counterexample } = outcome;
  const total = counterexample.steps.length;
  const selected = Math.min(step, total);

  const detail = useMemo(() => {
    if (!resolved.ok) return null;
    const { template, design } = resolved.value;
    const current = selected === 0 ? undefined : counterexample.steps[selected - 1];
    const afterState = (current
      ? current.after
      : counterexample.initial) as unknown as ProtocolState;
    const beforeState = (current
      ? current.before
      : counterexample.initial) as unknown as ProtocolState;
    const before = describeState(template, design, beforeState);
    const after = describeState(template, design, afterState);
    return {
      current,
      template,
      sections: diffViews(before, after, counterexample.violation.paths),
      lifecycleNode: template.lifecycle.current(afterState.db),
      causes: explainCounterexample(template, design, counterexample),
      invariant: resolved.value.invariant,
    };
  }, [resolved, counterexample, selected]);

  if (!detail) return null;
  const { current, template, sections, lifecycleNode, causes, invariant } = detail;

  const go = (next: number, focus = false): void => {
    const clamped = Math.max(0, Math.min(total, next));
    onStep(clamped);
    if (focus) stoneRefs.current[clamped]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLOListElement>): void => {
    const keys: Record<string, number> = {
      ArrowDown: selected + 1,
      ArrowRight: selected + 1,
      ArrowUp: selected - 1,
      ArrowLeft: selected - 1,
      Home: 0,
      End: total,
    };
    const target = keys[event.key];
    if (target === undefined) return;
    event.preventDefault();
    go(target, true);
  };

  const isLast = selected === total;

  return (
    <section className="card replay" aria-labelledby="replay-heading">
      <h3 id="replay-heading">Shortest example that breaks the rule</h3>
      <p className="help">
        Step through what happened, from the starting state to the broken rule. Use the buttons, or
        the arrow keys while a step is focused.
      </p>

      <div className="replay-layout">
        {/* Key events bubble up from the focusable step buttons inside this list. */}
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
        <ol className="trail" onKeyDown={onKeyDown} aria-label="Steps of the counterexample">
          <li className={selected === 0 ? 'trail-item is-selected' : 'trail-item'}>
            <button
              type="button"
              className="stone"
              ref={(node) => {
                stoneRefs.current[0] = node;
              }}
              aria-current={selected === 0 ? 'step' : undefined}
              onClick={() => go(0)}
            >
              <span className="stone-marker marker-start" aria-hidden="true" />
              <span className="stone-text">
                <span className="stone-index">Start</span>
                <span className="stone-label">Initial state</span>
              </span>
            </button>
          </li>
          {counterexample.steps.map((s) => {
            const isFault = s.transition.kind === 'fault';
            const isFinal = s.index === total;
            return (
              <li
                key={s.index}
                className={s.index === selected ? 'trail-item is-selected' : 'trail-item'}
              >
                <button
                  type="button"
                  className="stone"
                  ref={(node) => {
                    stoneRefs.current[s.index] = node;
                  }}
                  aria-current={s.index === selected ? 'step' : undefined}
                  onClick={() => go(s.index)}
                >
                  <span
                    className={`stone-marker ${isFinal ? 'marker-break' : isFault ? 'marker-fault' : 'marker-step'}`}
                    aria-hidden="true"
                  />
                  <span className="stone-text">
                    <span className="stone-index">Step {s.index}</span>
                    <span className="stone-label">{s.transition.label}</span>
                    <span className="stone-tags">
                      {isFault ? (
                        <span className="tag tag-fault">
                          Failure:{' '}
                          {s.transition.fault ? FAULT_NAMES[s.transition.fault] : 'injected'}
                        </span>
                      ) : null}
                      {isFinal ? <span className="tag tag-break">Rule broken here</span> : null}
                      {s.contributes && !isFinal ? (
                        <span className="tag">Changes rule evidence</span>
                      ) : null}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        <div className="step-detail" data-testid="step-detail">
          <div className="step-nav">
            <button
              type="button"
              className="button"
              onClick={() => go(selected - 1, true)}
              disabled={selected === 0}
            >
              Previous step
            </button>
            <span className="step-count" aria-live="polite">
              {selected === 0 ? 'Start' : `Step ${selected} of ${total}`}
            </span>
            <button
              type="button"
              className="button button-primary"
              onClick={() => go(selected + 1, true)}
              disabled={selected === total}
            >
              Next step
            </button>
          </div>

          {current ? (
            <>
              <h4>{current.transition.label}</h4>
              <p className="step-actor">
                Who: {current.transition.actor}
                {current.transition.kind === 'fault' && current.transition.fault
                  ? ` · Failure injected: ${FAULT_NAMES[current.transition.fault]}`
                  : ''}
              </p>
              <p>{current.transition.detail}</p>
              <h5 className="subhead">What changed</h5>
              <ChangeTable sections={sections} />
            </>
          ) : (
            <>
              <h4>Initial state</h4>
              <p>Nothing has happened yet. Every request is still waiting to be sent.</p>
            </>
          )}

          {isLast ? (
            <div className="violation-box" role="note">
              <strong>Rule broken: {invariant.title}.</strong>
              <p>{counterexample.violation.message}</p>
            </div>
          ) : null}

          <LifecycleDiagram
            title={template.title}
            lifecycle={template.lifecycle}
            current={lifecycleNode}
          />

          <details className="full-state">
            <summary>Full state {selected === 0 ? 'at the start' : 'after this step'}</summary>
            <StateSections sections={sections} />
          </details>
        </div>
      </div>

      <section className="why" aria-labelledby="why-heading">
        <h4 id="why-heading">Why the rule broke</h4>
        <p>
          <strong>{invariant.title}.</strong> {invariant.why}
        </p>
        <p>{counterexample.violation.message}</p>
        {causes.length > 0 ? (
          <>
            <p className="help">These steps changed the data the rule looks at:</p>
            <ol className="causes">
              {causes.map((cause) => (
                <li key={cause.stepIndex}>
                  <button type="button" className="link-button" onClick={() => go(cause.stepIndex)}>
                    Step {cause.stepIndex}: {cause.label}
                  </button>
                  <ul>
                    {cause.rows.map((row) => (
                      <li key={row.label}>
                        {row.label}: {row.previous !== undefined ? `${row.previous} → ` : ''}
                        <strong>{row.value}</strong>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          </>
        ) : null}
      </section>
    </section>
  );
}
