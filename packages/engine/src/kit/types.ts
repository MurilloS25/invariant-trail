import type { Json, Violation } from '@invariant-trail/contracts';

export type Obj = { [key: string]: Json };

export type ClientStatus = 'idle' | 'waiting' | 'done' | 'gave-up';

export type RequestMessage = {
  kind: 'request';
  client: string;
  attempt: number;
  op: string;
  key: string;
};
export type ResponseMessage = { kind: 'response'; client: string; attempt: number; result: string };
export type Message = RequestMessage | ResponseMessage;

export type ClientState = { status: ClientStatus; attempts: number; result: string | null };

export type HandlerState = {
  client: string;
  attempt: number;
  op: string;
  key: string;
  /** Index of the next step to run. */
  step: number;
  /** In-memory values that die with the process on a crash. */
  local: Obj;
};

export type Budget = {
  duplicate: number;
  lostResponse: number;
  retry: number;
  lateRetry: number;
  crash: number;
};

/** The complete state of a protocol model. Everything that affects successors is in here. */
export type ProtocolState = {
  /** Durable data owned by the service. */
  db: Obj;
  clients: Record<string, ClientState>;
  /** Messages in flight. Ordered while delivery order matters, canonically sorted otherwise. */
  net: Message[];
  handlers: HandlerState[];
  /** Remaining failure budget; only ever decreases. */
  budget: Budget;
};

export interface RequestInfo {
  client: string;
  key: string;
  attempt: number;
  op: string;
}

export interface StepContext {
  db: Obj;
  local: Obj;
  request: RequestInfo;
}

export interface StepOutcome {
  db?: Obj;
  local?: Obj;
  /** One plain sentence about what this step read or wrote. */
  note: string;
}

export interface StepDef {
  name: string;
  run(context: StepContext): StepOutcome;
}

export interface OperationDef {
  /** Short noun phrase used in messages, for example "confirmation". */
  noun: string;
  steps: StepDef[];
  /** Result string that travels back to the client. */
  respond(context: StepContext): string;
}

export interface ClientDef {
  id: string;
  /** Display name, for example "Guest". */
  label: string;
  op: string;
  /** Idempotency key sent with every attempt. */
  key: string;
  /** The client only starts after this other client has finished successfully. */
  after?: string;
}

export interface ProtocolSpec {
  clients: ClientDef[];
  initialDb: Obj;
  operations: Record<string, OperationDef>;
}

export interface InvariantDef {
  id: string;
  /** Rule in plain language, phrased as something that must always hold. */
  title: string;
  /** One sentence on why the rule matters. */
  why: string;
  check(state: ProtocolState): Violation | null;
}
