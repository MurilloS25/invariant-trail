# Plan 0001: Invariant Trail MVP

- Status: implemented on `feature/invariant-trail-mvp`; outcome and follow-ups below
- Canonical inputs: `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/HARNESS.md`
- Related decisions: ADR 0001 (exploration outcomes and state identity), ADR 0002 (protocol kit and failure semantics), ADR 0003 (static Next.js app and Web Worker boundary)

## Outcome

A visitor opens a static page, picks one of four built-in workflows, picks a plain-language safety rule, switches typed failure controls on, and presses **Explore**. A deterministic, bounded breadth-first search runs in a Web Worker with visible progress and cancellation. The page then says one of five things — a violation was found, no violation was found inside the limits, the state budget ran out, the run was cancelled, or the input was invalid — and, for a violation, replays the shortest counterexample step by step with before/after state, a state diff, and the reason the rule broke. The same configuration yields the same result and the same trace after reload, in unit tests, and from a shared URL.

Nothing runs on a server. No account, secret, LLM, database, telemetry or paid service is involved.

## Scope

Included:

- `packages/contracts`: zod schemas and types for the exploration request, limits, fault settings, outcome, stats, and trace; strict parsing of URL-derived input.
- `packages/engine`: canonical state identity, state diff, deterministic bounded BFS (sync and async share one code path), predecessor tracking, trace reconstruction, replay verification; the protocol kit that turns a declarative workflow into a model with composable failure injection; four templates.
- `apps/web`: static Next.js app with landing section, scenario picker, lifecycle diagram plus text alternative, rule and failure controls, limits, explore/cancel, result summary, replay, state diff, causal explanation, shareable URL.
- `examples/`: golden expected counterexamples for every unsafe preset, checked by tests (drift detection).
- Tests: engine unit/property/fixture/replay, contracts, component, keyboard, automated accessibility, Playwright end-to-end against the production build.
- Free CI without secrets: format, lint, typecheck, test, build.

Excluded (deferred, see follow-ups): accounts, backend, remote persistence, collaboration, telemetry, user-authored workflows, JSON/YAML import/export, `localStorage`, deployment, Vercel, any provider SDK.

## Contracts and semantics

### Model

A `Model<S>` is `{ initial: S, successors(s): Transition<S>[], invariant(s): Violation | null }` where `S` is a JSON value (no `undefined`, functions, `NaN`, cycles, or class instances). Everything that affects future behaviour — including remaining failure budgets, in-flight messages, active handlers, and history flags used by invariants — lives inside `S`. There is no hidden search metadata, so the canonical state is the complete node identity.

A `Transition` has a stable `id` (unique among the successors of one state), `kind` (`action` | `fault`), `actor`, `label`, `detail`, optional `fault` id, and `next`.

### Canonical identity

`canonicalize(value)` produces JSON with object keys sorted by UTF-16 code unit, rejecting non-JSON values. The canonical string is used directly as the map key, so identity cannot suffer hash collisions. A short FNV-1a digest is shown in the UI as a display label only. Messages in flight are kept in an order that is normalized when the delivery order does not matter, so equivalent states deduplicate.

### Exploration

- BFS over canonical keys. FIFO queue, stable successor order defined by the model.
- The initial state and every newly discovered successor are checked at discovery. Because BFS discovers states in non-decreasing depth, the first violation found has the fewest transitions, and among equals is the earliest in stable order.
- `maxDepth` = maximum transitions in a trace. States at `maxDepth` are checked but not expanded; successors are still generated once so the explorer can tell whether the cutoff actually hid new states.
- `maxBranching` = maximum successors considered per state. Extra successors are dropped in stable order and counted.
- `maxStates` = maximum distinct states stored. Reaching it stops the run.
- Predecessors are stored per canonical key (`parent`, `via`, `depth`); the trace is rebuilt by walking back. Paths are never stored on frontier nodes.
- Cancellation is cooperative and checked every chunk; in the browser it also drops queued work from the Web Worker. A newer run supersedes an older one via run ids; late messages from superseded runs are ignored.

### Outcomes (exactly one)

