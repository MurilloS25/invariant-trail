# Exploration outcomes and state identity

- Status: accepted
- Date: 2026-10-03

## Context

The product's central claim is a counterexample that is shortest, replayable, and honest about what was not explored. Outcome names and the definition of node identity decide whether the UI can overclaim.

## Decision

- Nodes are identified by the full canonical JSON string of the state (sorted keys, strict JSON values). Hashes are display labels only and never used for identity. Everything that affects successors (failure budgets, in-flight messages, handlers, history flags) is inside the state, so nothing relevant can be omitted from identity.
- Search is breadth-first. Violations are checked on discovery, including the initial state.
- Exactly one outcome: `violated`, `bounded-safe`, `exhausted`, `cancelled`, `invalid`.
  - `bounded-safe` means the search ended on its own without a violation. `limitsHit` (`depth`, `branching`) lists cutoffs that hid states; an empty list means the model's reachable space was fully enumerated.
  - `exhausted` means only the `maxStates` budget ended the run; it says nothing about safety.
  - `cancelled` and `invalid` never claim anything about safety.
- Minimality is claimed for the explored graph: with branching truncation it is minimal among explored transitions only, and the UI states that when truncation occurred.
- User copy never uses "safe" or "proved" without the words "within these limits" or "in this model".

## Consequences

Memory per state is the canonical string plus the state object, which is acceptable at the capped 100 000 states. Trace reconstruction is cheap because predecessors are stored per key.

## Alternatives considered

- Hash keys (smaller, but silent collisions merge states).
- A single `safe` outcome (hides whether limits bit).
- Treating state-budget exhaustion as a kind of bounded-safe (indistinguishable to a reader from a clean finish).
