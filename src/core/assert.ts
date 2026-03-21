export function assert(expr: unknown, msg = 'Assertion failed'): asserts expr {
  if (!expr) {
    throw new Error(msg)
  }
}
