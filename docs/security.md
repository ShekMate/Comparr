# Security

## Current Status (June 29, 2026)

### Addressed

- Origin checks on state-changing API routes.
- Access-password enforcement on state-changing API routes.
- Access-password forwarding from frontend API calls.
- Plex token removed from query strings for major Plex API calls.
- Request timeout helper added and applied to key integrations.
- Static-file root enforcement to reduce traversal risk.
- WebSocket message-size enforcement and stricter origin handling.
- `Math.random()` replaced for refresh correlation ID and IMDb import-history ID.
- Rate limiter map now has bounded tracked-IP cardinality.
- Basic audit log emission for state-changing requests (with method/path context and per-request completion metadata).
- Shutdown improved with in-flight request drain window.
- TMDb authentication supports both v4 bearer tokens and v3 API-key compatibility mode.
- IMDb background update job supports explicit stop on shutdown.
- WebSocket shutdown now closes active client sockets instead of dropping references.
- CSRF double-submit protection added for state-changing API routes (`/api/csrf-token` + `x-csrf-token` verification).
- CSRF cookie includes `HttpOnly` and conditional `Secure` in HTTPS deployments.
- Frontend admin-settings password is now in-memory only (no session/local storage persistence).
- State-changing origin checks now require an explicit `Origin` header.
- `/api/access-password/status` disabled to avoid password-state disclosure.
- Default compose port binding changed from `0.0.0.0:8000` to `127.0.0.1:8000` to prevent unintentional LAN/public exposure.
- Docker compose hardened with `no-new-privileges` and `cap_drop: ALL`.
- `.dockerignore` updated to exclude tests, dev tooling, and build config from the image build context.
- README updated with explicit security warnings: plaintext secret storage, first-run exposure window, reverse proxy requirements, and `ALLOWED_ORIGINS` guidance.

### Still recommended / not fully complete

- CSP hardened with strict `script-src` and split `style-src-elem`/`style-src-attr`; full nonce/hash migration remains optional future hardening.
- End-to-end authorization model audit per route (beyond access-password gate).
- Comprehensive audit logging schema (actor/session IDs, immutable retention policy).
- Expanded automated security/integration tests for auth/origin/CSRF protections.

---

## Known Findings

The following were identified in a codebase review. Items marked ✅ are resolved; ⚠️ are still open.

| # | Finding | Status |
|---|---------|--------|
| 1 | Secrets in URL query strings (Plex/TMDb keys) | ✅ Plex resolved; TMDb partially |
| 2 | `Math.random()` used for non-cryptographic IDs | ✅ Resolved |
| 3 | Settings persisted as plaintext JSON (includes secrets) | ⚠️ Open — documented in README |
| 4 | CSP includes `unsafe-inline` for script/style | ⚠️ Partially hardened |
| 5 | Sensitive write endpoints unauthenticated | ✅ Resolved |
| 6 | Frontend admin password in `sessionStorage` | ✅ Resolved (in-memory only) |
| 7 | No external fetch timeouts | ✅ Resolved |
| 8 | Broad Deno runtime permissions in container (`--allow-net`, `--allow-ffi`) | ⚠️ Open — architectural constraint |
| 9 | `/api/access-password/status` disclosed password state | ✅ Disabled |
| 10 | CSRF protection inconsistent | ✅ Resolved (double-submit) |
| 11 | Rate limiter unbounded memory | ✅ Resolved (cardinality cap) |
| 12 | WebSocket max message size not enforced | ✅ Already enforced (1009 close) |
| 13 | Default compose bound to `0.0.0.0` (LAN exposure) | ✅ Resolved — bound to `127.0.0.1` |
| 14 | No Docker-level hardening in sample compose | ✅ Resolved — `no-new-privileges`, `cap_drop: ALL` added |
| 15 | `ALLOWED_ORIGINS` defaulting to all with no README guidance | ✅ Resolved — README warns and examples include it |
| 16 | Test/dev files included in image build context | ✅ Resolved — `.dockerignore` updated |
| 17 | First-run setup mode reachable before access password set | ⚠️ Open — documented in README |

---

## Implementation Notes

These apply when making future security changes:

1. **WS byte-length checks** — `ev.length` is UTF-16 code units, not bytes. Use `new TextEncoder().encode(ev).byteLength` when enforcing byte limits.
2. **Timing-safe equality** — Use the helper in `src/core/security.ts`; do not assume `crypto.subtle.timingSafeEqual()` is available by that name.
3. **Proxy header trust** — Origin/Host trust decisions from forwarded headers are only safe when `TRUST_PROXY=true` is set and a trusted proxy explicitly rewrites those headers.
4. **HSTS** — Apply only in HTTPS deployments; setting it on plain HTTP causes confusing behavior. Handle at the reverse proxy level.
5. **CORS** — Even with Origin checks on sensitive routes, explicit CORS policy and `Vary: Origin` improve predictability.
