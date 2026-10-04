import type { FaultSettings } from '@invariant-trail/contracts';
import { canonicalize } from '../canonical';
import type { Model, Transition, TransitionDescriptor } from '../model';
import type {
  ClientDef,
  HandlerState,
  InvariantDef,
  Message,
  OperationDef,
  ProtocolSpec,
  ProtocolState,
  RequestMessage,
  ResponseMessage,
  StepContext,
} from './types';

export function initialState(spec: ProtocolSpec, faults: FaultSettings): ProtocolState {
  const clients: ProtocolState['clients'] = {};
  for (const client of spec.clients) {
    clients[client.id] = { status: 'idle', attempts: 0, result: null };
  }
  return {
    db: spec.initialDb,
    clients,
    net: [],
    handlers: [],
    budget: {
      duplicate: faults.duplicate,
      lostResponse: faults.lostResponse,
      retry: faults.retry,
      lateRetry: faults.lateRetry,
      crash: faults.crash,
    },
  };
}

function withoutIndex<T>(list: T[], index: number): T[] {
  return list.filter((_, i) => i !== index);
}

/** First occurrence of every distinct message, so identical copies do not multiply transitions. */
function distinctIndexes(net: Message[], kind: Message['kind']): number[] {
  const seen = new Set<string>();
  const indexes: number[] = [];
  net.forEach((message, index) => {
    if (message.kind !== kind) return;
    const key = canonicalize(message);
    if (seen.has(key)) return;
    seen.add(key);
    indexes.push(index);
  });
  return indexes;
}

/**
 * Builds a deterministic model from a declarative protocol and failure settings.
 * See ADR 0002 for the semantics of each failure control.
 */
