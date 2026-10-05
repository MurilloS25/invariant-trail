'use client';

import { replayTrace, resolveRequest } from '@invariant-trail/engine';
import type { ReactNode, Ref } from 'react';
import { useId, useMemo } from 'react';
import { Heading } from './heading';
import { describeOutcome } from '../lib/copy';
import type { Config, RunState } from '../lib/workspace-state';
import { StatusBadge } from './status-badge';

const count = (n: number): string => n.toLocaleString('en-US');

interface Props {
  run: RunState;
  config: Config;
  headingRef: Ref<HTMLHeadingElement>;
  /** Keeps element ids unique when two results are on the page. */
  idPrefix?: string;
  /** Heading level: 3 in the sandbox, 4 inside a lesson. */
  headingLevel?: number;
  /** Lessons show a one-line summary and fold the counters away. */
  compact?: boolean;
}

function ReplayCheck({ run }: { run: Extract<RunState, { phase: 'done' }> }) {
  const check = useMemo(() => {
    if (run.outcome.status !== 'violated') return null;
    const resolved = resolveRequest(run.request);
    if (!resolved.ok) return null;
    const result = replayTrace(resolved.value.model, run.outcome.counterexample);
    return { ok: result.ok, steps: run.outcome.counterexample.steps.length };
  }, [run]);
  if (!check) return null;
  return (
    <p className="replay-check" data-testid="replay-check">
      {check.ok
        ? `Verified: replaying ${check.steps === 1 ? 'this step' : `these ${check.steps} steps`} from the start reproduces the broken rule.`
        : 'Verification failed: the recorded path does not reproduce. Please report this.'}
    </p>
  );
}

function Details({
  compact,
  summary,
  children,
}: {
  compact: boolean;
  summary: string;
  children: ReactNode;
}) {
  if (!compact) return <>{children}</>;
  return (
    <details className="result-details">
      <summary>{summary}</summary>
      {children}
    </details>
  );
}

export function ResultPanel({
  run,
  config,
  headingRef,
  idPrefix,
  headingLevel = 3,
  compact = false,
}: Props) {
  const auto = useId();
  const headingId = `${idPrefix ?? auto}-heading`;
  const { limits } = config;

  if (run.phase === 'idle') {
    return (
      <section className="card result" aria-labelledby={headingId}>
        <Heading level={headingLevel} id={headingId} ref={headingRef} tabIndex={-1}>
          Result
        </Heading>
        <p>
          Nothing explored yet. Choose settings, then press <strong>Explore</strong>. The search
          will look at up to {count(limits.maxStates)} states and {limits.maxDepth} steps, and tell
          you plainly what that does and does not cover.
        </p>
      </section>
    );
  }

  if (run.phase === 'running') {
    const { stats } = run;
    return (
      <section className="card result" aria-labelledby={headingId} aria-busy="true">
        <Heading level={headingLevel} id={headingId} ref={headingRef} tabIndex={-1}>
          Exploring…
        </Heading>
        <progress
          max={limits.maxStates}
          value={Math.min(stats.statesDiscovered, limits.maxStates)}
          aria-label="State budget used"
        />
        <p data-testid="progress-text">
          {count(stats.statesDiscovered)} of {count(limits.maxStates)} states found, longest path{' '}
          {stats.maxDepthReached} {stats.maxDepthReached === 1 ? 'step' : 'steps'}. The bar shows
          the state budget used, not time left.
        </p>
      </section>
    );
  }

  const { outcome } = run;
  const copy = describeOutcome(outcome, { lesson: compact });
  const { stats } = outcome;
  return (
    <section
      className={`card result result-${copy.tone}`}
      aria-labelledby={headingId}
      data-status={outcome.status}
    >
      <StatusBadge tone={copy.tone}>{copy.badge}</StatusBadge>
      <Heading level={headingLevel} id={headingId} ref={headingRef} tabIndex={-1}>
        {copy.headline}
      </Heading>
      {copy.paragraphs.map((text) => (
        <p key={text}>{text}</p>
      ))}
      <ReplayCheck run={run} />
      {compact ? (
        <p className="help">The search looked at {count(stats.statesDiscovered)} situations.</p>
      ) : null}
      {outcome.status !== 'invalid' ? (
        <Details compact={compact} summary="Search details">
          <dl className="stats">
            <div>
              <dt>States found</dt>
              <dd>{count(stats.statesDiscovered)}</dd>
            </div>
            <div>
              <dt>States expanded</dt>
              <dd>{count(stats.statesExpanded)}</dd>
            </div>
            <div>
              <dt>Longest path reached</dt>
              <dd>{stats.maxDepthReached}</dd>
            </div>
            <div>
              <dt>Repeat states skipped</dt>
              <dd>{count(stats.duplicatesSkipped)}</dd>
            </div>
            <div>
              <dt>Limits applied</dt>
              <dd>
                {outcome.limits
                  ? `${outcome.limits.maxDepth} steps, ${count(outcome.limits.maxStates)} states, ${outcome.limits.maxBranching} choices`
                  : 'none'}
              </dd>
            </div>
            <div>
              <dt>Limits that hid states</dt>
              <dd>
                {outcome.status === 'cancelled' || outcome.status === 'exhausted'
                  ? 'not known (search stopped early)'
                  : outcome.limitsHit.length === 0
                    ? 'none'
                    : outcome.limitsHit
                        .map((l) => (l === 'depth' ? 'step limit' : 'branching limit'))
                        .join(', ')}
              </dd>
            </div>
          </dl>
        </Details>
      ) : null}
    </section>
  );
}
