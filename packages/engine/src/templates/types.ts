import { NO_FAULTS, type FaultSettings, type Limits } from '@invariant-trail/contracts';
import type { InvariantDef, Obj, ProtocolSpec } from '../kit/types';

export interface DesignChoice {
  id: string;
  label: string;
  help: string;
}

/** A typed implementation choice, rendered as a select. Values are allowlisted identifiers. */
export interface DesignOption {
  id: string;
  label: string;
  help: string;
  choices: DesignChoice[];
  defaultChoice: string;
}

export interface LifecycleNode {
  id: string;
  label: string;
}

export interface LifecycleEdge {
  from: string;
  to: string;
  label: string;
}

/** Grid cell [column, row] for every node. */
export type LifecycleGrid = Record<string, [number, number]>;

export interface Lifecycle {
  nodes: LifecycleNode[];
  edges: LifecycleEdge[];
  /** Abstract placement for wide containers and for narrow ones; pixels are computed by the view. */
  grid: { wide: LifecycleGrid; narrow: LifecycleGrid };
  /** Which node the durable data currently sits in. */
  current(db: Obj): string;
}

export interface Preset {
  id: string;
  title: string;
  summary: string;
  design: Record<string, string>;
  faults: FaultSettings;
  invariantId: string;
  /** Limits to apply with this preset; defaults apply when omitted. */
  limits?: Limits;
  expect: { status: 'violated' | 'bounded-safe' | 'exhausted'; shortest?: number };
}

export interface TemplateDef {
  id: string;
  title: string;
  tagline: string;
  /** Plain-language explanation of what the workflow does. */
  story: string;
  actors: { name: string; role: string }[];
  lifecycle: Lifecycle;
  designOptions: DesignOption[];
  invariants: InvariantDef[];
  presets: Preset[];
  /** Friendly names for durable-state paths shown in the inspector. */
  dbLabels: Record<string, string>;
  buildSpec(design: Record<string, string>): ProtocolSpec;
}

export function faults(partial: Partial<FaultSettings>): FaultSettings {
  return { ...NO_FAULTS, ...partial };
}

/** Every control at its maximum. The state space explodes on purpose; see the stress preset. */
export const ALL_FAULTS: FaultSettings = {
  duplicate: 2,
  lostResponse: 2,
  delay: true,
  reorder: true,
  concurrent: true,
  crash: 1,
  retry: 2,
  lateRetry: 1,
};

/** A broad combination that is still small enough to enumerate completely. */
export const BROAD_FAULTS: FaultSettings = {
  duplicate: 1,
  lostResponse: 1,
  delay: false,
  reorder: true,
  concurrent: true,
  crash: 1,
  retry: 1,
  lateRetry: 1,
};

export const BROAD_LIMITS: Limits = { maxDepth: 40, maxStates: 50_000, maxBranching: 32 };