export function buildModel(
  spec: ProtocolSpec,
  faults: FaultSettings,
  invariant: InvariantDef,
): Model<ProtocolState> {
  const clientsById = new Map<string, ClientDef>(spec.clients.map((c) => [c.id, c]));
  const stepwise = faults.concurrent || faults.crash > 0;

  const operation = (op: string): OperationDef => {
    const found = spec.operations[op];
    if (!found) throw new Error(`unknown operation: ${op}`);
    return found;
  };

  const sortCanonical = <T>(items: T[]): T[] =>
    items
      .map((item) => ({ item, key: canonicalize(item) }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .map((entry) => entry.item);

  const normalize = (state: ProtocolState): ProtocolState => ({
    ...state,
    handlers: sortCanonical(state.handlers),
    net: faults.reorder ? sortCanonical(state.net) : state.net,
  });

  const trafficInFlight = (state: ProtocolState, client: string): boolean =>
    state.net.some((m) => m.client === client) || state.handlers.some((h) => h.client === client);

  /** Indexes of requests the service may receive next. */
  const deliverableRequests = (state: ProtocolState): number[] => {
    const all = distinctIndexes(state.net, 'request');
    return faults.reorder ? all : all.slice(0, 1);
  };

  /** Indexes of responses each client may receive next. */
  const deliverableResponses = (state: ProtocolState): number[] => {
    if (faults.reorder) return distinctIndexes(state.net, 'response');
    const seen = new Set<string>();
    const first: number[] = [];
    state.net.forEach((message, index) => {
      if (message.kind !== 'response' || seen.has(message.client)) return;
      seen.add(message.client);
      first.push(index);
    });
    return first;
  };

  const runStep = (
    state: ProtocolState,
    handler: HandlerState,
  ): { db: ProtocolState['db']; local: HandlerState['local']; note: string } => {
    const op = operation(handler.op);
    const step = op.steps[handler.step];
    if (!step) throw new Error(`operation ${handler.op} has no step ${handler.step}`);
    const context: StepContext = {
      db: state.db,
      local: handler.local,
      request: {
        client: handler.client,
        key: handler.key,
        attempt: handler.attempt,
        op: handler.op,
      },
    };
    const outcome = step.run(context);
    return {
      db: outcome.db ?? state.db,
      local: outcome.local ?? handler.local,
      note: outcome.note,
    };
  };

  const responseFor = (
    handler: HandlerState,
    db: ProtocolState['db'],
    local: HandlerState['local'],
  ): ResponseMessage => {
    const result = operation(handler.op).respond({
      db,
      local,
      request: {
        client: handler.client,
        key: handler.key,
        attempt: handler.attempt,
        op: handler.op,
      },
    });
    return { kind: 'response', client: handler.client, attempt: handler.attempt, result };
  };

  const clientLabel = (id: string): string => clientsById.get(id)?.label ?? id;

  const successors = (state: ProtocolState): Transition<ProtocolState>[] => {
    const out: Transition<ProtocolState>[] = [];
    const push = (descriptor: TransitionDescriptor, next: ProtocolState): void => {
      out.push({ ...descriptor, next: normalize(next) });
    };

    // 1. Clients send their first request.
    for (const client of spec.clients) {
      const status = state.clients[client.id];
      if (!status || status.status !== 'idle') continue;
      if (client.after && state.clients[client.after]?.status !== 'done') continue;
      const request: RequestMessage = {
        kind: 'request',
        client: client.id,
        attempt: 1,
        op: client.op,
        key: client.key,
      };
      push(
        {
          id: `send:${client.id}`,
          kind: 'action',
          actor: client.label,
          label: `${client.label} sends the ${operation(client.op).noun} request`,
          detail: `${client.label} sends ${operation(client.op).noun} request #1 and waits for an answer.`,
        },
        {
          ...state,
          clients: {
            ...state.clients,
            [client.id]: { status: 'waiting', attempts: 1, result: null },
          },
          net: [...state.net, request],
        },
      );
    }

    // 2. The service receives requests (and the duplicate variant that leaves a copy in flight).
    const mayReceive = faults.concurrent || state.handlers.length === 0;
    if (mayReceive) {
      for (const index of deliverableRequests(state)) {
        const message = state.net[index] as RequestMessage;
        const who = clientLabel(message.client);
        const noun = operation(message.op).noun;
        const variants: Array<{ duplicate: boolean }> = [{ duplicate: false }];
        if (state.budget.duplicate > 0) variants.push({ duplicate: true });
        for (const variant of variants) {
          const remaining = variant.duplicate ? state.net : withoutIndex(state.net, index);
          const budget = variant.duplicate
            ? { ...state.budget, duplicate: state.budget.duplicate - 1 }
            : state.budget;
          const descriptor: TransitionDescriptor = variant.duplicate
            ? {
                id: `deliver-dup:${index}`,
                kind: 'fault',
                actor: 'Network',
                fault: 'duplicate',
                label: `Network delivers ${who}'s ${noun} request #${message.attempt} and keeps a copy`,
                detail: `The service receives the request, but the network also leaves a copy in flight that will be delivered again.`,
              }
            : {
                id: `deliver:${index}`,
                kind: 'action',
                actor: 'Network',
                label: `Service receives ${who}'s ${noun} request #${message.attempt}`,
                detail: `The network delivers request #${message.attempt} from ${who} to the service.`,
              };
          const handler: HandlerState = {
            client: message.client,
            attempt: message.attempt,
            op: message.op,
            key: message.key,
            step: 0,
            local: {},
          };
          if (stepwise) {
            push(descriptor, {
              ...state,
              net: remaining,
              budget,
              handlers: [...state.handlers, handler],
            });
          } else {
            let db = state.db;
            let local = handler.local;
            const notes: string[] = [];
            const steps = operation(message.op).steps;
            for (let i = 0; i < steps.length; i++) {
              const result = runStep({ ...state, db }, { ...handler, step: i, local });
              db = result.db;
              local = result.local;
              notes.push(result.note);
            }
            const response = responseFor(handler, db, local);
            push(
              {
                ...descriptor,
                detail: `${descriptor.detail} Handling it, in one atomic unit: ${notes.join(' ')}`,
              },
              { ...state, db, net: [...remaining, response], budget },
            );
          }
        }
      }
    }

    // 3. Running handlers take their next step.
    state.handlers.forEach((handler, index) => {
      const op = operation(handler.op);
      const step = op.steps[handler.step];
      if (!step) return;
      const result = runStep(state, handler);
      const who = clientLabel(handler.client);
      const descriptor: TransitionDescriptor = {
        id: `step:${index}`,
        kind: 'action',
        actor: 'Service',
        label: `Service step "${step.name}" for ${who}'s request #${handler.attempt}`,
        detail: result.note,
      };
      const isLast = handler.step === op.steps.length - 1;
      if (isLast) {
        push(descriptor, {
          ...state,
          db: result.db,
          handlers: withoutIndex(state.handlers, index),
          net: [...state.net, responseFor(handler, result.db, result.local)],
        });
      } else {
        const updated: HandlerState = { ...handler, step: handler.step + 1, local: result.local };
        push(descriptor, {
          ...state,
          db: result.db,
          handlers: state.handlers.map((h, i) => (i === index ? updated : h)),
        });
      }
    });

    // 4. Clients receive responses.
    for (const index of deliverableResponses(state)) {
      const message = state.net[index] as ResponseMessage;
      const who = clientLabel(message.client);
      const current = state.clients[message.client];
      if (!current) continue;
      const finishes = current.status === 'waiting';
      push(
        {
          id: `receive:${index}`,
          kind: 'action',
          actor: 'Network',
          label: finishes
            ? `${who} receives the answer "${message.result}"`
            : `${who} receives another answer "${message.result}" and ignores it (it already finished or gave up)`,
          detail: finishes
            ? `${who} now knows the outcome and stops waiting.`
            : `${who} already finished or gave up, so the late answer changes nothing.`,
        },
        {
          ...state,
          net: withoutIndex(state.net, index),
          clients: finishes
            ? {
                ...state.clients,
                [message.client]: { ...current, status: 'done', result: message.result },
              }
            : state.clients,
        },
      );
    }

    // 5. Timeouts: the client may retry while budget remains, or give up. Both are always offered.
    for (const client of spec.clients) {
      const current = state.clients[client.id];
      if (!current || current.status !== 'waiting') continue;
      if (!faults.delay && trafficInFlight(state, client.id)) continue;
      if (state.budget.retry > 0) {
        const attempt = current.attempts + 1;
        const request: RequestMessage = {
          kind: 'request',
          client: client.id,
          attempt,
          op: client.op,
          key: client.key,
        };
        push(
          {
            id: `retry:${client.id}`,
            kind: 'action',
            actor: client.label,
            label: `${client.label} times out and retries (request #${attempt})`,
            detail: `No answer arrived in time, so ${client.label} sends the same request again with the same key.`,
          },
          {
            ...state,
            budget: { ...state.budget, retry: state.budget.retry - 1 },
            clients: { ...state.clients, [client.id]: { ...current, attempts: attempt } },
            net: [...state.net, request],
          },
        );
      }
      {
        push(
          {
            id: `give-up:${client.id}`,
            kind: 'action',
            actor: client.label,
            label: `${client.label} times out and gives up`,
            detail: `No answer arrived in time, so ${client.label} stops waiting and sends nothing more.`,
          },
          {
            ...state,
            clients: { ...state.clients, [client.id]: { ...current, status: 'gave-up' } },
          },
        );
      }
    }

    // 6. Late retries from stale timers.
    if (state.budget.lateRetry > 0) {
      for (const client of spec.clients) {
        const current = state.clients[client.id];
        if (!current || (current.status !== 'done' && current.status !== 'gave-up')) continue;
        const attempt = current.attempts + 1;
        const request: RequestMessage = {
          kind: 'request',
          client: client.id,
          attempt,
          op: client.op,
          key: client.key,
        };
        push(
          {
            id: `late-retry:${client.id}`,
            kind: 'fault',
            actor: client.label,
            fault: 'lateRetry',
            label: `A stale retry from ${client.label} fires late (request #${attempt})`,
            detail: `${client.label} had already ${current.status === 'done' ? 'finished' : 'given up'}, but an old retry timer still sends the request again.`,
          },
          {
            ...state,
            budget: { ...state.budget, lateRetry: state.budget.lateRetry - 1 },
            clients: { ...state.clients, [client.id]: { ...current, attempts: attempt } },
            net: [...state.net, request],
          },
        );
      }
    }

    // 7. Fault injections: lost responses and crashes.
    if (state.budget.lostResponse > 0) {
      for (const index of distinctIndexes(state.net, 'response')) {
        const message = state.net[index] as ResponseMessage;
        push(
          {
            id: `drop:${index}`,
            kind: 'fault',
            actor: 'Network',
            fault: 'lostResponse',
            label: `Network loses the answer "${message.result}" for ${clientLabel(message.client)}`,
            detail: `The service already did its work, but the answer never reaches ${clientLabel(message.client)}.`,
          },
          {
            ...state,
            net: withoutIndex(state.net, index),
            budget: { ...state.budget, lostResponse: state.budget.lostResponse - 1 },
          },
        );
      }
    }
    if (state.budget.crash > 0) {
      const midway = state.handlers.some(
        (h) => h.step >= 1 && h.step < operation(h.op).steps.length,
      );
      if (midway) {
        push(
          {
            id: 'crash',
            kind: 'fault',
            actor: 'Service',
            fault: 'crash',
            label: 'Service crashes between two writes',
            detail:
              'Writes already made stay stored. Work in progress and its pending answer are lost, and the service restarts immediately.',
          },
          {
            ...state,
            handlers: [],
            budget: { ...state.budget, crash: state.budget.crash - 1 },
          },
        );
      }
    }

    return out;
  };

  return {
    invariantId: invariant.id,
    initial: normalize(initialState(spec, faults)),
    successors,
    invariant: (state) => invariant.check(state),
  };
}