| Status         | Meaning                                                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `violated`     | A reachable state breaks the rule. A shortest counterexample (within the explored graph) is attached.                                                                     |
| `bounded-safe` | The search finished without finding a violation. `limitsHit` lists depth/branching cutoffs that hid states; empty means the model's whole reachable space was enumerated. |
| `exhausted`    | The `maxStates` budget ran out before the search could conclude. Says nothing about safety.                                                                               |
| `cancelled`    | Stopped on request. Counters so far are reported. Says nothing about safety.                                                                                              |
| `invalid`      | The request failed validation. No exploration ran. Issues are listed.                                                                                                     |

Every outcome carries the engine version, applied limits, counters (`statesDiscovered`, `statesExpanded`, `transitionsGenerated`, `duplicatesSkipped`, `maxDepthReached`, `branchTruncations`, `depthCutoffStates`) and a stop reason. Copy never says "safe" or "proved"; it says "no violation found within these limits" and, when `limitsHit` is empty, "the whole modelled state space was explored" with an explicit reminder that it is a model.

### Replay

`replayTrace(model, trace)` re-executes the trace from the initial state by selecting each recorded transition id among the actual successors and compares the canonical resulting state with the recorded one. Any mismatch is reported. The UI shows this verification result next to the counterexample.

### Failure semantics (the protocol kit)

Workflows are declared as clients (who send requests), request handlers (ordered steps against durable state), and an invariant list. The kit supplies the shared environment: an ordered in-flight network, per-client status (`idle`, `waiting`, `done`, `gave-up`), active handlers, and remaining failure budgets.

| Control        | Range  | Semantics                                                                                                                              |
| -------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `duplicate`    | 0–2    | Delivering a request may leave a copy in flight; each copy spends one unit. Answers are not duplicated.                                |
| `lostResponse` | 0–2    | A response in flight can be dropped after the service already produced its effect.                                                     |
| `delay`        | on/off | A client timeout may fire while its messages are still in flight. Off: a timeout needs the client's traffic to be gone.                |
| `reorder`      | on/off | Any in-flight message may be delivered next. Off: only the oldest message per destination.                                             |
| `concurrent`   | on/off | Handlers run step by step and several may interleave. Off: with no crash the handler is atomic; with crash it is one at a time.        |
| `crash`        | 0–1    | The service can crash after at least one step of a running handler; durable writes stay, in-memory progress and the response are lost. |
| `retry`        | 0–2    | After a timeout a client may resend (same key, next attempt) instead of giving up.                                                     |
| `lateRetry`    | 0–1    | A stale retry timer may resend a request after the client already finished or gave up.                                                 |

Budgets are global, stored in state, and strictly decrease, so every combination is finite. Transition order is: client sends, request deliveries (each followed by its duplicate variant), handler steps, response deliveries, timeouts/retries, late retries, then fault injections (drop, crash).

### Templates

Each template ships plain-language description, lifecycle diagram, actors, design choices (typed select options), invariants, and presets. Every preset states its expected outcome and, for unsafe ones, expected shortest length; tests and `examples/*.json` pin them.

1. **Booking confirmation** — guest confirm plus guest cancel. Design: confirm guard (`none`, `check-then-write`, `conditional-write`). Rules: confirmed at most once; cancelled booking never becomes confirmed.
2. **Payment capture and refund** — capture then refund. Design: idempotency key at the processor (`off`, `on`). Rules: never charged more than the order total; never refunded more than charged.
3. **Inventory reservation and order** — two buyers, one unit. Design: stock writes (`check-then-decrement`, `conditional-decrement`, `transactional`). Rules: never sell more than stock; no reserved unit without an order or an active handler.
4. **Webhook receipt** — two events from a provider. Design: ordering (`last-write-wins`, `ignore-older`) and dedupe (`off`, `by-event-id`). Rules: the newest event wins; each event's side effect happens at most once.

## Architecture

- npm workspaces monorepo: `apps/web`, `packages/contracts`, `packages/engine`, `examples/`.
- Workspace packages export TypeScript sources; Next transpiles them. No build step per package.
- The engine is dependency-free apart from `@invariant-trail/contracts`; it never touches DOM, React, time, or randomness.
- The web app is a single static page (`output: 'export'`). Exploration runs in a module Web Worker; a main-thread async runner with the same engine code is the fallback when workers are unavailable (and what jsdom tests use).
- URL query string carries the configuration; it is parsed with the contracts schema and falls back to defaults with a visible notice on failure. No `localStorage`.
- Production pages ship a restrictive CSP meta tag (`connect-src 'none'`, `base-uri 'none'`, `object-src 'none'`, `form-action 'none'`).

