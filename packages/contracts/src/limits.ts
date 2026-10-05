export interface Limits {
  /** Maximum transitions in a trace. States at this depth are checked but not expanded. */
  maxDepth: number;
  /** Maximum distinct states stored. */
  maxStates: number;
  /** Maximum successors considered per state; extras are dropped in stable order. */
  maxBranching: number;
}

export const LIMIT_BOUNDS = {
  maxDepth: { min: 1, max: 40, default: 32 },
  maxStates: { min: 100, max: 100_000, default: 30_000 },
  maxBranching: { min: 1, max: 64, default: 32 },
} as const;

export const DEFAULT_LIMITS: Limits = {
  maxDepth: LIMIT_BOUNDS.maxDepth.default,
  maxStates: LIMIT_BOUNDS.maxStates.default,
  maxBranching: LIMIT_BOUNDS.maxBranching.default,
};

/** Clamps untrusted numeric input into the supported range. Non-numbers become the default. */
export function clampLimits(input: Partial<Limits>): Limits {
  const clamp = (key: keyof Limits): number => {
    const bounds = LIMIT_BOUNDS[key];
    const raw = input[key];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return bounds.default;
    return Math.min(bounds.max, Math.max(bounds.min, Math.trunc(raw)));
  };
  return {
    maxDepth: clamp('maxDepth'),
    maxStates: clamp('maxStates'),
    maxBranching: clamp('maxBranching'),
  };
}
