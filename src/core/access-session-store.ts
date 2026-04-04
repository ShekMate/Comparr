// In-memory access session store.
// After a user verifies the ACCESS_PASSWORD, a random session token is issued
// and stored here. The token is placed in the access cookie; the raw password
// never travels in a cookie or header again after that initial verify call.
//
// Sessions are intentionally in-memory only: they are lost on container restart
// (users simply re-enter the shared password) which keeps the store simple and
// avoids persisting tokens alongside the secrets they protect.

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

type Session = { expiresAt: number }
const _sessions = new Map<string, Session>()

const pruneExpired = (): void => {
  const now = Date.now()
  for (const [token, session] of _sessions) {
    if (now > session.expiresAt) _sessions.delete(token)
  }
}

/** Issue a new session token. Returns the token to be stored in the cookie. */
export const createAccessSession = (): string => {
  if (_sessions.size > 500) pruneExpired()
  const token =
    crypto.randomUUID().replace(/-/g, '') +
    crypto.randomUUID().replace(/-/g, '')
  _sessions.set(token, { expiresAt: Date.now() + SESSION_TTL_MS })
  return token
}

/** Returns true if the token exists and has not expired. */
export const validateAccessSession = (token: string): boolean => {
  if (!token) return false
  const session = _sessions.get(token)
  if (!session) return false
  if (Date.now() > session.expiresAt) {
    _sessions.delete(token)
    return false
  }
  return true
}

/** Invalidate a single session token (e.g. on logout). */
export const invalidateAccessSession = (token: string): void => {
  _sessions.delete(token)
}

/** Invalidate all active sessions (call when ACCESS_PASSWORD changes). */
export const clearAccessSessions = (): void => {
  _sessions.clear()
}
