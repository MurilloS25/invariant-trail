# Protocol kit and failure semantics

- Status: accepted
- Date: 2026-10-03

## Context

Four workflows need the same failure vocabulary (duplicates, lost responses, delays, reordering, concurrency, crashes between writes, retries, late retries). Re-implementing it per template would let semantics drift and make combinations untestable.

## Decision

Templates are declarative: clients, handler steps over durable state, invariants, and design options. A shared kit builds the `Model`:

- In-flight messages are an ordered list; delivery is FIFO per destination unless `reorder` is on, in which case the list is sorted into canonical order because order no longer matters.
- Failure budgets are global counters inside the state and only decrease.
- `delay` lets a client timeout fire while traffic is in flight. Without it, a timeout needs the client's messages and handlers to be gone (for example after a lost response or a crash).
- `concurrent` makes handler steps separate transitions that may interleave. Without it and without `crash`, handlers are atomic. With `crash` only, handlers are stepwise but one at a time.
- Duplicates apply to requests only; answers are never duplicated (duplicate answers are harmless in these models).
- A timeout always offers both retry (while budget remains) and give-up. A client that gave up stays gave-up if a late answer arrives, so dependants are not unlocked.
- `crash` is only injectable after at least one step of a running handler: durable writes remain, in-memory progress and the pending response are lost. The service restarts immediately (downtime is not modelled).
- A retry reuses the client's idempotency key and increments the attempt. A late retry fires after the client finished or gave up.
- Handler code is repository-owned TypeScript selected by allowlisted ids. No user-supplied expressions are evaluated.

## Consequences

Every template gets all faults consistently, and tests exercise the kit once plus per-template presets. The model is safety-only; liveness (for example "a confirmed booking eventually gets its email") is out of scope. Budgets are global rather than per client, which keeps state spaces small.

## Alternatives considered

- Per-template hand-written successors (drift risk, combinatorial test cost).
- A user-facing expression language (violates the no-eval boundary).
- Per-client budgets (larger spaces, little extra insight for the first release).
