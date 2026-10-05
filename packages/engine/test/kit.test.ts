import { NO_FAULTS, type FaultSettings } from '@invariant-trail/contracts';
import { describe, expect, it } from 'vitest';
import {
  buildModel,
  canonicalize,
  explore,
  replayTrace,
  type InvariantDef,
  type Model,
  type Obj,
  type ProtocolSpec,
  type ProtocolState,
} from '../src';
import { ROOMY } from './helpers';

const f = (partial: Partial<FaultSettings>): FaultSettings => ({ ...NO_FAULTS, ...partial });

/** Non-idempotent counter: every handled request adds one. */
const counterSpec: ProtocolSpec = {
  clients: [{ id: 'c', label: 'Client', op: 'inc', key: 'k' }],
  initialDb: { counter: 0 },
  operations: {
    inc: {
      noun: 'increment',
      steps: [
        {
          name: 'Add one',
          run: ({ db }) => ({ db: { counter: (db.counter as number) + 1 }, note: 'adds one' }),
        },
      ],
      respond: () => 'ok',
    },
  },
};

const atMostOnce: InvariantDef = {
  id: 'at-most-once',
  title: 'counter <= 1',
  why: 'test',
  check: (s) =>
    (s.db.counter as number) > 1
      ? { message: `counter is ${String(s.db.counter)}`, paths: ['db.counter'] }
      : null,
};

/** Idempotent via read-then-write; concurrency can break the check. */
const readWriteSpec: ProtocolSpec = {
  clients: counterSpec.clients,
  initialDb: { counter: 0, done: false },
  operations: {
    inc: {
      noun: 'increment',
      steps: [
        {
          name: 'Read done flag',
          run: ({ db }) => ({ local: { seen: db.done as boolean }, note: 'reads' }),
        },
        {
          name: 'Write if not done',
          run: ({ db, local }) =>
            local.seen === true
              ? { note: 'skips' }
              : { db: { counter: (db.counter as number) + 1, done: true }, note: 'writes' },
        },
      ],
      respond: () => 'ok',
    },
  },
};

/** Two writes that must stay together. */
const pairSpec: ProtocolSpec = {
  clients: counterSpec.clients,
  initialDb: { a: false, b: false },
  operations: {
    inc: {
      noun: 'pair write',
      steps: [
        { name: 'Write A', run: ({ db }) => ({ db: { ...db, a: true }, note: 'writes A' }) },
        { name: 'Write B', run: ({ db }) => ({ db: { ...db, b: true }, note: 'writes B' }) },
      ],
      respond: () => 'ok',
    },
  },
};
const pairTogether: InvariantDef = {
  id: 'pair',
  title: 'a equals b',
  why: 'test',
  // Only judged while nothing is running: mid-handler divergence is normal.
  check: (s) =>
    s.handlers.length === 0 && s.db.a !== s.db.b
      ? { message: 'a and b differ', paths: ['db.a', 'db.b'] }
      : null,
};

/** Two writes where the first is the non-idempotent effect, so crash + retry repeats it. */
const effectThenRecord: ProtocolSpec = {
  clients: counterSpec.clients,
  initialDb: { counter: 0, recorded: false },
  operations: {
    inc: {
      noun: 'effect',
      steps: [
        {
          name: 'Effect',
          run: ({ db }) => ({ db: { ...db, counter: (db.counter as number) + 1 }, note: 'effect' }),
        },
        { name: 'Record', run: ({ db }) => ({ db: { ...db, recorded: true }, note: 'record' }) },
      ],
      respond: () => 'ok',
    },
  },
};

function shortest(
  spec: ProtocolSpec,
  faults: FaultSettings,
  invariant: InvariantDef,
): number | 'safe' | 'other' {
  const model = buildModel(spec, faults, invariant);
  const outcome = explore(model, ROOMY);
  if (outcome.status === 'bounded-safe') return 'safe';
  if (outcome.status !== 'violated') return 'other';
  expect(replayTrace(model, outcome.counterexample).ok).toBe(true);
  return outcome.counterexample.steps.length;
}

