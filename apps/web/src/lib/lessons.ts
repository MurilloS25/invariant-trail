import {
  DEFAULT_LIMITS,
  REQUEST_VERSION,
  type ExplorationRequest,
  type FaultSettings,
} from '@invariant-trail/contracts';
import { NO_FAULTS } from '@invariant-trail/contracts';

export interface GlossaryEntry {
  term: string;
  definition: string;
}

/** Short definitions shown next to the lesson that needs them. */
export const GLOSSARY = {
  safetyRule: {
    term: 'Safety rule (also called an invariant)',
    definition:
      'Something that must be true at every moment, such as "never charge a customer twice".',
  },
  idempotency: {
    term: 'Idempotency',
    definition:
      'An operation is idempotent when doing it twice has the same effect as doing it once. It is what makes retrying safe.',
  },
  idempotencyKey: {
    term: 'Idempotency key',
    definition:
      'A unique label a client sends with every attempt of the same request, so the service can recognise a repeat.',
  },
  retry: {
    term: 'Retry',
    definition:
      'Sending a request again because no answer arrived. The first attempt may still have worked.',
  },
  race: {
    term: 'Race condition',
    definition:
      'A bug that appears only when two things happen at nearly the same time and their steps interleave in an unlucky order.',
  },
  atomic: {
    term: 'Atomic (conditional) update',
    definition:
      'A check and a write done as one indivisible step, such as "subtract one only if stock is above zero".',
  },
  optimistic: {
    term: 'Optimistic concurrency control',
    definition:
      'Each record carries a version. A write based on an old version is rejected, so a stale read cannot overwrite newer data.',
  },
  dedup: {
    term: 'Deduplication',
    definition:
      'Remembering which messages were already handled so a repeated delivery is ignored.',
  },
  versioning: {
    term: 'Event versioning',
    definition:
      'Numbering events so a receiver can tell which is newer and ignore one that arrives late.',
  },
  outbox: {
    term: 'Transactional outbox',
    definition:
      'Saving "I must tell the other system about this" in the same transaction as the change, so the two cannot get out of step.',
  },
  counterexample: {
    term: 'Counterexample (shortest example that breaks the rule)',
    definition:
      'A concrete sequence of events that breaks the rule. Here, the shortest one the search found.',
  },
} satisfies Record<string, GlossaryEntry>;

export type GlossaryId = keyof typeof GLOSSARY;

export interface Pattern {
  name: string;
  text: string;
}

export interface Lesson {
  id: string;
  templateId: string;
  title: string;
  hook: string;
  scenario: string;
  /** "What must never happen?" */
  rule: string;
  invariantId: string;
  /** "What could go wrong?" */
  wrong: string[];
  design: Record<string, string>;
  faults: FaultSettings;
  /** Why the rule broke, in a few short sentences. */
  why: string[];
  concept: GlossaryId;
  patterns: Pattern[];
  /** Same failures, different design. */
  protectedDesign: { design: Record<string, string>; summary: string };
  terms: GlossaryId[];
}

