import type { Obj, OperationDef, ProtocolSpec, StepDef } from '../kit/types';
import { BROAD_FAULTS, BROAD_LIMITS, faults, type TemplateDef } from './types';

const INITIAL_STOCK = 1;

const stock = (db: Obj): number => db.stock as number;
const orders = (db: Obj): string[] => db.orders as string[];

function createOrder(): StepDef {
  return {
    name: 'Create the order',
    run({ db, local, request }) {
      if (local.reserved !== true) return { note: 'No unit was reserved, so no order is created.' };
      return {
        db: { ...db, orders: [...orders(db), request.client] },
        note: 'Creates the order for the reserved unit.',
      };
    },
  };
}

function steps(writes: string): StepDef[] {
  if (writes === 'transactional') {
    return [
      {
        name: 'Reserve and create the order together',
        run({ db, request }) {
          if (stock(db) <= 0)
            return {
              local: { reserved: false },
              note: 'No stock is left, so nothing is reserved.',
            };
          return {
            db: { ...db, stock: stock(db) - 1, orders: [...orders(db), request.client] },
            local: { reserved: true },
            note: 'In one transaction: takes a unit from stock and creates the order.',
          };
        },
      },
    ];
  }
  if (writes === 'conditional-decrement') {
    return [
      {
        name: 'Take a unit if available',
        run({ db }) {
          if (stock(db) <= 0)
            return {
              local: { reserved: false },
              note: 'Stock is 0, so the conditional update takes nothing.',
            };
          return {
            db: { ...db, stock: stock(db) - 1 },
            local: { reserved: true },
            note: `Atomically takes a unit from stock (${stock(db) - 1} left).`,
          };
        },
      },
      createOrder(),
    ];
  }
  return [
    {
      name: 'Read stock',
      run({ db }) {
        return { local: { seen: stock(db) }, note: `Reads the stock level: ${stock(db)}.` };
      },
    },
    {
      name: 'Decrease stock if the read showed some',
      run({ db, local }) {
        if ((local.seen as number) <= 0) {
          return {
            local: { ...local, reserved: false },
            note: 'The earlier read showed no stock, so nothing is reserved.',
          };
        }
        return {
          db: { ...db, stock: stock(db) - 1 },
          local: { ...local, reserved: true },
          note: `The earlier read showed stock, so it subtracts one (${stock(db) - 1} left), even if stock changed since.`,
        };
      },
    },
    createOrder(),
  ];
}

export const inventoryTemplate: TemplateDef = {
  id: 'inventory-order',
  title: 'Inventory reservation and order',
  tagline: 'Two buyers want the last unit. Reserve it, create the order, never sell it twice.',
  story:
    'A shop has one unit left. Two buyers each place an order. The service takes the unit from stock and then creates the order. If the steps are not atomic, concurrent buyers or a crash between the steps can oversell the unit or lose it.',
  actors: [
    { name: 'Buyer A', role: 'Places an order and retries when no answer arrives.' },
    { name: 'Buyer B', role: 'Places an order for the same last unit.' },
    { name: 'Order service', role: 'Takes a unit from stock and creates the order.' },
  ],
  lifecycle: {
    nodes: [
      { id: 'available', label: 'Available' },
      { id: 'reserved', label: 'Reserved' },
      { id: 'ordered', label: 'Ordered' },
    ],
    grid: {
      wide: { available: [0, 0], reserved: [1, 0], ordered: [2, 0] },
      narrow: { available: [0, 0], reserved: [0, 1], ordered: [0, 2] },
    },
    edges: [
      { from: 'available', to: 'reserved', label: 'take from stock' },
      { from: 'reserved', to: 'ordered', label: 'create order' },
    ],
    current(db) {
      if (orders(db).length > 0) return 'ordered';
      return stock(db) < INITIAL_STOCK ? 'reserved' : 'available';
    },
  },
  designOptions: [
    {
      id: 'writes',
      label: 'How stock and order are written',
      help: 'Decides how the service takes a unit and records the order.',
      defaultChoice: 'check-then-decrement',
      choices: [
        {
          id: 'check-then-decrement',
          label: 'Read, subtract, then create order',
          help: 'Three separate steps. Other work can run between them.',
        },
        {
          id: 'conditional-decrement',
          label: 'Conditional subtract, then create order',
          help: 'The unit is taken atomically, but the order is a separate write.',
        },
        {
          id: 'transactional',
          label: 'One transaction',
          help: 'Taking the unit and creating the order succeed or fail together.',
        },
      ],
    },
  ],
  invariants: [
    {
      id: 'no-oversell',
      title: 'Never sell more units than are in stock',
      why: 'Selling a unit that does not exist means refunds, apologies, and lost trust.',
      check(state) {
        const taken = INITIAL_STOCK - stock(state.db);
        if (stock(state.db) < 0 || orders(state.db).length > INITIAL_STOCK) {
          return {
            message: `${Math.max(taken, orders(state.db).length)} units were promised although only ${INITIAL_STOCK} existed.`,
            paths: ['db.stock', 'db.orders'],
          };
        }
        return null;
      },
    },
    {
      id: 'no-leaked-unit',
      title: 'A unit taken from stock always has an order or someone working on it',
      why: 'A unit that left stock without an order is invisible: nobody can buy it and nobody owns it.',
      check(state) {
        const taken = INITIAL_STOCK - stock(state.db);
        const working = state.handlers.filter((h) => h.local.reserved === true).length;
        if (taken > orders(state.db).length + working) {
          return {
            message: 'A unit left stock but has no order and nothing is working on it.',
            paths: ['db.stock', 'db.orders'],
          };
        }
        return null;
      },
    },
  ],
  presets: [
    {
      id: 'two-buyers-one-unit',
      title: 'Two buyers, one unit',
      summary: 'Both buyers read "1 left" before either subtracts, so stock goes below zero.',
      design: { writes: 'check-then-decrement' },
      faults: faults({ concurrent: true }),
      invariantId: 'no-oversell',
      expect: { status: 'violated', shortest: 8 },
    },
    {
      id: 'crash-leaks-reservation',
      title: 'Crash between subtract and order',
      summary: 'The service crashes after taking the unit but before creating the order.',
      design: { writes: 'conditional-decrement' },
      faults: faults({ crash: 1 }),
      invariantId: 'no-leaked-unit',
      expect: { status: 'violated', shortest: 4 },
    },
    {
      id: 'transaction-safe',
      title: 'One transaction, broad failures',
      summary:
        'Duplicates, a lost answer, a retry, a late retry, a crash, reordering and concurrency, one of each. Slow answers are off. Only the selected rule is checked; a crash can drop work without breaking a safety rule.',
      design: { writes: 'transactional' },
      faults: BROAD_FAULTS,
      limits: BROAD_LIMITS,
      invariantId: 'no-oversell',
      expect: { status: 'bounded-safe' },
    },
  ],
  dbLabels: {
    'db.stock': 'Units in stock',
    'db.orders': 'Orders created',
  },
  buildSpec(design): ProtocolSpec {
    const placeOrder: OperationDef = {
      noun: 'order',
      steps: steps(design.writes ?? 'check-then-decrement'),
      respond: ({ local }) => (local.reserved === true ? 'ordered' : 'sold-out'),
    };
    return {
      clients: [
        { id: 'buyer-a', label: 'Buyer A', op: 'place-order', key: 'order-a' },
        { id: 'buyer-b', label: 'Buyer B', op: 'place-order', key: 'order-b' },
      ],
      initialDb: { stock: INITIAL_STOCK, orders: [] },
      operations: { 'place-order': placeOrder },
    };
  },
};
