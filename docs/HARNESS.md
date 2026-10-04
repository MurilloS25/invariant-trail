# Development harness

## Active components

- `AGENTS.md`: canonical cross-agent contract.
- `CLAUDE.md`: minimal Claude Code entry point.
- `.claude/skills/frontend-design`: audited Anthropic skill pinned to the reviewed commit.
- `product-researcher`: bounded, read-only investigation.
- `change-reviewer`: focused, read-only review of completed work.
- `docs/plans/` and `docs/decisions/`: durable reasoning outside standing context.

## Commands (all real, all offline except the one-time browser download)

| Purpose                            | Command                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| Install                            | `npm ci`                                                                        |
| Develop                            | `npm run dev`                                                                   |
| Format check / write               | `npm run format:check` / `npm run format`                                       |
| Lint                               | `npm run lint` (ESLint, TypeScript, React hooks, jsx-a11y, engine purity rules) |
| Typecheck                          | `npm run typecheck`                                                             |
| Unit, property, fixture, component | `npm test` (Vitest; golden files in `examples/`)                                |
| Production build                   | `npm run build` (static export to `apps/web/out`)                               |
| Serve the build                    | `npm start` (dependency-free server on `127.0.0.1:4173`)                        |
| Browser tests                      | `npx playwright install chromium` once, then `npm run test:e2e`                 |
| Everything but browser             | `npm run verify`                                                                |
| Regenerate goldens                 | `npm run examples:update`, then review the diff                                 |

Before a pull request also run `git diff --check`, `npm audit`, and a scan of tracked files for secrets and absolute local paths.

## Working loop

Inspect contracts and template semantics first. Resolve real uncertainty with bounded research. Build the deterministic engine before the visualization. Verify known shortest counterexamples and bounded-safe cases, then exercise the complete experience in a browser. Review state identity, explosion limits, race and cancellation behaviour, untrusted input boundaries, accessibility, and claims before publishing.

The `examples/*.expected.json` goldens pin every preset's outcome, state count, and shortest trace. A semantics change that alters them is intentional only if the diff is reviewed and the ADRs are updated.

Measured on a development laptop (Node 22): the booking safe preset enumerates about 9,600 states in roughly 0.6 s; the webhook safe preset about 39,500 states in roughly 3 s; the stress preset reaches the 30,000-state default budget in roughly 3 s and reports `exhausted`. These are indicative, not guarantees.

## Browser validation checklist

The Playwright suite covers: unsafe flow with full replay, safe flow, keyboard stepping and visible focus, URL round trip and hostile URLs, limit validation, cancellation, `exhausted` versus `cancelled`, rapid replacement of a run, each workflow, no horizontal scroll and no console errors at desktop, 390 px and 320 px, 200% text, dark scheme, reduced motion, axe with zero violations before and after exploring, text alternative for the diagram, and CSP blocking network access.

The current task authorizes autonomous implementation after a plan is written. Still stop before merging, deploying, adding secrets, creating paid resources, or expanding into provider-backed services.

## Deliberately absent

- No LLM, AI provider, paid API, database, account system, or server-side persistence.
- No arbitrary program or expression execution.
- No hooks until stable checks exist.
- No blanket tool approvals.
- No multi-agent team unless the scope demonstrably benefits from independent review.
