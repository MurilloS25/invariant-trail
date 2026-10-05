import type { FaultId, Json, TransitionInfo, Violation } from '@invariant-trail/contracts';

export interface Transition<S extends Json = Json> extends TransitionInfo {
  /** State after the transition. Must be a complete, normalised state. */
  next: S;
}

export type TransitionDescriptor = Omit<TransitionInfo, 'fault'> & { fault?: FaultId };

/**
 * A finite transition system. `successors` must be pure and return transitions in a stable order;
 * the explorer never reorders them. Everything that influences future behaviour must be part of
 * the state itself so that the canonical state is the complete node identity.
 */
export interface Model<S extends Json = Json> {
  invariantId: string;
  initial: S;
  successors(state: S): Transition<S>[];
  invariant(state: S): Violation | null;
}

export class ModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelError';
  }
}

export function toInfo(transition: Transition): TransitionInfo {
  const info: TransitionInfo = {
    id: transition.id,
    kind: transition.kind,
    actor: transition.actor,
    label: transition.label,
    detail: transition.detail,
  };
  if (transition.fault !== undefined) info.fault = transition.fault;
  return info;
}
