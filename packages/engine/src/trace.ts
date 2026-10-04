import type {
  Counterexample,
  Json,
  TraceStep,
  TransitionInfo,
  Violation,
} from '@invariant-trail/contracts';
import { canonicalize } from './canonical';
import { diffStates, touchesEvidence } from './diff';
import { toInfo, type Model } from './model';

export interface VisitedNode<S extends Json> {
  state: S;
  /** Canonical key of the predecessor, or null for the initial state. */
  parent: string | null;
  via: TransitionInfo | null;
  depth: number;
}

/** Walks predecessor links back to the initial state and builds the annotated trace. */
export function buildCounterexample<S extends Json>(
  visited: Map<string, VisitedNode<S>>,
  violatingKey: string,
  invariantId: string,
  violation: Violation,
): Counterexample {
  const chain: VisitedNode<S>[] = [];
  let cursor: string | null = violatingKey;
  while (cursor !== null) {
    const node = visited.get(cursor);
    if (!node) throw new Error('broken predecessor chain');
    chain.push(node);
    cursor = node.parent;
  }
  chain.reverse();
  const steps: TraceStep[] = [];
  for (let i = 1; i < chain.length; i++) {
    const before = (chain[i - 1] as VisitedNode<S>).state;
    const node = chain[i] as VisitedNode<S>;
    const changes = diffStates(before, node.state);
    steps.push({
      index: i,
      transition: node.via as TransitionInfo,
      before,
      after: node.state,
      changes,
      contributes: touchesEvidence(changes, violation),
    });
  }
  return {
    invariantId,
    violation,
    initial: (chain[0] as VisitedNode<S>).state,
    steps,
  };
}

export interface ReplayResult {
  ok: boolean;
  stepsChecked: number;
  problems: string[];
}

/**
 * Re-executes a counterexample from the model's initial state by picking each recorded transition
 * id among the real successors. Reports any divergence, including a prefix that already violated
 * the invariant (which would mean the trace is not shortest) or a final state that does not.
 */
export function replayTrace<S extends Json>(model: Model<S>, trace: Counterexample): ReplayResult {
  const problems: string[] = [];
  let state: S = model.initial;
  if (canonicalize(state) !== canonicalize(trace.initial)) {
    problems.push('initial state differs from the recorded initial state');
    return { ok: false, stepsChecked: 0, problems };
  }
  if (trace.steps.length > 0 && model.invariant(state)) {
    problems.push('the initial state already violates the invariant');
  }
  let checked = 0;
  for (const step of trace.steps) {
    if (canonicalize(step.before) !== canonicalize(state)) {
      problems.push(`step ${step.index}: recorded before-state does not match the replayed state`);
      break;
    }
    const match = model.successors(state).find((t) => t.id === step.transition.id);
    if (!match) {
      problems.push(`step ${step.index}: transition ${step.transition.id} is not enabled`);
      break;
    }
    if (canonicalize(toInfo(match)) !== canonicalize(step.transition)) {
      problems.push(
        `step ${step.index}: recorded transition description differs from the replayed one`,
      );
      break;
    }
    if (canonicalize(match.next) !== canonicalize(step.after)) {
      problems.push(`step ${step.index}: replayed state differs from the recorded after-state`);
      break;
    }
    state = match.next;
    checked++;
    if (checked < trace.steps.length && model.invariant(state)) {
      problems.push(`step ${step.index}: invariant already violated before the final step`);
    }
  }
  if (problems.length === 0) {
    const violation = model.invariant(state);
    if (!violation) problems.push('the final state does not violate the invariant');
    else if (violation.message !== trace.violation.message) {
      problems.push('the final violation differs from the recorded violation');
    }
  }
  return { ok: problems.length === 0, stepsChecked: checked, problems };
}
