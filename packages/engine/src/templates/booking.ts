import type { Obj, OperationDef, ProtocolSpec, StepDef } from '../kit/types';
import { ALL_FAULTS, BROAD_FAULTS, BROAD_LIMITS, faults, type TemplateDef } from './types';

type Booking = { status: string };

function booking(db: Obj): Booking {
  return db.booking as Booking;
}

function setStatus(db: Obj, status: string, extra: Obj = {}): Obj {
  return { ...db, ...extra, booking: { ...booking(db), status } };
}

function sendEmail(): StepDef {
  return {
    name: 'Send confirmation email',
    run({ db, local }) {
      if (local.marked !== true) {
        return { note: 'This request did not confirm anything, so no email is sent.' };
      }
      const sent = (db.confirmationsSent as number) + 1;
      return {
        db: { ...db, confirmationsSent: sent },
        note: `Sends a confirmation email to the guest (${sent} sent so far).`,
      };
    },
  };
}

function confirmSteps(guard: string): StepDef[] {
  if (guard === 'conditional-write') {
    return [
      {
        name: 'Confirm only if still pending',
        run({ db }) {
          const status = booking(db).status;
          if (status !== 'pending') {
            return {
              local: { marked: false },
              note: `The booking is ${status}, so the conditional update changes nothing.`,
            };
          }
          return {
            db: setStatus(db, 'confirmed'),
            local: { marked: true },
            note: 'Atomically checks "status is pending" and sets it to confirmed.',
          };
        },
      },
      sendEmail(),
    ];
  }
  if (guard === 'check-then-write') {
    return [
      {
        name: 'Read booking status',
        run({ db }) {
          const status = booking(db).status;
          return {
            local: { sawPending: status === 'pending' },
            note: `Reads the booking status: ${status}.`,
          };
        },
      },
      {
        name: 'Mark confirmed if it was pending',
        run({ db, local }) {
          if (local.sawPending !== true) {
            return {
              local: { ...local, marked: false },
              note: 'The earlier read was not pending, so nothing is written.',
            };
          }
          return {
            db: setStatus(db, 'confirmed'),
            local: { ...local, marked: true },
            note: 'The earlier read said pending, so it writes confirmed, even if the status changed after that read.',
          };
        },
      },
      sendEmail(),
    ];
  }
  return [
    {
      name: 'Mark booking confirmed',
      run({ db }) {
        return {
          db: setStatus(db, 'confirmed'),
          local: { marked: true },
          note: 'Sets the booking to confirmed without looking at its current status.',
        };
      },
    },
    sendEmail(),
  ];
}

