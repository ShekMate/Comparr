# Repository Architecture Roadmap

This document proposes a pragmatic, incremental architecture plan for Comparr.

## Goals

- Reduce complexity in large files.
- Strengthen boundaries between API, domain logic, and infrastructure.
- Improve testability and contributor onboarding.
- Keep migration low risk through small PR-sized steps.

## Current Strengths

Comparr already has a strong base structure in `src/`:

- `core/` for configuration and shared internals.
- `features/` for domain workflows.
- `infra/` for HTTP/WebSocket and constants.
- `integrations/` and `services/` for external systems and caches.

The roadmap below keeps those strengths and makes boundaries more explicit.

## Target Structure

```text
src/
  app/
    bootstrap.ts               # start server, initialize caches/jobs
    container.ts               # dependency wiring (thin manual DI)

  core/
    config.ts
    i18n.ts
    persistence.ts
    rate-limiter.ts
    settings.ts

  domain/
    media/
      media.types.ts
      rating.ts
    session/
      session.types.ts
      matcher.ts
      filters.ts

  features/
    session/
      handlers/                # websocket message handlers
      services/                # orchestration use-cases
      presenters/              # client-facing payload shaping
      repositories/            # session state persistence adapters
    catalog/
      services/
      providers/

  infra/
    http/
      router.ts
      routes/
        health.ts
        matches.ts
        request-service.ts
        movie-status.ts
        refresh.ts
        settings.ts
      middleware/
    ws/
      websocketServer.ts

  integrations/
    plex/
    tmdb/
    omdb/
    request-services/

  services/
    cache/

public/js/
  app/
    main.js
    bootstrap.js
  state/
    store.js
  features/
    swipe/
    filters/
    matches/
  api/
    comparr-api.js
  ui/
    card-view.js
    matches-view.js
```

## Architecture Rules

1. **Routes should orchestrate, not implement business logic.**
2. **Feature services own workflows** (session flow, enrichment flow, matching flow).
3. **Presenters map internal models to API/WS payloads.**
4. **Integrations wrap third-party APIs** (Plex/TMDb/OMDb/Radarr/Jellyseerr/Overseerr).
5. **Domain modules stay framework-agnostic** (no direct HTTP/WebSocket references).

## High-Impact Refactors (Suggested Order)

### 1) Split `src/index.ts` into bootstrap + router + route modules

**Why first:** This creates immediate clarity with low behavioral change.

- Move startup jobs/caches to `src/app/bootstrap.ts`.
- Introduce `src/infra/http/router.ts` for route registration.
- Move each route family into `src/infra/http/routes/*.ts`.

### 2) Decompose `features/session/session.ts`

**Why second:** It is a central hotspot and currently combines many responsibilities.

- Extract types to `session.types.ts`.
- Move matching/filter logic to pure functions.
- Move response payload shaping and rating HTML composition to presenters.
- Keep websocket handlers thin and delegating.

### 3) Break up `public/js/main.js`

**Why third:** It will improve front-end maintainability without changing UX.

- Keep `main.js` as bootstrap only.
- Move filter logic to `features/filters`.
- Move swipe/session interactions to `features/swipe`.
- Move reusable DOM rendering to `ui/` components.

### 4) Add shared API contracts

**Why fourth:** Helps guard against backend/frontend drift during ongoing refactors.

- Define stable DTO shapes for major endpoints and WS messages.
- Validate inbound payloads at route boundaries.

## PR-by-PR Migration Plan

### PR 1 (small, low risk)

- Add router abstraction.
- Move 2-3 endpoints from `index.ts` into route files.
- Keep existing request/response behavior exactly the same.

### PR 2

- Move initialization/caching jobs out of `index.ts` into `app/bootstrap.ts`.
- Keep a single callsite from entrypoint.

### PR 3

- Split session types and pure matching helpers out of `features/session/session.ts`.
- Add targeted unit tests for extracted pure functions.

### PR 4

- Front-end extraction: move filter helpers/constants from `main.js` into `features/filters`.
- Add/adjust Vitest coverage for moved helpers.

### PR 5+

- Continue route extraction + session modularization + front-end feature modularization.
- Introduce API schema validation for high-traffic endpoints.

## Definition of Done for Each Refactor PR

- No user-visible behavior regressions.
- Existing tests pass.
- New logic has unit tests where feasible.
- Route modules remain thin and focused.
- Files removed from hotspots are not replaced by new hotspots elsewhere.

## Notes for Contributors

- Prefer **small, vertical slices** over broad rewrites.
- Keep commits scoped to one architectural move.
- If uncertain, optimize for easier rollback and simpler code review.
