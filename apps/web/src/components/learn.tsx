'use client';

import { getTemplate, resolveRequest, type TemplateDef } from '@invariant-trail/engine';
import { useEffect, useMemo, useRef, useState } from 'react';
import { GLOSSARY, LESSONS, getLesson, lessonRequest, type Lesson } from '../lib/lessons';
import type { Runner } from '../lib/runner';
import { useRun } from '../lib/use-run';
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
    <section className="terms" aria-labelledby="terms-heading">
      <h4 id="terms-heading">Words used in this lesson</h4>
      <dl>
        {lesson.terms.map((id) => (
          <div key={id}>
            <dt>{GLOSSARY[id].term}</dt>
            <dd>{GLOSSARY[id].definition}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function LessonView({ runner, lesson }: { runner: Runner | undefined; lesson: Lesson }) {
  const template = getTemplate(lesson.templateId) as TemplateDef;
  const unsafe = useRun(runner);
  const safe = useRun(runner);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
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

  const feedback = (): string | null => {
    if (result.phase !== 'done' || prediction === null || prediction === 'unsure') return null;
    const broke = result.outcome.status === 'violated';
    if (prediction === 'break' && broke) return 'You predicted it would break, and it did.';
    if (prediction === 'hold' && broke) {
      return 'You predicted it would hold. It broke. That is the point: an ordinary test that tries one order of events would not have found this.';
    }
    if (prediction === 'break')
      return 'You predicted it would break, but the search found no violation here.';
    return 'You predicted it would hold, and the search found no violation.';
  };

  return (
    <article className="lesson" aria-labelledby="lesson-title">
      <h3 id="lesson-title">{lesson.title}</h3>

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
              safe.reset();
              unsafe.start(request);
            }}
          >
            {running ? 'Run again' : 'Run the simulation'}
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
          <ResultPanel run={result} config={request} headingRef={unsafeHeading} />
          {feedback() ? (
            <p className="prediction-feedback" role="status">
              {feedback()}
            </p>
          ) : null}
        </>
      ) : null}

      {result.phase === 'done' && result.outcome.status === 'violated' ? (
        <>
          <ReplayPanel
            outcome={result.outcome}
            request={result.request}
            step={step}
            onStep={setStep}
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
                Try the same failures against a protected design
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
        <section className="protected" aria-labelledby="protected-heading">
          <h4 id="protected-heading">The protected design</h4>
          <p>Same failures, different design: {lesson.protectedDesign.summary}</p>
          <ResultPanel
            run={safe.run}
            config={request}
            headingRef={safeHeading}
            idPrefix="protected-result"
          />
          {safe.run.phase === 'done' && safe.run.outcome.status === 'bounded-safe' ? (
            <p className="help">
              Compare: the unprotected design broke the rule. This one did not, in this model, with
              these failures and this one rule. Real systems still need their own tests for
              everything this simulation does not model.
            </p>
          ) : null}
        </section>
      ) : null}

      <Terms lesson={lesson} />
    </article>
  );
}

export function LearnMode({ runner, lessonId, onLesson }: Props) {
  const lesson = getLesson(lessonId) ?? (LESSONS[0] as Lesson);
  return (
    <div className="learn">
      <fieldset className="group lesson-picker">
        <legend>Choose a lesson</legend>
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

      <LessonView key={lesson.id} runner={runner} lesson={lesson} />
    </div>
  );
}
