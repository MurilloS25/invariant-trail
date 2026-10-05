import type { Obj, OperationDef, ProtocolSpec } from '../kit/types';
import { BROAD_FAULTS, BROAD_LIMITS, faults, type TemplateDef } from './types';

const ORDER_TOTAL = 40;

type Processor = { chargedTotal: number; refundedTotal: number; keys: { [key: string]: boolean } };
type Ledger = { status: string };

const processor = (db: Obj): Processor => db.processor as Processor;
const ledger = (db: Obj): Ledger => db.ledger as Ledger;

export const paymentTemplate: TemplateDef = {
  id: 'payment-refund',
  title: 'Payment capture and refund',
  tagline: 'Charge a card once, refund it once, even when requests repeat or the service crashes.',
  story:
    'A shop captures a card payment of 40 and, once the capture succeeds, refunds it. The card processor holds the real money; the shop keeps its own ledger. Retries and crashes between the two writes can make the processor and the ledger disagree.',
  actors: [
    {
      name: 'Capture request',
      role: 'Asks the service to charge the card and retries on silence.',
    },
    {
      name: 'Refund request',
      role: 'Starts after the capture succeeded and asks for the money back.',
    },
    {
      name: 'Payment service',
      role: 'Calls the card processor, then records the result in the shop ledger.',
    },
  ],
  lifecycle: {
    nodes: [
      { id: 'authorized', label: 'Authorized' },
      { id: 'captured', label: 'Captured' },
      { id: 'refunded', label: 'Refunded' },
    ],
    grid: {
      wide: { authorized: [0, 0], captured: [1, 0], refunded: [2, 0] },
      narrow: { authorized: [0, 0], captured: [0, 1], refunded: [0, 2] },
    },
    edges: [
      { from: 'authorized', to: 'captured', label: 'capture' },
      { from: 'captured', to: 'refunded', label: 'refund' },
    ],
    current: (db) => ledger(db).status,
  },
  designOptions: [
    {
      id: 'idempotency',
      label: 'Idempotency key at the processor',
      help: 'When on, the processor remembers each request key and ignores repeats.',
      defaultChoice: 'off',
      choices: [
        { id: 'off', label: 'Off', help: 'Every request that reaches the processor moves money.' },
        {
          id: 'on',
          label: 'On',
          help: 'A repeated key is recognised and does not move money again.',
        },
      ],
    },
  ],
  invariants: [
    {
      id: 'no-double-charge',
      title: 'The customer is never charged more than the order total',
      why: 'Charging twice takes money the customer did not agree to pay.',
      check(state) {
        const charged = processor(state.db).chargedTotal;
        return charged > ORDER_TOTAL
          ? {
              message: `The customer was charged ${charged} for an order of ${ORDER_TOTAL}.`,
              paths: ['db.processor.chargedTotal'],
            }
          : null;
      },
    },
    {
      id: 'refund-within-charged',
      title: 'The shop never refunds more than it charged',
      why: 'Refunding extra money is a direct loss.',
      check(state) {
        const p = processor(state.db);
        return p.refundedTotal > p.chargedTotal
          ? {
              message: `${p.refundedTotal} was refunded although only ${p.chargedTotal} was charged.`,
              paths: ['db.processor.refundedTotal', 'db.processor.chargedTotal'],
            }
          : null;
      },
    },
  ],
  presets: [
    {
      id: 'double-refund',
      title: 'Duplicate refund, processed concurrently',
      summary:
        'The refund request is delivered twice and both copies are processed at the same time.',
      design: { idempotency: 'off' },
      faults: faults({ duplicate: 1, concurrent: true }),
      invariantId: 'refund-within-charged',
      expect: { status: 'violated', shortest: 12 },
    },
    {
      id: 'charged-twice-after-crash',
      title: 'Crash after charging, then a retry',
      summary: 'The service crashes after the processor charged but before the ledger was written.',
      design: { idempotency: 'off' },
      faults: faults({ crash: 1, retry: 1 }),
      invariantId: 'no-double-charge',
      expect: { status: 'violated', shortest: 7 },
    },
    {
      id: 'idempotent-safe',
      title: 'Idempotency keys, broad failures',
      summary:
        'Duplicates, a lost answer, a retry, a late retry, a crash, reordering and concurrency, one of each. Slow answers are off. Only the selected rule is checked; a crash can drop work without breaking a safety rule.',
      design: { idempotency: 'on' },
      faults: BROAD_FAULTS,
      limits: BROAD_LIMITS,
      invariantId: 'refund-within-charged',
      expect: { status: 'bounded-safe' },
    },
  ],
  dbLabels: {
    'db.processor.chargedTotal': 'Money charged at processor',
    'db.processor.refundedTotal': 'Money refunded at processor',
    'db.processor.keys': 'Keys the processor remembers',
    'db.ledger.status': 'Shop ledger status',
  },
  buildSpec(design): ProtocolSpec {
    const keyed = design.idempotency === 'on';
    const capture: OperationDef = {
      noun: 'capture',
      steps: [
        {
          name: 'Charge the card at the processor',
          run({ db, request }) {
            const p = processor(db);
            if (keyed && p.keys[request.key]) {
              return {
                note: `The processor recognises key "${request.key}" and does not charge again.`,
              };
            }
            const next: Processor = {
              ...p,
              chargedTotal: p.chargedTotal + ORDER_TOTAL,
              keys: keyed ? { ...p.keys, [request.key]: true } : p.keys,
            };
            return {
              db: { ...db, processor: next },
              note: `The processor charges ${ORDER_TOTAL} (${next.chargedTotal} charged in total).`,
            };
          },
        },
        {
          name: 'Record the capture in the ledger',
          run({ db }) {
            if (ledger(db).status !== 'authorized') {
              return { note: `The ledger already says ${ledger(db).status}, so it is left alone.` };
            }
            return {
              db: { ...db, ledger: { status: 'captured' } },
              note: 'The ledger now says captured.',
            };
          },
        },
      ],
      respond: () => 'captured',
    };
    const refund: OperationDef = {
      noun: 'refund',
      steps: [
        {
          name: 'Check the payment was captured',
          run({ db }) {
            const ok = ledger(db).status === 'captured';
            return {
              local: { ok },
              note: ok
                ? 'The ledger says captured, so a refund is allowed.'
                : `The ledger says ${ledger(db).status}, so no refund is allowed.`,
            };
          },
        },
        {
          name: 'Refund at the processor',
          run({ db, local, request }) {
            if (local.ok !== true)
              return { note: 'The refund was not allowed, so no money moves.' };
            const p = processor(db);
            if (keyed && p.keys[request.key]) {
              return {
                note: `The processor recognises key "${request.key}" and does not refund again.`,
              };
            }
            const next: Processor = {
              ...p,
              refundedTotal: p.refundedTotal + ORDER_TOTAL,
              keys: keyed ? { ...p.keys, [request.key]: true } : p.keys,
            };
            return {
              db: { ...db, processor: next },
              note: `The processor refunds ${ORDER_TOTAL} (${next.refundedTotal} refunded in total).`,
            };
          },
        },
        {
          name: 'Record the refund in the ledger',
          run({ db, local }) {
            if (local.ok !== true) return { note: 'Nothing to record.' };
            return {
              db: { ...db, ledger: { status: 'refunded' } },
              note: 'The ledger now says refunded.',
            };
          },
        },
      ],
      respond: ({ local }) => (local.ok === true ? 'refunded' : 'rejected'),
    };
    return {
      clients: [
        { id: 'capture', label: 'Capture request', op: 'capture', key: 'capture-1' },
        { id: 'refund', label: 'Refund request', op: 'refund', key: 'refund-1', after: 'capture' },
      ],
      initialDb: {
        processor: { chargedTotal: 0, refundedTotal: 0, keys: {} },
        ledger: { status: 'authorized' },
      },
      operations: { capture, refund },
    };
  },
};
