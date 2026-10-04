import { FAULT_BOUNDS, type FaultId, type FaultSettings } from '@invariant-trail/contracts';

export type FaultControl =
  | { id: FaultId; kind: 'switch'; label: string; help: string }
  | { id: FaultId; kind: 'count'; label: string; help: string; max: number; unit: string };

/** Typed failure controls, in the order they are shown. */
export const FAULT_CONTROLS: FaultControl[] = [
  {
    id: 'duplicate',
    kind: 'count',
    label: 'Duplicate delivery',
    help: 'A request that reaches the service can be delivered again.',
    max: FAULT_BOUNDS.duplicate.max,
    unit: 'extra copies',
  },
  {
    id: 'lostResponse',
    kind: 'count',
    label: 'Lost answer',
    help: 'The service does the work, but its answer can vanish on the way back.',
    max: FAULT_BOUNDS.lostResponse.max,
    unit: 'answers lost',
  },
  {
    id: 'retry',
    kind: 'count',
    label: 'Retry',
    help: 'A client that hears nothing resends the same request.',
    max: FAULT_BOUNDS.retry.max,
    unit: 'retries',
  },
  {
    id: 'delay',
    kind: 'switch',
    label: 'Slow answers',
    help: 'A client may give up waiting while its answer is still on the way.',
  },
  {
    id: 'reorder',
    kind: 'switch',
    label: 'Out-of-order delivery',
    help: 'Messages may arrive in any order, not only the order they were sent.',
  },
  {
    id: 'concurrent',
    kind: 'switch',
    label: 'Concurrent work',
    help: 'The service handles several requests at once, so their steps can interleave.',
  },
  {
    id: 'crash',
    kind: 'count',
    label: 'Crash between writes',
    help: 'The service can stop part-way through a request, after at least one of its steps. Earlier writes stay.',
    max: FAULT_BOUNDS.crash.max,
    unit: 'crashes',
  },
  {
    id: 'lateRetry',
    kind: 'count',
    label: 'Late retry',
    help: 'An old retry timer can fire after the client already finished or gave up.',
    max: FAULT_BOUNDS.lateRetry.max,
    unit: 'late retries',
  },
];

export function describeFaults(faults: FaultSettings): string {
  const parts = FAULT_CONTROLS.flatMap((control) => {
    const value = faults[control.id];
    if (control.kind === 'switch') return value ? [control.label.toLowerCase()] : [];
    return typeof value === 'number' && value > 0
      ? [`${control.label.toLowerCase()} ×${value}`]
      : [];
  });
  return parts.length > 0 ? parts.join(', ') : 'no failures';
}
