# Security Feedback Assessment (March 19, 2026)

This file evaluates the listed "Reddit roast" findings against the current codebase.

## Verdict

- **Mostly valid overall**: many high-risk findings are real and should be prioritized.
- **Partially outdated/inaccurate in places**: a few claims no longer match current code.

## Accurate findings (confirmed)

1. **Secrets in URL query strings**: Plex and TMDb keys are still placed in query params in multiple places.
2. **Non-cryptographic IDs in one request path**: `Math.random()` is used for a request correlation ID in `/api/refresh-movie`.
3. **Settings persisted as plaintext JSON**: settings are written as JSON to disk, including secret values.
4. **CSP includes `unsafe-inline`** for script/style.
5. **Several sensitive write endpoints appear unauthenticated** (e.g. refresh/update/import/match endpoints in `src/index.ts`).
6. **Frontend admin password persisted in `sessionStorage`**.
7. **No external fetch timeouts in several code paths**.
8. **Broad Deno runtime permissions in container entrypoint**.
9. **`/api/access-password/status` is unauthenticated and discloses whether password is set**.

## Partially accurate / nuance needed

1. **CSRF claim is directionally correct, but not "no protection anywhere"**:
   - Some state-changing endpoints do check Origin via `isValidOrigin`.
   - Others in `src/index.ts` do not use that check.
2. **Rate limiter "unbounded memory leak" is overstated**:
   - The Map is pruned on every check for expired windows.
   - There is still no hard max cardinality cap.
3. **WebSocket "allow all origins by default" is not exactly true now**:
   - If `ALLOWED_ORIGINS` is empty, code falls back to requiring `Origin.host === Host` (unless no `Origin`, which is allowed).
4. **Path traversal concern is plausible but needs a PoC**:
   - Current static file path join lacks explicit root-prefix enforcement after normalization.

## Not accurate for current code

1. **"WebSocket max message size constant defined but not enforced" is no longer true**:
   - Incoming string and binary messages are both size-checked and oversized messages are closed with code `1009`.

## Clarification: Math.random() finding

- **Room code generation** does use `crypto.getRandomValues` (so that narrow sub-claim is false).
- **Math.random() is still used for other IDs**, including refresh correlation IDs and IMDb import history IDs.
- Therefore, the broader concern (non-CSPRNG IDs still present in parts of the codebase) remains valid.

## Priority fixes

1. Replace URL secrets with headers/bearer auth where supported.
2. Add a consistent auth+authorization layer and apply to all sensitive routes.
3. Add proper CSRF defenses for cookie/session-authenticated actions (token + strict origin policy).
4. Remove inline scripts/styles from CSP (nonce/hash strategy).
5. Add `AbortController` timeouts and failure budgets for outbound HTTP.
6. Restrict Deno permissions to least privilege.
7. Add bounded memory behavior for rate-limit tracking.

## Delivery recommendation

If you need the fastest path with continuity, have the same agent that performed this assessment implement the fixes in priority order, with tests after each batch.

If you use another agent/tool (e.g., Claude), require a strict verification gate:

1. Open PR per risk tier (critical/high first).
2. Include exploit repro or negative tests for each security claim.
3. Re-run lint/tests and add targeted integration tests for auth/CSRF/origin checks.
4. Perform a final manual security pass against all state-changing routes.

Best practical approach: one agent implements, a second agent independently reviews.