Alternatives rejected:

- Python/API backend: nothing here needs a server; it would add cost, latency and attack surface.
- Hash-only state identity: collisions would silently merge states; the canonical string is cheap at these bounds.
- DFS or random walks: no minimality or reproducibility guarantee.
- Generic user-authored workflow language/expressions: contradicts the no-eval trust boundary and is excluded from v1.
- Canvas/WebGL graph: inaccessible; SVG with real text plus an equivalent transition table is used.
- TLA+/Alloy-style external checker: heavy, not browser-native, not explainable to non-specialists.

## Phases

1. Plan, ADRs, workspace scaffold, tooling (format, lint, typecheck, test).
2. Contracts and engine core: canonicalization, diff, BFS, trace, replay, limits, cancellation. Tests first.
3. Protocol kit and failure semantics with tests for each fault and combinations.
4. Four templates, presets, golden `examples/`, minimality cross-check against an independent iterative-deepening search.
5. Web app: runner/controller (worker, run ids), state store, components, design system, URL state.
6. Component, keyboard and axe tests; Playwright against the production build at desktop, 390, 320, 200% text, reduced motion; cancellation and rapid re-run.
7. Independent correctness and security/privacy reviews; fix all P0–P2; re-run affected checks.
8. Documentation, CI, PR.

## Verification

- Engine: determinism (same input twice, identical outcome JSON), key-order independence, dedupe (diamond graphs), minimality (BFS vs iterative deepening on every unsafe preset and on random small graphs via fast-check), initial-state violation, depth/state/branch limits and the distinction among `bounded-safe`/`exhausted`, cancellation, invalid input, replay equal to found path, replay detecting tampering.
- Kit: each fault in isolation and in combination against hand-derived shortest lengths; budgets never negative; all states JSON-canonical and normalized.
- Templates: safe presets stay `bounded-safe` under the maximum fault set with `limitsHit` reported; unsafe presets match golden counterexamples.
- Web: controller stale-result protection, URL parsing of hostile input, components, keyboard operation, axe (jsdom plus real browser).
- Gates: `npm run format:check`, `lint`, `typecheck`, `test`, `build`, `test:e2e`, `git diff --check`, secret scan, tracked-file review.

## Risks

- **State explosion.** Budgets are tiny and global; limits are validated (out-of-range requests are `invalid`; the UI controls clamp); the UI default is conservative (20 000 states) with a hard cap (100 000); the worker keeps the page responsive; `exhausted` is its own outcome. Measure the maximum-fault safe preset and record the figures in the harness docs.
- **Unsound narrowing.** Branch truncation or depth cutoffs could make a counterexample non-minimal or hide one. They are counted and shown in the summary; minimality is claimed only for the explored graph.
- **Over-claiming.** Copy review plus tests asserting wording of results for each status.
- **Security.** No eval, no `innerHTML`, no network, allowlisted ids, strict schema for URL input, text-only rendering of labels, meta CSP.
- **Accessibility.** SVG with text, status words and icons not just colour, keyboard-operable stepper, live region for results, focus management on result and step changes, reduced motion, zoom and 200% text checks, graph text alternative.
- **Supply chain.** Few well-known dependencies, lockfile committed, `npm audit` reviewed, fonts self-hosted through npm packages (no runtime font CDN).

## Decisions and follow-ups

Decisions are recorded in ADRs 0001–0003. Deferred: optional strict JSON import/export, user-authored templates, richer liveness properties (these are safety-only), per-client fault budgets, partition and clock-skew failures, local persistence of recent runs, deployment.

## Outcome record

Delivered: contracts, engine, kit, four templates with golden examples, static app with worker, replay, state diff and causal list, unit and component tests, browser tests, CI. Independent correctness and security reviews found no P0. Fixed: safe presets mislabelled as covering every failure (renamed, excluded controls stated), give-up not offered alongside retry, late answers unlocking dependants of a client that gave up, runner promise rejections hanging the UI, replay not re-checking transition descriptions, limits that hid states shown as none for stopped runs, StrictMode URL load, CSP wording. Deferred with reasons: limit edits discard a running search (intentional and visible), CI action SHA pinning, byte or wall-clock budgets, per-client budgets.