describe('failure semantics, in isolation', () => {
  it('without failures the protocol runs to completion and stays safe', () => {
    expect(shortest(counterSpec, f({}), atMostOnce)).toBe('safe');
  });

  it('duplicate delivery repeats a non-idempotent effect: send, deliver-with-copy, deliver copy', () => {
    expect(shortest(counterSpec, f({ duplicate: 1 }), atMostOnce)).toBe(3);
  });

  it('a lost response alone is safe: the client just gives up', () => {
    expect(shortest(counterSpec, f({ lostResponse: 1 }), atMostOnce)).toBe('safe');
  });

  it('a lost response plus a retry repeats the effect: send, deliver, lose, retry, deliver', () => {
    expect(shortest(counterSpec, f({ lostResponse: 1, retry: 1 }), atMostOnce)).toBe(5);
  });

  it('a retry without delay needs silence: with no loss it cannot fire early', () => {
    expect(shortest(counterSpec, f({ retry: 1 }), atMostOnce)).toBe('safe');
  });

  it('delay lets the timeout fire while traffic is in flight: send, retry, deliver, deliver', () => {
    expect(shortest(counterSpec, f({ delay: true, retry: 1 }), atMostOnce)).toBe(4);
  });

  it('a late retry after completion repeats the effect: send, deliver, receive, late retry, deliver', () => {
    expect(shortest(counterSpec, f({ lateRetry: 1 }), atMostOnce)).toBe(5);
  });

  it('a crash between two writes breaks their atomicity: send, deliver, write A, crash', () => {
    expect(shortest(pairSpec, f({}), pairTogether)).toBe('safe');
    expect(shortest(pairSpec, f({ crash: 1 }), pairTogether)).toBe(4);
  });

  it('crash alone or retry alone does not repeat the effect, the combination does', () => {
    expect(shortest(effectThenRecord, f({ crash: 1 }), atMostOnce)).toBe('safe');
    expect(shortest(effectThenRecord, f({ retry: 1 }), atMostOnce)).toBe('safe');
    // send, deliver, effect, crash, retry, deliver, effect
    expect(shortest(effectThenRecord, f({ crash: 1, retry: 1 }), atMostOnce)).toBe(7);
  });

  it('concurrency exposes check-then-write races; atomic and one-at-a-time handlers do not', () => {
    expect(shortest(readWriteSpec, f({ duplicate: 1 }), atMostOnce)).toBe('safe');
    expect(shortest(readWriteSpec, f({ duplicate: 1, crash: 1 }), atMostOnce)).toBe('safe');
    // send, deliver-with-copy, deliver copy, read, read, write, write
    expect(shortest(readWriteSpec, f({ duplicate: 1, concurrent: true }), atMostOnce)).toBe(7);
  });
});

describe('ordering semantics', () => {
  const twoClients: ProtocolSpec = {
    ...counterSpec,
    clients: [
      { id: 'a', label: 'A', op: 'inc', key: 'ka' },
      { id: 'b', label: 'B', op: 'inc', key: 'kb' },
    ],
  };

  function afterBothSend(faults: FaultSettings): ProtocolState {
    const model = buildModel(twoClients, faults, atMostOnce);
    let state = model.initial;
    for (const id of ['send:a', 'send:b']) {
      state = model.successors(state).find((t) => t.id === id)!.next;
    }
    return state;
  }

  it('delivers only the oldest request unless reordering is on', () => {
    const fifo = buildModel(twoClients, f({}), atMostOnce);
    const free = buildModel(twoClients, f({ reorder: true }), atMostOnce);
    const delivers = (m: Model<ProtocolState>, s: ProtocolState) =>
      m.successors(s).filter((t) => t.id.startsWith('deliver:'));
    expect(delivers(fifo, afterBothSend(f({})))).toHaveLength(1);
    expect(delivers(free, afterBothSend(f({ reorder: true })))).toHaveLength(2);
  });

  it('treats equivalent in-flight orders as one state when reordering is on', () => {
    const model = buildModel(twoClients, f({ reorder: true }), atMostOnce);
    const s0 = model.initial;
    const viaAB = ['send:a', 'send:b'].reduce(
      (s, id) => model.successors(s).find((t) => t.id === id)!.next,
      s0,
    );
    const viaBA = ['send:b', 'send:a'].reduce(
      (s, id) => model.successors(s).find((t) => t.id === id)!.next,
      s0,
    );
    expect(canonicalize(viaAB)).toBe(canonicalize(viaBA));
    const fifo = buildModel(twoClients, f({}), atMostOnce);
    const ab = ['send:a', 'send:b'].reduce(
      (s, id) => fifo.successors(s).find((t) => t.id === id)!.next,
      fifo.initial,
    );
    const ba = ['send:b', 'send:a'].reduce(
      (s, id) => fifo.successors(s).find((t) => t.id === id)!.next,
      fifo.initial,
    );
    expect(canonicalize(ab)).not.toBe(canonicalize(ba));
  });
});

