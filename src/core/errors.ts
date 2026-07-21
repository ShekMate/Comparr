// Deno types catch-block bindings as `unknown`, so `err.message`/`err?.message` doesn't
// type-check at any of the many log/error-formatting call sites across the codebase. Centralize
// the narrowing here instead of repeating `err instanceof Error ? ...` everywhere.
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// Same idea for call sites that also want the stack trace when available (falls back to the
// message, then the stringified value).
export function errorDetail(err: unknown): string {
  return err instanceof Error ? err.stack || err.message : String(err)
}
