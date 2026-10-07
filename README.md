# Invariant Trail

An interactive learning tool for students and junior developers who want to understand idempotency, retries, concurrency and distributed-system failures through visual, step-by-step simulations.

**Learn why reliable systems fail, and how to fix them.**

Invariant Trail simulates small, modelled scenarios. It explores retries, duplicates, crashes, delays and concurrency to find the shortest sequence of events that breaks a safety rule, then replays it step by step. It never runs or touches a real system.

It runs entirely in the browser. There is no server, account, database, LLM, telemetry, or paid service, and nothing a visitor types is ever executed.

## Live demo

[Open Invariant Trail](https://invariant-trail.vercel.app/). It is a static browser application hosted on Vercel; no account is required.

## Two ways to use it

- **Learn** (default): four guided lessons. Each one states what must never happen, what could go wrong, asks you to predict, runs the simulation, replays the shortest example that breaks the rule, explains why it happened and which idea it teaches, and lists how real systems usually prevent it. You can then run the same failures against a protected design. See [docs/EDUCATION.md](docs/EDUCATION.md).
- **Sandbox**: every technical control. Choose the workflow, the safety rule, how the workflow is built, the things that can go wrong, and the search limits. Presets, shareable URLs, progress and cancellation all live here.

## What you can do in the Sandbox

1. Choose a built-in workflow: booking confirmation, payment capture and refund, inventory reservation and order, or webhook receipt.
2. See its lifecycle as a diagram, with an equivalent text table.
3. Pick a safety rule written in plain language, such as "a booking is confirmed at most once".
4. Allow realistic failures with typed, capped controls: duplicate delivery, lost answers, retries, slow answers, out-of-order delivery, concurrent work, a crash between writes, and late retries.
5. Explore. A deterministic breadth-first search runs in a Web Worker with visible progress and real cancellation.
6. Read the outcome: rule broken, no violation found (within limits or in the whole model), state budget used up, cancelled, or invalid.
7. Replay the shortest counterexample with before/after state, a state diff, and the steps that changed the data the rule looks at. Settings are stored in the page URL so a result can be reproduced.

## Run it

Requires Node 22+.

```bash
npm ci
npm run dev            # development server on http://localhost:3000
npm run build          # static export to apps/web/out
npm start              # serve the export on http://127.0.0.1:4173
```

## Verify it

```bash
npm run format:check
npm run lint
npm run typecheck
npm test               # unit, property, fixture, replay and component tests
npm run build
npx playwright install chromium   # once
npm run test:e2e       # real browser against the production build (needs `npm run build` first)
npm run verify         # format, lint, typecheck, test, build
```

`npm run examples:update` regenerates `examples/*.expected.json` after an intentional change to workflow semantics; review the diff.

## Layout

- `apps/web`: static Next.js app (workspace, replay, accessibility, end-to-end tests).
- `packages/contracts`: request, limits, failure and outcome types; strict validation of URL-derived input.
- `packages/engine`: canonical state identity, bounded BFS, trace and replay, the failure-semantics kit, the four templates.
- `examples`: golden outcomes and shortest counterexamples for every built-in preset, checked by tests.
- `docs`: [architecture](docs/ARCHITECTURE.md), [harness](docs/HARNESS.md), [plan](docs/plans/0001-invariant-trail-mvp.md), [decisions](docs/decisions).

## What a result means

- A found violation is replayed from the initial state and every step is re-checked. It is a shortest path in the model; if the branching limit cut choices, the result says a shorter one may exist.
- "No violation found" is bounded. It covers the model, the failure settings, the single selected rule, and the limits. It is never a proof about a real system. If a limit hid states, the result says which.
- The workflows are small deliberate models, not your production code. Only safety rules are checked, not liveness: a crash can lose work without breaking any safety rule.
- Duplicates apply to requests (not answers). Budgets are global, not per client. Service downtime is not modelled (it restarts immediately). Slow answers are off in the safe presets because enabling them with every other failure exceeds the state budget.

## Native zoom

The automated 200% check forces `font-size: 200%` on the page. That is not the same as the browser's own zoom (Ctrl and +), which also changes the viewport width in CSS pixels and triggers different media queries. Please test native zoom (200% and 400%) by hand before relying on it.

## Why no paid services

All the work is a finite search over a few thousand to tens of thousands of states, which a browser does in seconds. Hosting is any static file server. Fonts are self-hosted npm packages. Tests are offline and free; CI uses only free GitHub Actions and no secrets.

## Known limitations and follow-ups

- Search memory is bounded only by the state cap (100,000); there is no byte budget or wall-clock limit.
- The HTML keeps a CSP `<meta>` tag as defense in depth. Production also sends the policy as a response header, including `frame-ancestors 'none'`, on the page and static worker assets through `vercel.json`.
- CI actions are pinned to major tags, not commit SHAs.
- Editing a limit while a run is in progress discards that run and its result by design.
- Deferred: strict JSON import/export, user-authored workflows, liveness properties, per-client budgets, partitions and clock skew.