export const LESSONS: readonly Lesson[] = [
  {
    id: 'confirmed-twice',
    templateId: 'booking-confirmation',
    title: 'The booking that was confirmed twice',
    hook: 'A guest taps Confirm. The booking is confirmed, but the answer never reaches the guest.',
    scenario:
      "A booking service confirms a booking and emails the guest. The guest's app waits for an answer; if none arrives it tries again.",
    rule: 'A booking must never be confirmed twice. The guest should get one confirmation email.',
    invariantId: 'single-confirmation',
    wrong: [
      'The booking is confirmed, but the answer is lost on its way back.',
      "The guest's app hears nothing, times out, and sends the request again.",
    ],
    design: { guard: 'none' },
    faults: { ...NO_FAULTS, lostResponse: 1, retry: 1 },
    why: [
      'The first request worked, but the guest never found out.',
      'The retry looked exactly like a brand-new request, and the service had no way to tell it was a repeat, so it confirmed and emailed again.',
    ],
    concept: 'idempotency',
    patterns: [
      {
        name: 'Idempotency key',
        text: 'The app sends the same key with every attempt. The service remembers keys it has handled and answers a repeat without doing the work again. The key and the result must be saved together, or a crash between them can bring the bug back.',
      },
      {
        name: 'Conditional update',
        text: 'Confirm only if the booking is still pending, as one atomic step. A second attempt then finds nothing to change.',
      },
    ],
    protectedDesign: {
      design: { guard: 'conditional-write' },
      summary: 'Confirm becomes one conditional update: "set confirmed only if still pending".',
    },
    terms: ['safetyRule', 'retry', 'idempotency', 'atomic'],
  },
  {
    id: 'charged-twice',
    templateId: 'payment-refund',
    title: 'Charged twice after a crash',
    hook: 'The card was charged, then the service crashed before it wrote that down.',
    scenario:
      'A shop charges a card through a payment processor and then records the payment in its own ledger. Those are two separate writes.',
    rule: 'A customer must never be charged more than the order total.',
    invariantId: 'no-double-charge',
    wrong: [
      'The service crashes after the processor charged the card but before the shop ledger was updated.',
      'The client retries, and the restarted service sees nothing recorded, so it charges again.',
    ],
    design: { idempotency: 'off' },
    faults: { ...NO_FAULTS, crash: 1, retry: 1 },
    why: [
      'Two writes that should have happened together did not: the money moved, but the record of it did not.',
      'The retry reused the same request, but nothing told the processor it had already handled it.',
    ],
    concept: 'idempotencyKey',
    patterns: [
      {
        name: 'Idempotency key at the processor',
        text: 'Send the same key with every attempt. The processor charges once and answers repeats with the first result.',
      },
      {
        name: 'Record the intent first (transactional outbox)',
        text: 'Save "a charge was requested" in the same database transaction as the order, then let a separate step carry it out. This keeps your own records in step, but that step can still run twice, so the processor still needs an idempotency key.',
      },
    ],
    protectedDesign: {
      design: { idempotency: 'on' },
      summary: 'The processor now remembers each request key and ignores a repeated one.',
    },
    terms: ['safetyRule', 'idempotencyKey', 'retry', 'outbox'],
  },
  {
    id: 'last-unit',
    templateId: 'inventory-order',
    title: 'Two buyers, one unit',
    hook: 'Only one item is left, and two people press Buy at almost the same moment.',
    scenario:
      'A shop has one unit in stock. To place an order, the service reads the stock level, subtracts one, and then creates the order.',
    rule: 'The shop must never sell more units than it has in stock.',
    invariantId: 'no-oversell',
    wrong: [
      'Two buyers order the last unit at almost the same time.',
      'The service handles both at once, so their steps interleave between the read and the write.',
    ],
    design: { writes: 'check-then-decrement' },
    faults: { ...NO_FAULTS, concurrent: true },
    why: [
      'Both requests read "1 left" before either one subtracted.',
      'Each decided it was safe to buy, and both subtracted, so stock went below zero. A normal test that runs one buyer at a time rarely sees this order of events.',
    ],
    concept: 'race',
    patterns: [
      {
        name: 'Atomic conditional update',
        text: "Subtract one only if stock is above zero, as a single step. The second buyer's update simply fails. In this model the fixed design makes the check and the subtraction one indivisible step; a real database needs the right locking or isolation to give the same effect.",
      },
      {
        name: 'Optimistic concurrency control',
        text: 'Read the stock together with a version number. If the version changed before you write, the write is rejected and you start over.',
      },
    ],
    protectedDesign: {
      design: { writes: 'transactional' },
      summary: 'Taking the unit and creating the order now happen together, in one transaction.',
    },
    terms: ['safetyRule', 'race', 'atomic', 'optimistic'],
  },
  {
    id: 'out-of-order',
    templateId: 'webhook-receipt',
    title: 'Webhooks that arrive out of order',
    hook: 'A provider tells you a subscription was activated and then cancelled. You receive them backwards.',
    scenario:
      'A billing provider sends event 1 ("activated") and then event 2 ("cancelled"). Webhooks are delivered at least once and in no promised order.',
    rule: 'The subscription must always reflect the newest event the provider sent: the one with the highest sequence number, here event 2 (cancelled).',
    invariantId: 'newest-event-wins',
    wrong: [
      'The "cancelled" event arrives first.',
      'The older "activated" event arrives second and is applied on top of it.',
    ],
    design: { ordering: 'last-write-wins', dedupe: 'off' },
    faults: { ...NO_FAULTS, reorder: true },
    why: [
      'The receiver applied whatever arrived last, without asking which event was newer.',
      'A cancelled customer ended up active again, because an old message overwrote a newer one.',
    ],
    concept: 'versioning',
    patterns: [
      {
        name: 'Event versioning',
        text: 'Give each event a sequence number or timestamp. Apply an event only if it is newer than what you already stored.',
      },
      {
        name: 'Deduplication (also worth knowing; not simulated in the fixed design below)',
        text: 'Remember event ids you have handled, so a repeated delivery does not run its side effect twice.',
      },
    ],
    protectedDesign: {
      design: { ordering: 'ignore-older', dedupe: 'off' },
      summary:
        'The receiver now ignores any event that is not newer than the one it already applied.',
    },
    terms: ['safetyRule', 'versioning', 'dedup'],
  },
];

export function getLesson(id: string): Lesson | undefined {
  return LESSONS.find((lesson) => lesson.id === id);
}

export function lessonRequest(lesson: Lesson, protectedDesign = false): ExplorationRequest {
  return {
    version: REQUEST_VERSION,
    templateId: lesson.templateId,
    invariantId: lesson.invariantId,
    design: protectedDesign ? { ...lesson.protectedDesign.design } : { ...lesson.design },
    faults: { ...lesson.faults },
    limits: { ...DEFAULT_LIMITS },
  };
}
