# Merge conflict resolution guidance for `src/index.ts`

For the conflict chunks shown in the screenshots, you should keep the security hardening logic from the **current change** branch (the `codex/review-critical-security-feedback-y9g2qv` side).

## What to select in the conflict UI

- For the blocks introducing:
  - `EXEMPT_ACCESS_PASSWORD_PATHS`
  - `streamingUpdateInFlight`
  - `parseAccessPassword`
  - `isAccessPasswordAuthorized`
  - `updateStreamingForTmdbIdDeduped`
  - the `401 Access password required` guard in the request loop

Choose **Accept current change**.

## Why

Those blocks are the server-side enforcement and dedupe protections. Choosing the incoming-only side would drop those protections and reopen unauthenticated state-changing API behavior.

## Safe alternative

If your tooling supports it, use **Accept both changes** and then manually remove duplicates so you preserve all hardening helpers and keep one clean definition of each constant/function.