export const bookingTemplate: TemplateDef = {
  id: 'booking-confirmation',
  title: 'Booking confirmation',
  tagline: 'A guest confirms a booking. Taps repeat, answers get lost, and a cancel races in.',
  story:
    'A guest confirms a pending booking and the service emails a confirmation. The same guest can also cancel from another screen. Messages can be duplicated, answers can vanish, and the service can crash halfway through its writes.',
  actors: [
    {
      name: 'Guest (confirm)',
      role: 'Sends the confirm request and retries when no answer arrives.',
    },
    { name: 'Guest (cancel)', role: 'Sends a cancel request from another screen.' },
    { name: 'Booking service', role: 'Updates the booking and sends the confirmation email.' },
  ],
  lifecycle: {
    nodes: [
      { id: 'pending', label: 'Pending' },
      { id: 'confirmed', label: 'Confirmed' },
      { id: 'cancelled', label: 'Cancelled' },
    ],
    grid: {
      wide: { pending: [0, 1], confirmed: [1, 0], cancelled: [1, 2] },
      narrow: { pending: [0, 0], confirmed: [1, 1], cancelled: [0, 2] },
    },
    edges: [
      { from: 'pending', to: 'confirmed', label: 'confirm' },
      { from: 'pending', to: 'cancelled', label: 'cancel' },
      { from: 'confirmed', to: 'cancelled', label: 'cancel' },
    ],
    current: (db) => booking(db).status,
  },
  designOptions: [
    {
      id: 'guard',
      label: 'How confirm protects the booking',
      help: 'Decides whether the service checks the booking before confirming it, and how.',
      defaultChoice: 'none',
      choices: [
        { id: 'none', label: 'No check', help: 'Always confirms and sends an email.' },
        {
          id: 'check-then-write',
          label: 'Read, then write',
          help: 'Reads the status first, then writes. Something can change in between.',
        },
        {
          id: 'conditional-write',
          label: 'One conditional update',
          help: 'Confirms only if the booking is still pending, in a single atomic update.',
        },
      ],
    },
  ],
  invariants: [
    {
      id: 'single-confirmation',
      title: 'A booking is confirmed at most once',
      why: 'Every extra confirmation email tells the guest that something new happened.',
      check(state) {
        const sent = state.db.confirmationsSent as number;
        return sent > 1
          ? {
              message: `The guest received ${sent} confirmation emails for one booking.`,
              paths: ['db.confirmationsSent'],
            }
          : null;
      },
    },
    {
      id: 'no-confirm-after-cancel',
      title: 'A cancelled booking never becomes confirmed',
      why: 'A guest who cancelled must not be held to, or charged for, a booking.',
      check(state) {
        return state.db.wasCancelled === true && booking(state.db).status === 'confirmed'
          ? {
              message: 'The guest cancelled the booking, yet it is confirmed again.',
              paths: ['db.booking.status', 'db.wasCancelled'],
            }
          : null;
      },
    },
  ],
  presets: [
    {
      id: 'double-confirmation',
      title: 'Duplicate request',
      summary: 'The network delivers the confirm request twice and nothing checks the booking.',
      design: { guard: 'none' },
      faults: faults({ duplicate: 1 }),
      invariantId: 'single-confirmation',
      expect: { status: 'violated', shortest: 3 },
    },
    {
      id: 'retry-after-lost-response',
      title: 'Retry after a lost answer',
      summary: 'The answer is lost after the booking was confirmed, so the guest retries.',
      design: { guard: 'none' },
      faults: faults({ lostResponse: 1, retry: 1 }),
      invariantId: 'single-confirmation',
      expect: { status: 'violated', shortest: 5 },
    },
    {
      id: 'stale-read-race',
      title: 'Cancel slips in between read and write',
      summary: 'Confirm reads "pending", a cancel lands, then confirm writes on stale information.',
      design: { guard: 'check-then-write' },
      faults: faults({ concurrent: true }),
      invariantId: 'no-confirm-after-cancel',
      expect: { status: 'violated', shortest: 7 },
    },
    {
      id: 'conditional-update-safe',
      title: 'One conditional update, broad failures',
      summary:
        'Duplicates, a lost answer, a retry, a late retry, a crash, reordering and concurrency, one of each. Slow answers are off. Only the selected rule is checked; a crash can drop work without breaking a safety rule.',
      design: { guard: 'conditional-write' },
      faults: BROAD_FAULTS,
      limits: BROAD_LIMITS,
      invariantId: 'single-confirmation',
      expect: { status: 'bounded-safe' },
    },
    {
      id: 'everything-at-once',
      title: 'Stress: every failure at its maximum',
      summary:
        'All controls at their maximum. The search is expected to run out of state budget, which is not a safety result.',
      design: { guard: 'conditional-write' },
      faults: ALL_FAULTS,
      invariantId: 'single-confirmation',
      expect: { status: 'exhausted' },
    },
  ],
  dbLabels: {
    'db.booking.status': 'Booking status',
    'db.wasCancelled': 'Was ever cancelled',
    'db.confirmationsSent': 'Confirmation emails sent',
  },
  buildSpec(design): ProtocolSpec {
    const confirm: OperationDef = {
      noun: 'confirm',
      steps: confirmSteps(design.guard ?? 'none'),
      respond({ db, local }) {
        if (local.marked === true) return 'confirmed';
        return booking(db).status === 'confirmed' ? 'already-confirmed' : 'rejected';
      },
    };
    const cancel: OperationDef = {
      noun: 'cancel',
      steps: [
        {
          name: 'Cancel the booking',
          run({ db }) {
            if (booking(db).status === 'cancelled') {
              return { note: 'The booking is already cancelled, so nothing changes.' };
            }
            return {
              db: setStatus(db, 'cancelled', { wasCancelled: true }),
              note: 'Sets the booking to cancelled.',
            };
          },
        },
      ],
      respond: () => 'cancelled',
    };
    return {
      clients: [
        { id: 'confirm', label: 'Guest (confirm)', op: 'confirm', key: 'confirm-1' },
        { id: 'cancel', label: 'Guest (cancel)', op: 'cancel', key: 'cancel-1' },
      ],
      initialDb: {
        booking: { status: 'pending' },
        wasCancelled: false,
        confirmationsSent: 0,
      },
      operations: { confirm, cancel },
    };
  },
};
