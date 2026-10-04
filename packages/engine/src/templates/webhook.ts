import type { Obj, OperationDef, ProtocolSpec, StepDef } from '../kit/types';
import { BROAD_FAULTS, BROAD_LIMITS, faults, type TemplateDef } from './types';

type Subscription = { status: string; seq: number };

const subscription = (db: Obj): Subscription => db.subscription as Subscription;
const counts = (db: Obj, field: string): { [key: string]: number } =>
  db[field] as { [key: string]: number };

function eventSteps(
  event: { seq: number; status: string; effect: string },
  design: Record<string, string>,
): StepDef[] {
  const list: StepDef[] = [];
  const effectStep: StepDef = {
    name: 'Run the side effect',
    run({ db, local, request }) {
      if (local.skip === true) {
        return {
          note: `Event "${request.key}" was already claimed, so its side effect is skipped.`,
        };
      }
      const effects = counts(db, 'effects');
      const times = (effects[request.key] ?? 0) + 1;
      return {
        db: { ...db, effects: { ...effects, [request.key]: times } },
        note: `${event.effect} (this event's effect has now run ${times} time${times === 1 ? '' : 's'}).`,
      };
    },
  };
  if (design.dedupe === 'by-event-id') {
    list.push({
      name: 'Claim the event id',
      run({ db, request }) {
        const processed = counts(db, 'processed');
        if (processed[request.key]) {
          return { local: { skip: true }, note: `Event "${request.key}" was already claimed.` };
        }
        return {
          db: { ...db, processed: { ...processed, [request.key]: 1 } },
          local: { skip: false },
          note: `Atomically records event "${request.key}" as claimed.`,
        };
      },
    });
  }
  list.push(effectStep);
  list.push({
    name: 'Update the subscription',
    run({ db, local }) {
      if (local.skip === true)
        return { note: 'This event was already claimed, so the subscription is left alone.' };
      const current = subscription(db);
      const maxSeen = Math.max(db.maxSeqSeen as number, event.seq);
      if (design.ordering === 'ignore-older' && event.seq <= current.seq) {
        return {
          db: { ...db, maxSeqSeen: maxSeen },
          note: `Event #${event.seq} is not newer than the stored #${current.seq}, so the subscription is left alone.`,
        };
      }
      return {
        db: { ...db, maxSeqSeen: maxSeen, subscription: { status: event.status, seq: event.seq } },
        note: `Sets the subscription to ${event.status} from event #${event.seq}${
          event.seq < current.seq ? `, overwriting the newer state from event #${current.seq}` : ''
        }.`,
      };
    },
  });
  return list;
}

export const webhookTemplate: TemplateDef = {
  id: 'webhook-receipt',
  title: 'Webhook receipt',
  tagline: 'A provider sends two events. They arrive twice, late, or in the wrong order.',
  story:
    'A billing provider tells your app that a subscription was activated (event 1) and then cancelled (event 2). Webhooks are delivered at least once and in no promised order, and the provider resends events that were not acknowledged.',
  actors: [
    { name: 'Provider (activated)', role: 'Sends event 1 and resends it until acknowledged.' },
    { name: 'Provider (cancelled)', role: 'Sends event 2 and resends it until acknowledged.' },
    { name: 'Webhook receiver', role: 'Runs the side effect and updates the subscription.' },
  ],
  lifecycle: {
    width: 560,
    height: 190,
    nodes: [
      { id: 'none', label: 'No subscription', x: 10, y: 70 },
      { id: 'active', label: 'Active', x: 230, y: 10 },
      { id: 'cancelled', label: 'Cancelled', x: 230, y: 130 },
    ],
    edges: [
      { from: 'none', to: 'active', label: 'event 1: activated' },
      { from: 'active', to: 'cancelled', label: 'event 2: cancelled' },
      { from: 'none', to: 'cancelled', label: 'event 2 arrives first' },
    ],
    current: (db) => subscription(db).status,
  },
  designOptions: [
    {
      id: 'ordering',
      label: 'What the receiver does with an older event',
      help: 'Events carry a sequence number. The receiver can use it or ignore it.',
      defaultChoice: 'last-write-wins',
      choices: [
        {
          id: 'last-write-wins',
          label: 'Apply whatever arrives',
          help: 'The latest arrival overwrites the subscription.',
        },
        {
          id: 'ignore-older',
          label: 'Ignore older events',
          help: 'Only an event newer than the stored one is applied.',
        },
      ],
    },
    {
      id: 'dedupe',
      label: 'What the receiver does with a repeated event',
      help: 'Providers resend events. The receiver can remember event ids.',
      defaultChoice: 'off',
      choices: [
        {
          id: 'off',
          label: 'Handle every delivery',
          help: 'A repeated event runs its side effect again.',
        },
        {
          id: 'by-event-id',
          label: 'Remember event ids',
          help: 'An event id is claimed once; repeats skip the side effect.',
        },
      ],
    },
  ],
  invariants: [
    {
      id: 'newest-event-wins',
      title: 'The subscription always reflects the newest event received',
      why: 'An old event overwriting a newer one leaves a cancelled customer active, or the reverse.',
      check(state) {
        const current = subscription(state.db);
        const maxSeen = state.db.maxSeqSeen as number;
        return current.seq < maxSeen
          ? {
              message: `The subscription shows event #${current.seq} (${current.status}) although event #${maxSeen} was already received.`,
              paths: ['db.subscription', 'db.maxSeqSeen'],
            }
          : null;
      },
    },
    {
      id: 'once-per-event',
      title: 'Each event triggers its side effect at most once',
      why: 'A repeated delivery must not send a second email or grant access twice.',
      check(state) {
        const effects = counts(state.db, 'effects');
        const worst = Object.keys(effects)
          .sort()
          .find((key) => (effects[key] ?? 0) > 1);
        return worst
          ? {
              message: `The side effect of event "${worst}" ran ${effects[worst]} times.`,
              paths: ['db.effects'],
            }
          : null;
      },
    },
  ],
  presets: [
    {
      id: 'stale-event-overwrites',
      title: 'Events arrive out of order',
      summary: 'The cancellation arrives before the activation, which then overwrites it.',
      design: { ordering: 'last-write-wins', dedupe: 'off' },
      faults: faults({ reorder: true }),
      invariantId: 'newest-event-wins',
      expect: { status: 'violated', shortest: 4 },
    },
    {
      id: 'duplicate-event-double-effect',
      title: 'Duplicate delivery',
      summary: 'One event is delivered twice and its side effect runs twice.',
      design: { ordering: 'ignore-older', dedupe: 'off' },
      faults: faults({ duplicate: 1 }),
      invariantId: 'once-per-event',
      expect: { status: 'violated', shortest: 3 },
    },
    {
      id: 'guarded-safe',
      title: 'Sequence check and event ids, broad failures',
      summary:
        'Duplicates, a lost answer, a retry, a late retry, a crash, reordering and concurrency, one of each. Slow answers are off. Only the selected rule is checked; a crash can drop work without breaking a safety rule.',
      design: { ordering: 'ignore-older', dedupe: 'by-event-id' },
      faults: BROAD_FAULTS,
      limits: BROAD_LIMITS,
      invariantId: 'newest-event-wins',
      expect: { status: 'bounded-safe' },
    },
  ],
  dbLabels: {
    'db.subscription.status': 'Subscription status',
    'db.subscription.seq': 'Event behind that status',
    'db.maxSeqSeen': 'Newest event received',
    'db.effects': 'Side effects run, by event',
    'db.processed': 'Event ids claimed',
  },
  buildSpec(design): ProtocolSpec {
    const activate: OperationDef = {
      noun: 'activated event',
      steps: eventSteps({ seq: 1, status: 'active', effect: 'Sends the welcome email' }, design),
      respond: () => 'acknowledged',
    };
    const cancel: OperationDef = {
      noun: 'cancelled event',
      steps: eventSteps({ seq: 2, status: 'cancelled', effect: 'Revokes access' }, design),
      respond: () => 'acknowledged',
    };
    return {
      clients: [
        { id: 'event-1', label: 'Provider (activated)', op: 'activate', key: 'evt-1' },
        { id: 'event-2', label: 'Provider (cancelled)', op: 'cancel', key: 'evt-2' },
      ],
      initialDb: {
        subscription: { status: 'none', seq: 0 },
        maxSeqSeen: 0,
        effects: {},
        processed: {},
      },
      operations: { activate, cancel },
    };
  },
};
