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
- TMDb authentication now supports both v4 bearer tokens and v3 API-key compatibility mode.
- IMDb background update job now supports explicit stop on shutdown.
- WebSocket shutdown now closes active client sockets instead of dropping references.
- Audit log entries now include method/path context and per-request completion metadata.

## Still recommended / not fully complete

- CSP hardened with strict `script-src` and split `style-src-elem`/`style-src-attr`; full nonce/hash migration remains optional future hardening.
- End-to-end authorization model audit per route (beyond access-password gate).
- Comprehensive audit logging schema (actor/session IDs, immutable retention policy).
- Expanded automated security/integration tests for auth/origin/CSRF-like protections.
