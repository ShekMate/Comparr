# Security Review of Revised Public-Deployment Hardening Plan

## Verdict

**Yes — I agree with the revised plan overall.** It now covers the major exploitable paths present in the current codebase, including the previously missing WebSocket-origin and CSRF hardening work.

## What the revised plan gets right

The updated plan correctly targets vulnerabilities that are clearly present in the current implementation:

- **Forwarded-header trust bypass** (local-admin fallback can be spoofed if forwarded headers are blindly trusted).  
- **XSS sinks** in `CardView`, `MatchesView`, and WebSocket error rendering that currently interpolate unescaped values into `innerHTML`.  
- **No auth rate limits + direct string password comparisons** on both WebSocket login and HTTP auth paths.  
- **No request body/message caps** for body-consuming endpoints and WS frames.  
- **Missing centralized security headers** on static/API responses.  
- **Weak room-code generation** (4 chars + `Math.random()`).  
- **Inline script/onclick blockers** that prevent moving to strict CSP.

## Important implementation corrections before execution

These are not blockers to the *plan direction*, but they should be corrected in implementation details:

1. **Use byte-length for WS string limit checks**  
   In JS, `ev.length` is UTF-16 code units, not bytes. If enforcing a byte limit, check encoded size (e.g., `new TextEncoder().encode(ev).byteLength`).

2. **`crypto.subtle.timingSafeEqual()` is likely not available as proposed**  
   The plan should use a known available constant-time helper (or implement one carefully) rather than assuming a specific WebCrypto API name.

3. **Origin/Host checks must not rely on untrusted proxy headers**  
   Deriving trust decisions from `Host`/forwarded headers is only safe when proxy trust boundaries are explicit (`TRUST_PROXY=true` behind a trusted proxy that rewrites headers).

4. **HSTS should be conditional on HTTPS deployment**  
   Setting HSTS on plain HTTP local deployments can create confusing behavior. Document/apply it only when serving behind TLS (usually at proxy).

5. **CORS remains medium but worth explicit policy**  
   Even with Origin checks on sensitive routes, explicit CORS behavior and `Vary: Origin` improve predictability and defense in depth.

## Added items I still strongly support keeping

- **H7: WebSocket Origin validation (CSWSH)** — necessary.  
- **H8: CSRF checks on state-changing admin routes** — necessary, especially with IP-based admin fallback.  
- **M4: Per-IP WS connection caps** — necessary against connection-flood exhaustion.  
- **M6: Host/origin allowlist option** — valuable for hardened proxy deployments.

## Suggested execution order

1. C1/C2/C3/C4 + H7/H8 first (auth/XSS/header/origin/CSRF class risks).  
2. H2/H4/H5 + M4 (DoS/info leak controls).  
3. H1 + M1/M2 (entropy + CSP-enabling cleanup).  
4. M5/M6 + docs + env defaults.

## Bottom line

This revised plan is now strong enough to present publicly as a serious hardening roadmap rather than "vibe coding" — provided the implementation follows the corrections above and you publish concrete verification evidence per control.
