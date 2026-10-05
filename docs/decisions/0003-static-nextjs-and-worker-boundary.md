# Static Next.js app and Web Worker boundary

- Status: accepted
- Date: 2026-10-03

## Context

The product needs no server. Exploration may take noticeable time at upper limits and must be cancellable without freezing the page.

## Decision

- One static Next.js (App Router, `output: 'export'`) application with pure TypeScript workspace packages and no backend.
- Exploration runs in a module Web Worker. The engine's chunked async explorer yields between chunks, so a `cancel` message is honoured and produces a real `cancelled` outcome with partial counters. A main-thread async runner using the same engine code is the fallback.
- Every run has a monotonically increasing run id. The controller drops progress or results from any run that is not current, and starting a run cancels the previous one.
- The worker validates the request with the contracts schema, so the allowlist is enforced at the boundary, not only in the UI.
- Shareable state lives in the URL query string and is parsed strictly; there is no `localStorage` in v1.
- Production HTML carries a CSP meta tag with `connect-src 'none'`.

## Consequences

Hosting is any static file server. Worker bundling relies on the Next bundler's `new Worker(new URL(...))` support, verified by the production build and end-to-end tests. A meta CSP cannot express `frame-ancestors`, keeps `unsafe-inline` scripts for the framework payload, and does not govern the worker script own response headers, so it is defense in depth only; a deploy-time header would be a follow-up if hosting is added.

## Alternatives considered

- API route or Python service (cost and attack surface without benefit).
- Main-thread only (cannot offer real cancellation for large bounds).
- `terminate()` as the only cancellation (loses partial counters and the engine-level `cancelled` outcome).
