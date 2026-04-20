// src/core/user-session-store.ts
// Per-user session store. After a user authenticates via Plex/Jellyfin/Emby,
// a random session token is issued and stored here. The token travels in the
// comparr_user HttpOnly cookie; raw credentials never live in a cookie.
//
// Sessions are intentionally in-memory (lost on container restart).
// Users re-authenticate via their media server, which is low-friction
// since the media server handles the credential management.

import type { AuthProvider } from '../features/auth/user-db.ts'

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

export interface UserSession {
  userId: number
  provider: AuthProvider
  providerUserId: string
  username: string
  avatarUrl: string
  isAdmin: boolean
  hasServerAccess: boolean
  expiresAt: number
}

const _sessions = new Map<string, UserSession>()

const pruneExpired = (): void => {
  const now = Date.now()
  for (const [token, session] of _sessions) {
    if (now > session.expiresAt) _sessions.delete(token)
  }
}

/** Issue a new user session token. Returns the token to store in the cookie. */
export const createUserSession = (user: Omit<UserSession, 'expiresAt'>): string => {
  if (_sessions.size > 500) pruneExpired()
  const token =
    crypto.randomUUID().replace(/-/g, '') +
    crypto.randomUUID().replace(/-/g, '')
  _sessions.set(token, { ...user, expiresAt: Date.now() + SESSION_TTL_MS })
  return token
}

/** Returns the session if the token exists and has not expired, otherwise null. */
export const getUserSession = (token: string): UserSession | null => {
  if (!token) return null
  const session = _sessions.get(token)
  if (!session) return null
  if (Date.now() > session.expiresAt) {
    _sessions.delete(token)
    return null
  }
  return session
}

/** Invalidate a single session token (e.g. on logout). */
export const invalidateUserSession = (token: string): void => {
  _sessions.delete(token)
}

/** Invalidate all active user sessions (e.g. when user auth is disabled). */
export const clearUserSessions = (): void => {
  _sessions.clear()
}
