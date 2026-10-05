export const FAULT_IDS = [
  'duplicate',
  'lostResponse',
  'delay',
  'reorder',
  'concurrent',
  'crash',
  'retry',
  'lateRetry',
] as const;

export type FaultId = (typeof FAULT_IDS)[number];

export interface FaultSettings {
  /** Extra copies a delivered message may leave in flight (0-2). */
  duplicate: number;
  /** Responses that may be dropped after the effect was produced (0-2). */
  lostResponse: number;
  /** A timeout may fire while traffic is still in flight. */
  delay: boolean;
  /** Any in-flight message may be delivered next. */
  reorder: boolean;
  /** Handler steps may interleave. */
  concurrent: boolean;
  /** Crashes between two writes of a running handler (0-1). */
  crash: number;
  /** Retries a client may send after a timeout (0-2). */
  retry: number;
  /** Stale retries that may fire after a client finished or gave up (0-1). */
  lateRetry: number;
}

export const FAULT_BOUNDS = {
  duplicate: { min: 0, max: 2 },
  lostResponse: { min: 0, max: 2 },
  crash: { min: 0, max: 1 },
  retry: { min: 0, max: 2 },
  lateRetry: { min: 0, max: 1 },
} as const;

export const NO_FAULTS: FaultSettings = {
  duplicate: 0,
  lostResponse: 0,
  delay: false,
  reorder: false,
  concurrent: false,
  crash: 0,
  retry: 0,
  lateRetry: 0,
};