describe('model hygiene under every failure at once', () => {
  const everything = f({
    duplicate: 1,
    lostResponse: 1,
    delay: true,
    reorder: true,
    concurrent: true,
    crash: 1,
    retry: 1,
    lateRetry: 1,
  });

  function deepFreeze<T>(value: T): T {
    if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
      Object.freeze(value);
      Object.values(value as Obj).forEach(deepFreeze);
    }
    return value;
  }

  it('keeps budgets non-negative and non-increasing, never mutates input states, stays canonical', () => {
    const model = buildModel(readWriteSpec, everything, atMostOnce);
    const seen = new Set<string>();
    const queue: ProtocolState[] = [model.initial];
    let checked = 0;
    while (queue.length > 0 && checked < 3000) {
      const state = deepFreeze(queue.shift()!);
      const key = canonicalize(state);
      if (seen.has(key)) continue;
      seen.add(key);
      checked++;
      for (const t of model.successors(state)) {
        for (const name of Object.keys(t.next.budget) as Array<keyof ProtocolState['budget']>) {
          expect(t.next.budget[name]).toBeGreaterThanOrEqual(0);
          expect(t.next.budget[name]).toBeLessThanOrEqual(state.budget[name]);
        }
        expect(() => canonicalize(t.next)).not.toThrow();
        const sorted = [...t.next.net].map((m) => canonicalize(m)).sort();
        expect(t.next.net.map((m) => canonicalize(m))).toEqual(sorted);
        queue.push(t.next);
      }
    }
    expect(checked).toBeGreaterThan(500);
  });

  it('is deterministic: two models from the same inputs explore identically', () => {
    const a = explore(buildModel(readWriteSpec, everything, atMostOnce), {
      ...ROOMY,
      maxStates: 2000,
    });
    const b = explore(buildModel(readWriteSpec, everything, atMostOnce), {
      ...ROOMY,
      maxStates: 2000,
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('give-up and late answers', () => {
  const step = (model: Model<ProtocolState>, state: ProtocolState, id: string): ProtocolState => {
    const found = model.successors(state).find((t) => t.id === id);
    if (!found) throw new Error(`transition ${id} not enabled`);
    return found.next;
  };

  it('offers give-up alongside retry while retries remain', () => {
    const model = buildModel(counterSpec, f({ lostResponse: 1, retry: 1 }), atMostOnce);
    let s = step(model, model.initial, 'send:c');
    s = step(model, s, 'deliver:0');
    s = step(model, s, 'drop:0');
    const ids = model.successors(s).map((t) => t.id);
    expect(ids).toContain('retry:c');
    expect(ids).toContain('give-up:c');
  });

  it('keeps a client that gave up in that state when a late answer arrives', () => {
    const model = buildModel(counterSpec, f({ delay: true }), atMostOnce);
    let s = step(model, model.initial, 'send:c');
    s = step(model, s, 'give-up:c');
    s = step(model, s, 'deliver:0');
    s = step(model, s, 'receive:0');
    expect(s.clients.c?.status).toBe('gave-up');
  });
});
