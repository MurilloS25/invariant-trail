'use client';

import { getTemplate, resolveRequest, type TemplateDef } from '@invariant-trail/engine';
import { useEffect, useMemo, useRef, useState } from 'react';
import { GLOSSARY, LESSONS, getLesson, lessonRequest, type Lesson } from '../lib/lessons';
import type { Runner } from '../lib/runner';
import { useRun } from '../lib/use-run';
import type { RunState } from '../lib/workspace-state';
import { LifecycleDiagram } from './diagram';
import { ReplayPanel } from './replay-panel';
import { ResultPanel } from './result-panel';

type Prediction = 'hold' | 'break' | 'unsure';

interface Props {
  runner?: Runner;
  lessonId: string;
  onLesson(id: string): void;
}

function Terms({ lesson }: { lesson: Lesson }) {
  return (
    <details className="terms card">
      <summary>Words used in this lesson</summary>
      <dl>
        {lesson.terms.map((id) => (
          <div key={id}>
            <dt>{GLOSSARY[id].term}</dt>
            <dd>{GLOSSARY[id].definition}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

/**
 * Feedback on the learner's guess. It only judges when the search reached a conclusion: after a
 * cancelled, exhausted or invalid run it says so instead of pretending the guess was settled.
 */
export function predictionFeedback(prediction: Prediction | null, run: RunState): string | null {
  if (run.phase !== 'done' || prediction === null || prediction === 'unsure') return null;
  const { outcome } = run;
  if (outcome.status === 'violated') {
    return prediction === 'break'
      ? 'You predicted it would break, and it did.'
      : 'You predicted it would hold. It broke. That is the point: an ordinary test that tries one order of events rarely finds this.';
  }
  if (outcome.status === 'bounded-safe') {
    const scope = outcome.complete ? 'in this model' : 'within its limits';
    return prediction === 'hold'
      ? `You predicted it would hold, and the search found no violation ${scope}.`
      : `You predicted it would break, but the search found no violation ${scope}.`;
  }
  return 'The search did not finish, so it does not settle your prediction.';
}

function LessonView({
  runner,
  lesson,
  next,
  onNext,
}: {
  runner: Runner | undefined;
  lesson: Lesson;
  next: Lesson | null;
  onNext(): void;
}) {
  const template = getTemplate(lesson.templateId) as TemplateDef;
  const unsafe = useRun(runner);
  const safe = useRun(runner);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  /** The guess as it was when the simulation ran, so changing it afterwards cannot rewrite history. */
  const [predicted, setPredicted] = useState<Prediction | null>(null);
  const [step, setStep] = useState(0);
  const unsafeHeading = useRef<HTMLHeadingElement>(null);
  const safeHeading = useRef<HTMLHeadingElement>(null);
  const unsafeWasRunning = useRef(false);
  const safeWasRunning = useRef(false);

  // Move focus to a result when its run finishes so keyboard and screen-reader users land on it.
  useEffect(() => {
    if (unsafe.run.phase === 'running') unsafeWasRunning.current = true;
    if (unsafe.run.phase === 'done' && unsafeWasRunning.current) {
      unsafeWasRunning.current = false;
      unsafeHeading.current?.focus();
    }
  }, [unsafe.run.phase]);
  useEffect(() => {
    if (safe.run.phase === 'running') safeWasRunning.current = true;
    if (safe.run.phase === 'done' && safeWasRunning.current) {
      safeWasRunning.current = false;
      safeHeading.current?.focus();
    }
  }, [safe.run.phase]);

  const request = useMemo(() => lessonRequest(lesson), [lesson]);
  const initialNode = useMemo(() => {
    const resolved = resolveRequest(request);
    if (!resolved.ok) return template.lifecycle.nodes[0]?.id ?? '';
    return template.lifecycle.current(resolved.value.model.initial.db);
  }, [request, template]);

  const running = unsafe.run.phase === 'running';
  const result = unsafe.run;
  const violated = result.phase === 'done' && result.outcome.status === 'violated';
  const feedback = predictionFeedback(predicted, result);
  const fixedOutcome = safe.run.phase === 'done' ? safe.run.outcome : null;

  return (
    <article className="lesson" aria-labelledby="lesson-title">
      <h3 id="lesson-title">{lesson.title}</h3>
      <p className="sr-only" role="status" aria-live="polite">
        {running || safe.run.phase === 'running' ? 'Exploring' : ''}
      </p>

      <section className="card lesson-block" aria-labelledby="scenario-heading">
        <h4 id="scenario-heading">The scenario</h4>
        <p>{lesson.scenario}</p>
        <LifecycleDiagram
          title={template.title}
          lifecycle={template.lifecycle}
          current={initialNode}
        />
      </section>

      <div className="lesson-pair">
        <section className="card lesson-block must-never" aria-labelledby="rule-heading">
          <h4 id="rule-heading">What must never happen?</h4>
          <p className="rule-text">{lesson.rule}</p>
          <p className="help">
            This is a {GLOSSARY.safetyRule.term.toLowerCase()}: {GLOSSARY.safetyRule.definition}
          </p>
        </section>
        <section className="card lesson-block could-go-wrong" aria-labelledby="wrong-heading">
          <h4 id="wrong-heading">What could go wrong?</h4>
          <ul>
            {lesson.wrong.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      </div>

      <Terms lesson={lesson} />

      <section className="card lesson-block" aria-labelledby="predict-heading">
        <h4 id="predict-heading">Your turn</h4>
        <fieldset className="predict">
          <legend>Will the rule hold if those things happen?</legend>
          {(
            [
              ['hold', 'I think it will hold'],
              ['break', 'I think it will break'],
              ['unsure', 'I am not sure'],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="predict-option">
              <input
                type="radio"
                name="prediction"
                value={value}
                checked={prediction === value}
                onChange={() => setPrediction(value)}
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        <p className="help">
          Guessing is optional. The simulation tries every possible order of events within its
          limits, not just one.
        </p>
        <div className="lesson-actions">
          <button
            type="button"
            className="button button-primary"
            onClick={() => {
              setStep(0);
              setPredicted(prediction);
              safe.reset();
              unsafe.start(request);
            }}
          >
            {result.phase === 'idle' ? 'Run the simulation' : 'Run again'}
          </button>
          {running ? (
            <button type="button" className="button" onClick={unsafe.cancel}>
              Cancel
            </button>
          ) : null}
        </div>
      </section>

      {result.phase !== 'idle' ? (
        <>
          {feedback ? <p className="prediction-feedback">{feedback}</p> : null}
          <ResultPanel
            run={result}
            config={request}
            headingRef={unsafeHeading}
            headingLevel={4}
            compact
          />
        </>
      ) : null}

      {violated && result.phase === 'done' && result.outcome.status === 'violated' ? (
        <>
          <ReplayPanel
            outcome={result.outcome}
            request={result.request}
            step={step}
            onStep={setStep}
            headingLevel={4}
            compact
          />
          <section className="card explain" aria-labelledby="explain-heading">
            <h4 id="explain-heading">What you just saw</h4>
            <h5>Why it happened</h5>
            {lesson.why.map((line) => (
              <p key={line}>{line}</p>
            ))}
            <h5>The idea behind it</h5>
            <p>
              <strong>{GLOSSARY[lesson.concept].term}.</strong>{' '}
              {GLOSSARY[lesson.concept].definition}
            </p>
            <h5>How real systems usually prevent it</h5>
            <ul>
              {lesson.patterns.map((pattern) => (
                <li key={pattern.name}>
                  <strong>{pattern.name}.</strong> {pattern.text}
                </li>
              ))}
            </ul>
            <p className="help">
              These are common patterns, not guarantees. Whether one is enough depends on the whole
              system around it.
            </p>
            <div className="lesson-actions">
              <button
                type="button"
                className="button button-primary"
                onClick={() => safe.start(lessonRequest(lesson, true))}
              >
                Try the same failures against a fixed design
              </button>
              {safe.run.phase === 'running' ? (
                <button type="button" className="button" onClick={safe.cancel}>
                  Cancel
                </button>
              ) : null}
            </div>
          </section>
        </>
      ) : null}

      {violated && safe.run.phase !== 'idle' ? (
        <section className="protected" aria-labelledby="fixed-heading">
          <h4 id="fixed-heading">The same scenario with a fix</h4>
          <p>Same failures, different design: {lesson.protectedDesign.summary}</p>
          <ResultPanel
            run={safe.run}
            config={request}
            headingRef={safeHeading}
            headingLevel={5}
            compact
          />
          {fixedOutcome?.status === 'bounded-safe' ? (
            <p className="help">
              Compare: the first design broke the rule. This one found no violation{' '}
              {fixedOutcome.complete ? 'in this model' : 'within the limits shown'}, with these
              failures and this one rule. Real systems still need their own tests for everything
              this simulation does not model.
            </p>
          ) : null}
          {fixedOutcome && fixedOutcome.status !== 'bounded-safe' ? (
            <p className="help">
              This fix did not settle these failures here. Open the sandbox to look at it more
              closely.
            </p>
          ) : null}
          {next ? (
            <div className="lesson-actions">
              <button type="button" className="button" onClick={onNext}>
                Next lesson: {next.title}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
    </article>
  );
}

export function LearnMode({ runner, lessonId, onLesson }: Props) {
  const lesson = getLesson(lessonId) ?? (LESSONS[0] as Lesson);
  const index = LESSONS.findIndex((l) => l.id === lesson.id);
  const next = LESSONS[index + 1] ?? null;
  return (
    <div className="learn">
      <fieldset className="group lesson-picker">
        <legend>Choose a lesson (start with the first, or pick any)</legend>
        <div className="choice-list lesson-choices">
          {LESSONS.map((item) => (
            // eslint-disable-next-line jsx-a11y/label-has-associated-control
            <label key={item.id} className="choice">
              <input
                type="radio"
                name="lesson"
                value={item.id}
                checked={item.id === lesson.id}
                onChange={() => onLesson(item.id)}
              />
              <span className="choice-body">
                <span className="choice-title">{item.title}</span>
                <span className="choice-help">{item.hook}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <LessonView
        key={lesson.id}
        runner={runner}
        lesson={lesson}
        next={next}
        onNext={() => next && onLesson(next.id)}
      />
    </div>
  );
}
