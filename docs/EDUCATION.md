# Educational positioning

Invariant Trail is an interactive learning tool for students and junior developers who want to understand idempotency, retries, concurrency and distributed-system failures through visual, step-by-step simulations. Promise: _Learn why reliable systems fail, and how to fix them._

It is not a model checker for experts, a monitoring tool, or a way to certify a system. Every scenario is a small model built to teach one idea.

## What a learner should come away understanding

- Why a repeated request can charge or confirm twice.
- How an operation can finish while its answer is lost.
- Why retries need idempotency.
- How two clients can compete for the last unit.
- Why webhooks can arrive duplicated, late or out of order.
- What atomic updates, idempotency keys and version checks contribute.
- Why an ordinary test does not cover every possible order of events.

## Modes

**Learn** is the default. A lesson has a fixed shape so it can be followed without documentation:

1. The scenario, with its lifecycle diagram.
2. _What must never happen?_ (the safety rule, with its technical name introduced gently as "also called an invariant").
3. _What could go wrong?_ (the failures, as plain sentences).
4. _Your turn_: an optional prediction, then _Run the simulation_.
5. The result in plain language, then the replay of the shortest example that breaks the rule.
6. _What you just saw_: why it happened, the idea behind it (one short definition), and how real systems usually prevent it.
7. _Try the same failures against a fixed design_: the same failures run against a different design, with a short comparison and a button to the next lesson.
8. A short glossary of the words the lesson uses.

**Sandbox** keeps every control. Timing, ordering and crash controls and the search limits are collapsed until needed. Nothing was removed from the engine or the contracts for Learn.

## Lessons

| Lesson                               | Workflow  | Idea                            | Fixed design (same failures)     |
| ------------------------------------ | --------- | ------------------------------- | -------------------------------- |
| The booking that was confirmed twice | Booking   | Idempotency, retries            | One conditional update           |
| Charged twice after a crash          | Payment   | Idempotency keys, two writes    | Processor remembers request keys |
| Two buyers, one unit                 | Inventory | Race conditions                 | One transaction                  |
| Webhooks that arrive out of order    | Webhook   | Event versioning, deduplication | Ignore events that are not newer |

Unit tests assert that each lesson's unprotected configuration violates its rule and that the protected configuration is `bounded-safe` with the whole modelled space explored.

## Claims we make and do not make

- Patterns (idempotency key, conditional update, optimistic concurrency, deduplication, event versioning, transactional outbox) are described as common ways to address a failure in the scenario, never as universal fixes. A test fails the build if lesson copy uses words such as "guarantee" or "proves".
- A protected result says: in this model, with these failures and this one rule, no violation was found. It does not say the design is safe.
- Terminology: _safety rule_ before _invariant_; _things that can go wrong_ before _failure injection_; _try every possible order within these limits_ before _bounded state-space exploration_; _shortest example that breaks the rule_ before _minimal counterexample_.

## Known gaps (deferred)

- A link that opens the Sandbox (`?t=...`) renders Learn for a moment before switching, because the address bar can only be read after the page loads.
- Browser back and forward do not switch tabs; only the tab controls and the page links do.
- The hero sentence is the official positioning text and is long; the "What you will learn" list carries the plain examples.
- Fixes are taught as common patterns. Some patterns (deduplication, transactional outbox, optimistic concurrency) are explained but not all are demonstrated by the fixed design, and the lesson says which.

## Language

The product is in English. No localisation framework exists. Layouts allow text to expand (wrapping, no fixed-width labels); diagrams use a numbered layout when space is tight so labels are never truncated.
