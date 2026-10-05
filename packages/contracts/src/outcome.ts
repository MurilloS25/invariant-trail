import type { FaultId } from './faults';
import type { Json } from './json';
import type { Limits } from './limits';

export type TransitionKind = 'action' | 'fault';

export interface TransitionInfo {
  /** Unique among the successors of one state; stable across runs. */
  id: string;
  kind: TransitionKind;
  actor: string;
  label: string;
  detail: string;
  fault?: FaultId;
}

export interface StateChange {
  /** Human-readable path such as `db.booking.status` or `net[]`. */
  path: string;
  op: 'added' | 'removed' | 'changed';
  before?: Json;
  after?: Json;
}

export interface Violation {
  message: string;
  /** State paths that form the evidence; used to mark contributing steps. */
  paths: string[];
}

export interface TraceStep {
  index: number;
  transition: TransitionInfo;
  before: Json;
  after: Json;
  changes: StateChange[];
  /** True when this step changed a path named in the violation evidence. */
  contributes: boolean;
}

export interface Counterexample {
  invariantId: string;
  violation: Violation;
  initial: Json;
  steps: TraceStep[];
}

export type LimitKind = 'depth' | 'branching';

export type StopReason =
  'violation-found' | 'frontier-empty' | 'state-limit' | 'cancelled' | 'invalid-input';

export interface ExplorationStats {
  statesDiscovered: number;
  statesExpanded: number;
  transitionsGenerated: number;
  duplicatesSkipped: number;
  maxDepthReached: number;
  /** States whose successors were cut by the branching limit. */
  branchTruncations: number;
  /** States at maxDepth that still had unseen successors. */
  depthCutoffStates: number;
}

export const EMPTY_STATS: ExplorationStats = {
  statesDiscovered: 0,
  statesExpanded: 0,
  transitionsGenerated: 0,
  duplicatesSkipped: 0,
  maxDepthReached: 0,
  branchTruncations: 0,
  depthCutoffStates: 0,
};

interface OutcomeBase {
  engineVersion: string;
  limits: Limits | null;
  stats: ExplorationStats;
  stopReason: StopReason;
  /** Limits that hid states. Empty on a finished search means the whole modelled space was explored. */
  limitsHit: LimitKind[];
}

export interface ViolatedOutcome extends OutcomeBase {
  status: 'violated';
  counterexample: Counterexample;
  /** True when no limit hid states, so minimality holds for the whole model. */
  minimalInModel: boolean;
}

export interface BoundedSafeOutcome extends OutcomeBase {
  status: 'bounded-safe';
  /** True when the whole reachable space of the model was enumerated. */
  complete: boolean;
}

export interface ExhaustedOutcome extends OutcomeBase {
  status: 'exhausted';
}

export interface CancelledOutcome extends OutcomeBase {
  status: 'cancelled';
}

export interface InvalidOutcome extends OutcomeBase {
  status: 'invalid';
  issues: string[];
}

export type ExplorationOutcome =
  ViolatedOutcome | BoundedSafeOutcome | ExhaustedOutcome | CancelledOutcome | InvalidOutcome;

export type OutcomeStatus = ExplorationOutcome['status'];
