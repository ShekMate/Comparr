// src/core/user-session-store.ts
// Per-user session store. After a user authenticates via Plex/Jellyfin/Emby,
// a random session token is issued and stored here. The token travels in the
// comparr_user HttpOnly cookie; raw credentials never live in a cookie.
//
// Sessions are cached in memory and mirrored to DATA_DIR so they can survive
// process restarts and be shared when replicas mount the same storage path.

import type { AuthProvider } from '../features/auth/user-db.ts'
import { getDataDir } from './env.ts'

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
const SESSION_STORE_FILE = `${getDataDir()}/user-sessions.json`
const SESSION_STORE_LOCK_DIR = `${getDataDir()}/user-sessions.lock`

const sleepSync = (ms: number): void => {
  const signal = new Int32Array(new SharedArrayBuffer(4))
  Atomics.wait(signal, 0, 0, ms)
}

const withSessionStoreLock = <T>(fn: () => T): T => {
  const maxAttempts = 200
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      Deno.mkdirSync(SESSION_STORE_LOCK_DIR)
      try {
        return fn()
      } finally {
        Deno.removeSync(SESSION_STORE_LOCK_DIR)
      }
    } catch (err) {
      const lockErr = err as { name?: string; code?: string }
      if (lockErr?.name !== 'AlreadyExists' && lockErr?.code !== 'EEXIST') {
        throw err
      }
      sleepSync(10)
    }
  }
  throw new Error('[session-store] timed out waiting for session store lock')
}

const loadSessionsFromDisk = (): void => {
  try {
    const text = Deno.readTextFileSync(SESSION_STORE_FILE)
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object') return
    _sessions.clear()
    const now = Date.now()
    for (const [token, session] of Object.entries(parsed)) {
      if (!session || typeof session !== 'object') continue
      const candidate = session as UserSession
      if (!token || now > Number(candidate.expiresAt || 0)) continue
      _sessions.set(token, {
        userId: Number(candidate.userId),
        provider: candidate.provider,
        providerUserId: String(candidate.providerUserId || ''),
        username: String(candidate.username || ''),
        avatarUrl: String(candidate.avatarUrl || ''),
        isAdmin: Boolean(candidate.isAdmin),
        hasServerAccess: candidate.hasServerAccess !== false,
        expiresAt: Number(candidate.expiresAt),
      })
    }
  } catch {
    // ignore not found / parse issues and keep in-memory state
  }
}

const persistSessionsToDisk = (): void => {
  try {
    Deno.mkdirSync(getDataDir(), { recursive: true })
    const tmp = `${SESSION_STORE_FILE}.tmp.${Date.now()}`
    const payload = Object.fromEntries(_sessions.entries())
    Deno.writeTextFileSync(tmp, JSON.stringify(payload))
    Deno.renameSync(tmp, SESSION_STORE_FILE)
  } catch {
    // ignore persistence failures; in-memory behavior still works
  }
}

/** Issue a new user session token. Returns the token to store in the cookie. */
export const createUserSession = (user: Omit<UserSession, 'expiresAt'>): string => {
  return withSessionStoreLock(() => {
    loadSessionsFromDisk()
    const now = Date.now()
    if (_sessions.size > 500) {
      for (const [token, session] of _sessions) {
        if (now > session.expiresAt) _sessions.delete(token)
      }
    }
    const token =
      crypto.randomUUID().replace(/-/g, '') +
      crypto.randomUUID().replace(/-/g, '')
    _sessions.set(token, { ...user, expiresAt: now + SESSION_TTL_MS })
    persistSessionsToDisk()
    return token
  })
}

/** Returns the session if the token exists and has not expired, otherwise null. */
export const getUserSession = (token: string): UserSession | null => {
  loadSessionsFromDisk()
  if (!token) return null
  const session = _sessions.get(token)
  if (!session) return null
  if (Date.now() > session.expiresAt) {
    withSessionStoreLock(() => {
      loadSessionsFromDisk()
      _sessions.delete(token)
      persistSessionsToDisk()
    })
    return null
  }
  return session
}

/** Invalidate a single session token (e.g. on logout). */
export const invalidateUserSession = (token: string): void => {
  withSessionStoreLock(() => {
    loadSessionsFromDisk()
    _sessions.delete(token)
    persistSessionsToDisk()
  })
}

/** Find the most-recent valid session for a given userId (used to refresh hasServerAccess). */
export const findSessionByUserId = (userId: number): UserSession | null => {
  loadSessionsFromDisk()
  const now = Date.now()
  let found: UserSession | null = null
  for (const [, session] of _sessions) {
    if (session.userId === userId && now <= session.expiresAt) {
      if (!found || session.expiresAt > found.expiresAt) found = session
    }
  }
  return found
}

/** Invalidate all active user sessions (e.g. when user auth is disabled). */
export const clearUserSessions = (): void => {
  withSessionStoreLock(() => {
    loadSessionsFromDisk()
    _sessions.clear()
    persistSessionsToDisk()
  })
}
