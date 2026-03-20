# Security Fix Status (March 20, 2026)

This is a practical status snapshot after the recent hardening patches.

## Addressed

- Origin checks on state-changing API routes.
- Access-password enforcement on state-changing API routes.
- Access-password forwarding from frontend API calls.
- Plex token removed from query strings for major Plex API calls.
- Request timeout helper added and applied to key integrations.
- Static-file root enforcement to reduce traversal risk.
- WebSocket message-size enforcement (already present) and stricter origin handling.
- `Math.random()` replaced for refresh correlation ID and IMDb import-history ID.
- Rate limiter map now has bounded tracked-IP cardinality.
- Basic audit log emission for state-changing requests.
- Shutdown improved with in-flight request drain window.

## Still recommended / not fully complete

- Full CSP migration to nonce/hash model for inline style attributes and JS-driven inline styles.
- End-to-end authorization model audit per route (beyond access-password gate).
- Comprehensive audit logging schema (actor/session IDs, outcome codes, immutable retention policy).
- Graceful shutdown of long-running background jobs and websocket session-drain semantics.
- Compatibility strategy for TMDb credentials (v3 key vs v4 bearer token) with explicit configuration and fallback policy.
- Expanded automated security/integration tests for auth/origin/CSRF-like protections.
