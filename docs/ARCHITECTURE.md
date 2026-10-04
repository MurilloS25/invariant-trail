# Architecture

## Product boundary

Invariant Trail is a local-first visual failure simulator for finite, stateful workflows. It starts from a curated workflow, enumerates permitted actions and injected failures within explicit bounds, checks typed safety invariants after each transition, and returns either the shortest violating trace or an honest bounded-safe result.

It is not a workflow orchestrator, distributed-systems model checker, arbitrary-code sandbox, production monitor, or proof of correctness for unbounded systems.

## Components (implemented; see the plan and ADRs 0001-0003)

1. **Visual workspace** — template selection, graph and state inspection, invariant/failure controls, limits, progress, and results.
2. **Contracts** — versioned definitions for state, action, transition, invariant, failure model, search bounds, outcome, and trace step.
3. **Template catalog** — built-in workflows with human-readable explanations, safe defaults, and known counterexamples.
4. **Exploration engine** — deterministic successor generation, invariant checks, canonical state identity, deduplication, bounded breadth-first search, and predecessor tracking.
5. **Replay model** — reconstructs the shortest counterexample with events, before/after state, state diffs, and causal explanation.
6. **Execution boundary** — keeps heavy exploration responsive, likely through a Web Worker if measured workloads justify it.

The default architecture should remain a static-capable Next.js application with pure TypeScript domain packages. Add a backend only for a concrete capability that cannot be delivered safely in the browser.

## Core records

- **Workflow template/version**: state schema, initial state, action definitions, transition rules, labels, and safe exploration defaults.
- **Invariant**: typed predicate identifier, parameters, explanation, and evidence formatter.
- **Failure model**: enabled fault types and their bounded semantics.
- **Search configuration**: workflow version, chosen invariant, enabled failures, depth/state/branch limits, and engine version.
- **Explored node**: canonical logical state plus the minimum metadata needed to generate valid successors.
- **Trace step**: action or injected failure, before/after state, diff, and explanation.
- **Outcome**: violated, bounded-safe, exhausted, cancelled, or invalid, with counts and applied limits.

## Exploration semantics

- Use deterministic breadth-first exploration so the first violation has the fewest transitions under the configured successor ordering.
- Define a stable successor order per workflow and failure type; never depend on hash-map iteration or timing.
- Check the initial state and every successor against the selected invariant.
- Deduplicate by canonical logical state plus any failure-control metadata that changes future behavior.
- Track predecessors separately from state identity so a counterexample can be reconstructed without storing full paths on every frontier node.
- Stop at explicit depth, explored-state, and per-state branching bounds. A bounded-safe result means only that no violation was found inside those limits.
- Treat cancellation as a first-class outcome and ensure a previous run cannot overwrite the result of a newer run.

## Initial templates

The exact catalog should be validated during implementation, but the first release should favor workflows whose failures are understandable without specialist knowledge:

- Booking confirmation with duplicate requests and lost acknowledgements.
- Payment capture and refund with retries and crashes between writes.
- Inventory reservation and order placement with concurrent buyers.
- Webhook ingestion with duplicate, delayed, and out-of-order delivery.

Each template needs at least one safe baseline, one deliberately unsafe configuration, and an asserted shortest trace.

## Trust boundaries

- Labels, descriptions, imported documents, URL parameters, and saved browser data are untrusted.
- No transition may contain arbitrary JavaScript, expressions evaluated at runtime, shell commands, or remote callbacks.
- Templates and invariants resolve through allowlisted typed identifiers and validated parameters.
- Exploration limits are clamped before work begins.
- Rendering uses text nodes and framework escaping; state values are not injected as HTML.
- No credentials are required or stored. Optional local persistence must be versioned, validated, and recover gracefully from corrupt data.

## First vertical slice

Load one booking template, display its workflow, select a duplicate-confirmation invariant, toggle a lost-response plus retry failure, explore deterministically, find the known shortest violation, and replay it step by step. The same configuration must produce the same result after reload and in unit tests.

## Decisions requiring implementation evidence

- Exact package manager, framework versions, schema library, and graph-rendering approach.
- Whether Web Worker isolation is needed from the first release or after profiling.
- Canonical-state representation and safeguards against accidental omission of future-relevant metadata.
- Practical default search limits for mobile and desktop devices.
- Whether optional JSON/YAML import/export earns its security and maintenance cost after the built-in experience is complete.
