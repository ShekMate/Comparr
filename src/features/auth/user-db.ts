// src/features/auth/user-db.ts
// SQLite-backed user store. Supports Plex OAuth, passwordless email, and silent
// device-based (no-signup) accounts — see routes/auth.ts's POST /api/auth/device.
// Also manages per-user settings and friend connections.

import { Database } from 'jsr:@db/sqlite'
import * as log from 'jsr:@std/log'
import { getDataDir } from '../../core/env.ts'

export type AuthProvider = 'plex' | 'email' | 'device' | 'trakt'

export interface User {
  id: number
  provider: AuthProvider
  providerUserId: string
  username: string
  email: string
  avatarUrl: string
  isAdmin: boolean
  inviteCode: string
  createdAt: string
  lastLogin: string
}

export interface AdminUserSummary {
  id: number
  username: string
  isAdmin: boolean
}

export interface UserSettings {
  userId: number
  plexUrl: string
  plexToken: string
  plexLibraryName: string
  embyUrl: string
  embyApiKey: string
  embyLibraryName: string
  jellyfinUrl: string
  jellyfinApiKey: string
  jellyfinLibraryName: string
  radarrUrl: string
  radarrApiKey: string
  seerrUrl: string
  seerrApiKey: string
  defaultFilters: string
  subscriptions: string
  plexWatchlistSynced: string
  plexSeenSynced: string
  displayPreferences: string
  // Manual connections — independent of login. See AuthProvider/users.plex_auth_token for the
  // login-derived equivalent.
  plexAccountToken: string
  traktAccessToken: string
  traktRefreshToken: string
  traktTokenExpiresAt: string
  traktWatchlistSynced: string
  traktSeenSynced: string
  updatedAt: string
}

export type FriendStatus = 'pending' | 'accepted'

export interface FriendConnection {
  id: number
  userId: number
  friendUserId: number
  friendUsername: string
  friendInviteCode: string
  status: FriendStatus
  isInitiator: boolean
  sharesServer: boolean
  serverPromptPending: boolean
  createdAt: string
  updatedAt: string
}

const DB_PATH = `${getDataDir()}/users.db`
const CODE_MAP = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789'
const INVITE_CODE_LENGTH = 6

let db: Database | null = null

export function initUserDatabase(): Database {
  if (db) return db

  try {
    db = new Database(DB_PATH)

    // Use WAL journal mode: faster writes, readers never block writers, and
    // all committed WAL data is automatically checkpointed on db.close().
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA synchronous = NORMAL')

    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        provider         TEXT    NOT NULL DEFAULT 'plex',
        provider_user_id TEXT    NOT NULL,
        username         TEXT    NOT NULL,
        email            TEXT    NOT NULL DEFAULT '',
        avatar_url       TEXT    NOT NULL DEFAULT '',
        is_admin         INTEGER NOT NULL DEFAULT 0,
        invite_code      TEXT    UNIQUE,
        created_at       TEXT    NOT NULL,
        last_login       TEXT    NOT NULL,
        UNIQUE(provider, provider_user_id)
      )
    `)

    // Add invite_code column to existing databases that predate this schema.
    // SQLite cannot add a UNIQUE column via ALTER TABLE directly, so add the
    // column first, then create a unique index.
    try {
      db.exec(`ALTER TABLE users ADD COLUMN invite_code TEXT`)
    } catch {
      // Column already exists — ignore
    }
    try {
      db.exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_invite_code ON users(invite_code)`
      )
    } catch (err) {
      log.warn(`[auth] invite_code index warning: ${err}`)
    }

    // Add subscriptions column to existing user_settings tables
    try {
      db.exec(
        `ALTER TABLE user_settings ADD COLUMN subscriptions TEXT NOT NULL DEFAULT '[]'`
      )
    } catch {
      // Column already exists — ignore
    }

    // Add plex_auth_token to users for per-user watchlist/seen sync
    try {
      db.exec(`ALTER TABLE users ADD COLUMN plex_auth_token TEXT NOT NULL DEFAULT ''`)
    } catch {
      // Column already exists — ignore
    }

    // Add plex sync state columns to user_settings
    try {
      db.exec(`ALTER TABLE user_settings ADD COLUMN plex_watchlist_synced TEXT NOT NULL DEFAULT '{}'`)
    } catch {
      // Column already exists — ignore
    }
    try {
      db.exec(`ALTER TABLE user_settings ADD COLUMN plex_seen_synced TEXT NOT NULL DEFAULT '{}'`)
    } catch {
      // Column already exists — ignore
    }

    // Add display_preferences column (list visibility toggles + Plex sync button visibility)
    try {
      db.exec(`ALTER TABLE user_settings ADD COLUMN display_preferences TEXT NOT NULL DEFAULT '{}'`)
    } catch {
      // Column already exists — ignore
    }

    // Add Trakt login-derived tokens to users (parallel to plex_auth_token) — populated when
    // provider = 'trakt'. Trakt tokens expire and need refreshing, unlike Plex's long-lived
    // account token, hence the extra refresh/expiry columns.
    try {
      db.exec(`ALTER TABLE users ADD COLUMN trakt_access_token TEXT NOT NULL DEFAULT ''`)
    } catch {
      // Column already exists — ignore
    }
    try {
      db.exec(`ALTER TABLE users ADD COLUMN trakt_refresh_token TEXT NOT NULL DEFAULT ''`)
    } catch {
      // Column already exists — ignore
    }
    try {
      db.exec(`ALTER TABLE users ADD COLUMN trakt_token_expires_at TEXT NOT NULL DEFAULT ''`)
    } catch {
      // Column already exists — ignore
    }

    // Connections independent of login: a Plex account can be authorized for Watchlist sync
    // without that being how the user logs into Comparr (plex_auth_token above is login-only).
    // Trakt is never a login-derived requirement for these — it's always either this manual
    // connection or (once supported) the login-derived users.trakt_* columns above.
    try {
      db.exec(`ALTER TABLE user_settings ADD COLUMN plex_account_token TEXT NOT NULL DEFAULT ''`)
    } catch {
      // Column already exists — ignore
    }
    try {
      db.exec(`ALTER TABLE user_settings ADD COLUMN trakt_access_token TEXT NOT NULL DEFAULT ''`)
    } catch {
      // Column already exists — ignore
    }
    try {
      db.exec(`ALTER TABLE user_settings ADD COLUMN trakt_refresh_token TEXT NOT NULL DEFAULT ''`)
    } catch {
      // Column already exists — ignore
    }
    try {
      db.exec(`ALTER TABLE user_settings ADD COLUMN trakt_token_expires_at TEXT NOT NULL DEFAULT ''`)
    } catch {
      // Column already exists — ignore
    }

    // Trakt sync bookkeeping — parallel to plex_watchlist_synced/plex_seen_synced.
    try {
      db.exec(`ALTER TABLE user_settings ADD COLUMN trakt_watchlist_synced TEXT NOT NULL DEFAULT '{}'`)
    } catch {
      // Column already exists — ignore
    }
    try {
      db.exec(`ALTER TABLE user_settings ADD COLUMN trakt_seen_synced TEXT NOT NULL DEFAULT '{}'`)
    } catch {
      // Column already exists — ignore
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS user_settings (
        user_id             INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        plex_url            TEXT NOT NULL DEFAULT '',
        plex_token          TEXT NOT NULL DEFAULT '',
        plex_library_name   TEXT NOT NULL DEFAULT '',
        emby_url            TEXT NOT NULL DEFAULT '',
        emby_api_key        TEXT NOT NULL DEFAULT '',
        emby_library_name   TEXT NOT NULL DEFAULT '',
        jellyfin_url        TEXT NOT NULL DEFAULT '',
        jellyfin_api_key    TEXT NOT NULL DEFAULT '',
        jellyfin_library_name TEXT NOT NULL DEFAULT '',
        radarr_url          TEXT NOT NULL DEFAULT '',
        radarr_api_key      TEXT NOT NULL DEFAULT '',
        seerr_url           TEXT NOT NULL DEFAULT '',
        seerr_api_key       TEXT NOT NULL DEFAULT '',
        default_filters     TEXT NOT NULL DEFAULT '{}',
        subscriptions       TEXT NOT NULL DEFAULT '[]',
        display_preferences TEXT NOT NULL DEFAULT '{}',
        updated_at          TEXT NOT NULL
      )
    `)

    // Two rows per friendship — one for each direction.
    // is_initiator: 1 on the row belonging to whoever sent the friend request.
    // shares_server: does THIS user share their server with friend?
    // server_prompt_pending: friend recently turned on sharing; THIS user hasn't been prompted yet.
    db.exec(`
      CREATE TABLE IF NOT EXISTS friend_connections (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id               INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        friend_user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status                TEXT    NOT NULL DEFAULT 'pending',
        is_initiator          INTEGER NOT NULL DEFAULT 0,
        shares_server         INTEGER NOT NULL DEFAULT 0,
        server_prompt_pending INTEGER NOT NULL DEFAULT 0,
        created_at            TEXT    NOT NULL,
        updated_at            TEXT    NOT NULL,
        UNIQUE(user_id, friend_user_id)
      )
    `)

    // Add is_initiator column to existing databases that predate this schema.
    try {
      db.exec(`ALTER TABLE friend_connections ADD COLUMN is_initiator INTEGER NOT NULL DEFAULT 0`)
    } catch {
      // Column already exists — ignore
    }

    // A dismissed match hides that guid from the caller's Matches list without touching their
    // (or the friend's) underlying like — getCompareMatches derives matches purely from live
    // wantsToWatch=true responses, so hiding one requires a separate, explicit per-user record.
    db.exec(`
      CREATE TABLE IF NOT EXISTS dismissed_matches (
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        guid         TEXT    NOT NULL,
        dismissed_at TEXT    NOT NULL,
        PRIMARY KEY (user_id, guid)
      )
    `)

    log.info(`[auth] User database ready at ${DB_PATH}`)
    return db
  } catch (err) {
    log.error(`[auth] Failed to open user database: ${err}`)
    throw err
  }
}

export function closeUserDatabase(): void {
  if (db) {
    db.close()
    db = null
    _usersHasInviteCodeColumn = null
  }
}

function getDb(): Database {
  if (!db) return initUserDatabase()
  return db
}

function generateInviteCode(): string {
  return Array.from({ length: INVITE_CODE_LENGTH }, () => {
    const val = crypto.getRandomValues(new Uint32Array(1))[0]
    return CODE_MAP[val % CODE_MAP.length]
  }).join('')
}

function rowToUser(row: unknown[]): User {
  const [
    id,
    provider,
    providerUserId,
    username,
    email,
    avatarUrl,
    isAdmin,
    inviteCode,
    createdAt,
    lastLogin,
  ] = row as [
    number,
    string,
    string,
    string,
    string,
    string,
    number,
    string | null,
    string,
    string
  ]
  return {
    id,
    provider: provider as AuthProvider,
    providerUserId,
    username,
    email,
    avatarUrl,
    isAdmin: isAdmin === 1,
    inviteCode: inviteCode ?? '',
    createdAt,
    lastLogin,
  }
}

let _usersHasInviteCodeColumn: boolean | null = null

function usersHasInviteCodeColumn(): boolean {
  if (_usersHasInviteCodeColumn === true) return true
  try {
    // Probe by selecting the column. SQLite throws "no such column" if it
    // doesn't exist. LIMIT 0 returns no rows so this is essentially free.
    const stmt = getDb().prepare(`SELECT invite_code FROM users LIMIT 0`)
    stmt.values<unknown[][]>()
    stmt.finalize()
    _usersHasInviteCodeColumn = true
    return true
  } catch {
    return false
  }
}

function getUserSelect(): string {
  // Older databases may not have invite_code due SQLite ALTER limitations.
  // Use a synthetic empty column so row mapping stays stable.
  if (!usersHasInviteCodeColumn()) {
    return `SELECT id, provider, provider_user_id, username, email, avatar_url, is_admin, '' as invite_code, created_at, last_login FROM users`
  }
  return `SELECT id, provider, provider_user_id, username, email, avatar_url, is_admin, invite_code, created_at, last_login FROM users`
}

export function findUser(
  provider: AuthProvider,
  providerUserId: string
): User | null {
  try {
    const stmt = getDb().prepare(
      `${getUserSelect()} WHERE provider = ? AND provider_user_id = ? LIMIT 1`
    )
    const row = stmt.value<unknown[]>(provider, providerUserId)
    stmt.finalize()
    return row ? rowToUser(row) : null
  } catch (err) {
    log.error(`[auth] findUser error: ${err}`)
    return null
  }
}

export function findUserById(id: number): User | null {
  try {
    const stmt = getDb().prepare(`${getUserSelect()} WHERE id = ? LIMIT 1`)
    const row = stmt.value<unknown[]>(id)
    stmt.finalize()
    return row ? rowToUser(row) : null
  } catch (err) {
    log.error(`[auth] findUserById error: ${err}`)
    return null
  }
}

export function listUsers(): AdminUserSummary[] {
  try {
    const stmt = getDb().prepare(
      'SELECT id, username, is_admin FROM users ORDER BY created_at ASC'
    )
    const rows = stmt.values<[number, string, number]>()
    stmt.finalize()
    return rows.map(([id, username, isAdmin]) => ({
      id,
      username: String(username || ''),
      isAdmin: isAdmin === 1,
    }))
  } catch (err) {
    log.error(`[auth] listUsers error: ${err}`)
    return []
  }
}

export function deleteUserById(id: number): boolean {
  try {
    const existing = findUserById(id)
    if (!existing) return false
    getDb().exec('DELETE FROM users WHERE id = ?', id)
    log.info(`[auth] Deleted user id=${id} username=${existing.username}`)
    return true
  } catch (err) {
    log.error(`[auth] deleteUserById error: ${err}`)
    return false
  }
}

export function findUserByInviteCode(inviteCode: string): User | null {
  try {
    if (!usersHasInviteCodeColumn()) return null
    const stmt = getDb().prepare(
      `${getUserSelect()} WHERE invite_code = ? LIMIT 1`
    )
    const row = stmt.value<unknown[]>(inviteCode.toUpperCase())
    stmt.finalize()
    return row ? rowToUser(row) : null
  } catch (err) {
    log.error(`[auth] findUserByInviteCode error: ${err}`)
    return null
  }
}

/** Return true if at least one admin user exists. */
export function adminExists(): boolean {
  try {
    const stmt = getDb().prepare(
      'SELECT 1 FROM users WHERE is_admin = 1 LIMIT 1'
    )
    const row = stmt.value<unknown[]>()
    stmt.finalize()
    return row !== undefined
  } catch (err) {
    log.error(`[auth] adminExists error: ${err}`)
    return false
  }
}

export interface UpsertUserParams {
  provider: AuthProvider
  providerUserId: string
  username: string
  email: string
  avatarUrl: string
  plexAuthToken?: string
}

/**
 * Insert or update a user record.
 * The first user ever created is automatically made admin.
 */
export function upsertUser(params: UpsertUserParams): User {
  const now = new Date().toISOString()
  const shouldBeAdmin = !adminExists() ? 1 : 0
  const providerUserId = String(params.providerUserId || '').trim()
  const username = String(params.username || '').trim()
  const email = String(params.email || '')
  const avatarUrl = String(params.avatarUrl || '')

  const plexAuthToken = params.provider === 'plex' ? String(params.plexAuthToken || '') : ''
  const defaultUsername =
    params.provider === 'email'
      ? 'Email User'
      : params.provider === 'device'
      ? 'Guest'
      : 'Plex User'

  getDb().exec(
    `INSERT INTO users (provider, provider_user_id, username, email, avatar_url, is_admin, plex_auth_token, created_at, last_login)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(provider, provider_user_id) DO UPDATE SET
       username        = CASE WHEN excluded.username != '' THEN excluded.username ELSE username END,
       email           = excluded.email,
       avatar_url      = excluded.avatar_url,
       plex_auth_token = CASE WHEN excluded.plex_auth_token != '' THEN excluded.plex_auth_token ELSE plex_auth_token END,
       last_login      = excluded.last_login`,
    params.provider,
    providerUserId,
    username || defaultUsername,
    email,
    avatarUrl,
    shouldBeAdmin,
    plexAuthToken,
    now,
    now
  )

  const saved = findUser(params.provider, providerUserId)
  if (saved) return saved

  // Fallback for rare SQLite type-affinity or legacy-row mismatches where
  // provider_user_id lookup misses immediately after upsert.
  try {
    const stmt = getDb().prepare(
      `${getUserSelect()} WHERE provider = ? AND username = ? ORDER BY last_login DESC LIMIT 1`
    )
    const fallbackRow = stmt.value<unknown[]>(params.provider, username)
    stmt.finalize()
    if (fallbackRow) return rowToUser(fallbackRow)
  } catch (err) {
    log.warn(`[auth] upsertUser fallback lookup failed: ${err}`)
  }

  throw new Error('[auth] upsertUser: failed to retrieve saved user')
}

/**
 * Update a user's display name (e.g. guest picking their name, or editing it later
 * in settings). Caller is responsible for validating/sanitizing the new name first.
 */
export function updateUsername(userId: number, username: string): void {
  getDb().exec(`UPDATE users SET username = ? WHERE id = ?`, username, userId)
}

/**
 * Get the stored Plex auth token for a user (needed for watchlist/seen sync).
 */
export function getUserPlexAuthToken(userId: number): string {
  try {
    const stmt = getDb().prepare(
      `SELECT COALESCE(plex_auth_token, '') FROM users WHERE id = ? LIMIT 1`
    )
    const row = stmt.value<[string]>(userId)
    stmt.finalize()
    return row ? String(row[0] || '') : ''
  } catch (err) {
    log.error(`[auth] getUserPlexAuthToken error: ${err}`)
    return ''
  }
}

/**
 * Get or create the invite code for a user.
 * Invite codes are stable — they only change if explicitly refreshed.
 */
export function getOrCreateInviteCode(userId: number): string {
  const user = findUserById(userId)
  if (!user)
    throw new Error(`[auth] getOrCreateInviteCode: user ${userId} not found`)
  if (user.inviteCode) return user.inviteCode

  let code: string
  do {
    code = generateInviteCode()
  } while (findUserByInviteCode(code) !== null)

  const stmt = getDb().prepare('UPDATE users SET invite_code = ? WHERE id = ?')
  stmt.run(code, userId)
  stmt.finalize()
  return code
}

/**
 * Generate a brand-new invite code for the user, removing all existing friend connections.
 */
export function refreshInviteCode(userId: number): string {
  // Remove all friend connections for this user (both directions)
  const delStmt = getDb().prepare(
    'DELETE FROM friend_connections WHERE user_id = ? OR friend_user_id = ?'
  )
  delStmt.run(userId, userId)
  delStmt.finalize()

  let code: string
  do {
    code = generateInviteCode()
  } while (findUserByInviteCode(code) !== null)

  const updStmt = getDb().prepare('UPDATE users SET invite_code = ? WHERE id = ?')
  updStmt.run(code, userId)
  updStmt.finalize()
  log.info(`[auth] Refreshed invite code for user ${userId}`)
  return code
}

// ── User settings ──────────────────────────────────────────────────────────

const USER_SETTINGS_SELECT = `
  SELECT user_id, plex_url, plex_token, plex_library_name,
    emby_url, emby_api_key, emby_library_name,
    jellyfin_url, jellyfin_api_key, jellyfin_library_name,
    radarr_url, radarr_api_key, seerr_url, seerr_api_key,
    default_filters, subscriptions,
    COALESCE(plex_watchlist_synced, '{}') as plex_watchlist_synced,
    COALESCE(plex_seen_synced, '{}') as plex_seen_synced,
    COALESCE(display_preferences, '{}') as display_preferences,
    COALESCE(plex_account_token, '') as plex_account_token,
    COALESCE(trakt_access_token, '') as trakt_access_token,
    COALESCE(trakt_refresh_token, '') as trakt_refresh_token,
    COALESCE(trakt_token_expires_at, '') as trakt_token_expires_at,
    COALESCE(trakt_watchlist_synced, '{}') as trakt_watchlist_synced,
    COALESCE(trakt_seen_synced, '{}') as trakt_seen_synced,
    updated_at
  FROM user_settings`

function rowToUserSettings(row: unknown[]): UserSettings {
  const [
    userId,
    plexUrl,
    plexToken,
    plexLibraryName,
    embyUrl,
    embyApiKey,
    embyLibraryName,
    jellyfinUrl,
    jellyfinApiKey,
    jellyfinLibraryName,
    radarrUrl,
    radarrApiKey,
    seerrUrl,
    seerrApiKey,
    defaultFilters,
    subscriptions,
    plexWatchlistSynced,
    plexSeenSynced,
    displayPreferences,
    plexAccountToken,
    traktAccessToken,
    traktRefreshToken,
    traktTokenExpiresAt,
    traktWatchlistSynced,
    traktSeenSynced,
    updatedAt,
  ] = row as string[]
  return {
    userId: Number(userId),
    plexUrl,
    plexToken,
    plexLibraryName,
    embyUrl,
    embyApiKey,
    embyLibraryName,
    jellyfinUrl,
    jellyfinApiKey,
    jellyfinLibraryName,
    radarrUrl,
    radarrApiKey,
    seerrUrl,
    seerrApiKey,
    defaultFilters,
    subscriptions: subscriptions ?? '[]',
    plexWatchlistSynced: plexWatchlistSynced ?? '{}',
    plexSeenSynced: plexSeenSynced ?? '{}',
    displayPreferences: displayPreferences ?? '{}',
    plexAccountToken: plexAccountToken ?? '',
    traktAccessToken: traktAccessToken ?? '',
    traktRefreshToken: traktRefreshToken ?? '',
    traktTokenExpiresAt: traktTokenExpiresAt ?? '',
    traktWatchlistSynced: traktWatchlistSynced ?? '{}',
    traktSeenSynced: traktSeenSynced ?? '{}',
    updatedAt,
  }
}

export function getUserSettings(userId: number): UserSettings | null {
  try {
    const stmt = getDb().prepare(
      `${USER_SETTINGS_SELECT} WHERE user_id = ? LIMIT 1`
    )
    const row = stmt.value<unknown[]>(userId)
    stmt.finalize()
    return row ? rowToUserSettings(row) : null
  } catch (err) {
    log.error(`[auth] getUserSettings error: ${err}`)
    return null
  }
}

export function upsertUserSettings(
  userId: number,
  updates: Partial<Omit<UserSettings, 'userId' | 'updatedAt'>>
): void {
  const now = new Date().toISOString()
  const existing = getUserSettings(userId)

  if (!existing) {
    getDb().exec(
      `INSERT INTO user_settings (user_id, plex_url, plex_token, plex_library_name,
        emby_url, emby_api_key, emby_library_name, jellyfin_url, jellyfin_api_key,
        jellyfin_library_name, radarr_url, radarr_api_key, seerr_url, seerr_api_key,
        default_filters, subscriptions, plex_watchlist_synced, plex_seen_synced,
        display_preferences, plex_account_token, trakt_access_token, trakt_refresh_token,
        trakt_token_expires_at, trakt_watchlist_synced, trakt_seen_synced, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      userId,
      updates.plexUrl ?? '',
      updates.plexToken ?? '',
      updates.plexLibraryName ?? '',
      updates.embyUrl ?? '',
      updates.embyApiKey ?? '',
      updates.embyLibraryName ?? '',
      updates.jellyfinUrl ?? '',
      updates.jellyfinApiKey ?? '',
      updates.jellyfinLibraryName ?? '',
      updates.radarrUrl ?? '',
      updates.radarrApiKey ?? '',
      updates.seerrUrl ?? '',
      updates.seerrApiKey ?? '',
      updates.defaultFilters ?? '{}',
      updates.subscriptions ?? '[]',
      updates.plexWatchlistSynced ?? '{}',
      updates.plexSeenSynced ?? '{}',
      updates.displayPreferences ?? '{}',
      updates.plexAccountToken ?? '',
      updates.traktAccessToken ?? '',
      updates.traktRefreshToken ?? '',
      updates.traktTokenExpiresAt ?? '',
      updates.traktWatchlistSynced ?? '{}',
      updates.traktSeenSynced ?? '{}',
      now
    )
  } else {
    // Callers (e.g. the PUT /api/profile/settings route) build `updates` with every field
    // always present — explicitly `undefined` for whichever ones the client didn't send this
    // time — so a plain `{...existing, ...updates}` spread would overwrite those fields with
    // `undefined` (a key present with value `undefined` still wins over the earlier spread).
    // Drop undefined-valued keys first so a partial update can't clobber the rest.
    const definedUpdates = Object.fromEntries(
      Object.entries(updates).filter(([, value]) => value !== undefined)
    )
    const merged = { ...existing, ...definedUpdates }
    getDb().exec(
      `UPDATE user_settings SET
        plex_url = ?, plex_token = ?, plex_library_name = ?,
        emby_url = ?, emby_api_key = ?, emby_library_name = ?,
        jellyfin_url = ?, jellyfin_api_key = ?, jellyfin_library_name = ?,
        radarr_url = ?, radarr_api_key = ?, seerr_url = ?, seerr_api_key = ?,
        default_filters = ?, subscriptions = ?,
        plex_watchlist_synced = ?, plex_seen_synced = ?,
        display_preferences = ?,
        plex_account_token = ?, trakt_access_token = ?, trakt_refresh_token = ?,
        trakt_token_expires_at = ?, trakt_watchlist_synced = ?, trakt_seen_synced = ?,
        updated_at = ?
       WHERE user_id = ?`,
      merged.plexUrl,
      merged.plexToken,
      merged.plexLibraryName,
      merged.embyUrl,
      merged.embyApiKey,
      merged.embyLibraryName,
      merged.jellyfinUrl,
      merged.jellyfinApiKey,
      merged.jellyfinLibraryName,
      merged.radarrUrl,
      merged.radarrApiKey,
      merged.seerrUrl,
      merged.seerrApiKey,
      merged.defaultFilters,
      merged.subscriptions ?? '[]',
      merged.plexWatchlistSynced ?? '{}',
      merged.plexSeenSynced ?? '{}',
      merged.displayPreferences ?? '{}',
      merged.plexAccountToken ?? '',
      merged.traktAccessToken ?? '',
      merged.traktRefreshToken ?? '',
      merged.traktTokenExpiresAt ?? '',
      merged.traktWatchlistSynced ?? '{}',
      merged.traktSeenSynced ?? '{}',
      now,
      userId
    )
  }
}

/**
 * Get or set the Trakt tokens tied to a user's LOGIN (provider = 'trakt') — parallel to
 * getUserPlexAuthToken, but returns the refresh token/expiry too since Trakt tokens expire.
 */
export function getUserTraktLoginTokens(
  userId: number
): { accessToken: string; refreshToken: string; expiresAt: string } {
  try {
    const stmt = getDb().prepare(
      `SELECT COALESCE(trakt_access_token, ''), COALESCE(trakt_refresh_token, ''),
        COALESCE(trakt_token_expires_at, '') FROM users WHERE id = ? LIMIT 1`
    )
    const row = stmt.value<[string, string, string]>(userId)
    stmt.finalize()
    return row
      ? { accessToken: row[0] || '', refreshToken: row[1] || '', expiresAt: row[2] || '' }
      : { accessToken: '', refreshToken: '', expiresAt: '' }
  } catch (err) {
    log.error(`[auth] getUserTraktLoginTokens error: ${err}`)
    return { accessToken: '', refreshToken: '', expiresAt: '' }
  }
}

export function setUserTraktLoginTokens(
  userId: number,
  tokens: { accessToken: string; refreshToken: string; expiresAt: string }
): void {
  try {
    getDb().exec(
      `UPDATE users SET trakt_access_token = ?, trakt_refresh_token = ?, trakt_token_expires_at = ?
       WHERE id = ?`,
      tokens.accessToken,
      tokens.refreshToken,
      tokens.expiresAt,
      userId
    )
  } catch (err) {
    log.error(`[auth] setUserTraktLoginTokens error: ${err}`)
  }
}

export interface ConnectionStatus {
  connected: boolean
  source: 'login' | 'manual' | null
}

export interface ConnectionsStatus {
  plexAccount: ConnectionStatus
  plexServer: { connected: boolean }
  embyServer: { connected: boolean }
  jellyfinServer: { connected: boolean }
  trakt: ConnectionStatus
}

/**
 * Unified connection status across everything a user might have authorized — independent of
 * how they log into Comparr. "source: 'login'" means the credential came from signing into
 * Comparr with that provider; "manual" means they connected it separately without using it to
 * log in. Either counts as connected; the UI only needs to know which so it can skip asking the
 * user to connect something they've effectively already granted via login.
 */
export function getConnectionsStatus(userId: number): ConnectionsStatus {
  const settings = getUserSettings(userId)

  const plexLoginToken = getUserPlexAuthToken(userId)
  const plexAccountToken = settings?.plexAccountToken ?? ''
  const traktLogin = getUserTraktLoginTokens(userId)
  const traktAccountToken = settings?.traktAccessToken ?? ''

  return {
    plexAccount: {
      connected: Boolean(plexLoginToken) || Boolean(plexAccountToken),
      source: plexLoginToken ? 'login' : plexAccountToken ? 'manual' : null,
    },
    plexServer: { connected: Boolean(settings?.plexUrl && settings?.plexToken) },
    embyServer: { connected: Boolean(settings?.embyUrl && settings?.embyApiKey) },
    jellyfinServer: { connected: Boolean(settings?.jellyfinUrl && settings?.jellyfinApiKey) },
    trakt: {
      connected: Boolean(traktLogin.accessToken) || Boolean(traktAccountToken),
      source: traktLogin.accessToken ? 'login' : traktAccountToken ? 'manual' : null,
    },
  }
}

// ── Friend connections ─────────────────────────────────────────────────────

function rowToFriendConnection(
  row: unknown[],
  friendUsername: string,
  friendInviteCode: string
): FriendConnection {
  const [
    id,
    userId,
    friendUserId,
    status,
    isInitiator,
    sharesServer,
    serverPromptPending,
    createdAt,
    updatedAt,
  ] = row as [number, number, number, string, number, number, number, string, string]
  return {
    id,
    userId,
    friendUserId,
    friendUsername,
    friendInviteCode,
    status: status as FriendStatus,
    isInitiator: isInitiator === 1,
    sharesServer: sharesServer === 1,
    serverPromptPending: serverPromptPending === 1,
    createdAt,
    updatedAt,
  }
}

/**
 * Send a friend request from requesterId to the user identified by inviteCode.
 * Creates a pending connection on both sides.
 */
export function sendFriendRequest(
  requesterId: number,
  recipientInviteCode: string
): { success: boolean; friendName?: string; error?: string } {
  const recipient = findUserByInviteCode(recipientInviteCode)
  if (!recipient) {
    return {
      success: false,
      error: 'Invite code not found. Ask your friend to check their code.',
    }
  }
  if (recipient.id === requesterId) {
    return { success: false, error: 'That is your own invite code.' }
  }

  const now = new Date().toISOString()
  try {
    // Requester → recipient row (pending, is_initiator=1 marks the sender)
    getDb().exec(
      `INSERT INTO friend_connections (user_id, friend_user_id, status, is_initiator, shares_server, server_prompt_pending, created_at, updated_at)
       VALUES (?, ?, 'pending', 1, 0, 0, ?, ?)
       ON CONFLICT(user_id, friend_user_id) DO NOTHING`,
      requesterId,
      recipient.id,
      now,
      now
    )
    // Recipient → requester row (pending, is_initiator=0 marks the receiver)
    getDb().exec(
      `INSERT INTO friend_connections (user_id, friend_user_id, status, is_initiator, shares_server, server_prompt_pending, created_at, updated_at)
       VALUES (?, ?, 'pending', 0, 0, 0, ?, ?)
       ON CONFLICT(user_id, friend_user_id) DO NOTHING`,
      recipient.id,
      requesterId,
      now,
      now
    )
  } catch (err) {
    log.error(`[auth] sendFriendRequest error: ${err}`)
    return { success: false, error: 'Failed to create connection.' }
  }

  log.info(
    `[auth] Friend request: user ${requesterId} → user ${recipient.id} (${recipient.username})`
  )
  return { success: true, friendName: recipient.username }
}

/**
 * Accept a pending friend request.
 * sharesServer: whether the accepting user wants to share their server.
 */
export function acceptFriendRequest(
  recipientId: number,
  requesterId: number,
  sharesServer: boolean
): { success: boolean; error?: string } {
  const now = new Date().toISOString()

  // Mark recipient → requester as accepted
  const r1 = getDb().exec(
    `UPDATE friend_connections SET status = 'accepted', shares_server = ?, updated_at = ?
     WHERE user_id = ? AND friend_user_id = ? AND status = 'pending'`,
    sharesServer ? 1 : 0,
    now,
    recipientId,
    requesterId
  )

  // Mark requester → recipient as accepted too
  getDb().exec(
    `UPDATE friend_connections SET status = 'accepted', updated_at = ?
     WHERE user_id = ? AND friend_user_id = ?`,
    now,
    requesterId,
    recipientId
  )

  // If recipient chose to share their server, set prompt flag for requester
  if (sharesServer) {
    getDb().exec(
      `UPDATE friend_connections SET server_prompt_pending = 1, updated_at = ?
       WHERE user_id = ? AND friend_user_id = ?`,
      now,
      requesterId,
      recipientId
    )
  }

  log.info(
    `[auth] Friend request accepted: user ${recipientId} ← user ${requesterId}`
  )
  return { success: true }
}

/**
 * Turn personal-server sharing with an already-accepted friend on or off, any time after
 * acceptance (acceptFriendRequest above only sets this once, at accept time). Turning sharing
 * on sets server_prompt_pending on the friend's row, same as the accept-time behavior, so they
 * see a "so-and-so shared their library with you" prompt.
 */
export function setSharesServer(
  userId: number,
  friendUserId: number,
  share: boolean
): { success: boolean; error?: string } {
  const stmt = getDb().prepare(
    `SELECT status FROM friend_connections WHERE user_id = ? AND friend_user_id = ? LIMIT 1`
  )
  const row = stmt.value<[string]>(userId, friendUserId)
  stmt.finalize()

  if (!row || row[0] !== 'accepted') {
    return { success: false, error: 'You are not friends with this user.' }
  }

  const now = new Date().toISOString()
  getDb().exec(
    `UPDATE friend_connections SET shares_server = ?, updated_at = ?
     WHERE user_id = ? AND friend_user_id = ?`,
    share ? 1 : 0,
    now,
    userId,
    friendUserId
  )

  if (share) {
    getDb().exec(
      `UPDATE friend_connections SET server_prompt_pending = 1, updated_at = ?
       WHERE user_id = ? AND friend_user_id = ?`,
      now,
      friendUserId,
      userId
    )
  }

  log.info(
    `[auth] User ${userId} ${share ? 'enabled' : 'disabled'} server sharing with ${friendUserId}`
  )
  return { success: true }
}

/**
 * Clear the "friend just turned on sharing" prompt flag on the caller's own row.
 */
export function acknowledgeServerPrompt(
  userId: number,
  friendUserId: number
): void {
  getDb().exec(
    `UPDATE friend_connections SET server_prompt_pending = 0, updated_at = ?
     WHERE user_id = ? AND friend_user_id = ?`,
    new Date().toISOString(),
    userId,
    friendUserId
  )
}

export interface SharedServerInfo {
  friendUserId: number
  friendUsername: string
  plexUrl: string
  plexToken: string
  plexLibraryName: string
  embyUrl: string
  embyApiKey: string
  embyLibraryName: string
  jellyfinUrl: string
  jellyfinApiKey: string
  jellyfinLibraryName: string
}

/**
 * Servers shared *with* this user by accepted friends (i.e. friends who have sharesServer=1
 * on the row pointing at this user). Used by the discovery pipeline to pull friends' libraries
 * into a user's swipe deck.
 */
export function getSharedServersForUser(userId: number): SharedServerInfo[] {
  try {
    const stmt = getDb().prepare(`
      SELECT fc.user_id, u.username,
        us.plex_url, us.plex_token, us.plex_library_name,
        us.emby_url, us.emby_api_key, us.emby_library_name,
        us.jellyfin_url, us.jellyfin_api_key, us.jellyfin_library_name
      FROM friend_connections fc
      JOIN users u ON u.id = fc.user_id
      LEFT JOIN user_settings us ON us.user_id = fc.user_id
      WHERE fc.friend_user_id = ? AND fc.status = 'accepted' AND fc.shares_server = 1
    `)
    const rows = stmt.values<unknown[][]>(userId)
    stmt.finalize()
    return rows.map(row => ({
      friendUserId: Number(row[0]),
      friendUsername: String(row[1] ?? ''),
      plexUrl: String(row[2] ?? ''),
      plexToken: String(row[3] ?? ''),
      plexLibraryName: String(row[4] ?? ''),
      embyUrl: String(row[5] ?? ''),
      embyApiKey: String(row[6] ?? ''),
      embyLibraryName: String(row[7] ?? ''),
      jellyfinUrl: String(row[8] ?? ''),
      jellyfinApiKey: String(row[9] ?? ''),
      jellyfinLibraryName: String(row[10] ?? ''),
    }))
  } catch (err) {
    log.error(`[auth] getSharedServersForUser error: ${err}`)
    return []
  }
}

/**
 * Hide a match from this user's Matches list without changing their (or their friend's)
 * underlying wantsToWatch response — the movie stays in the Watchlist.
 */
export function dismissMatchForUser(userId: number, guid: string): void {
  getDb().exec(
    `INSERT OR REPLACE INTO dismissed_matches (user_id, guid, dismissed_at) VALUES (?, ?, ?)`,
    userId,
    guid,
    new Date().toISOString()
  )
}

export function getDismissedMatchGuids(userId: number): Set<string> {
  const stmt = getDb().prepare(`SELECT guid FROM dismissed_matches WHERE user_id = ?`)
  const rows = stmt.values<unknown[][]>(userId)
  stmt.finalize()
  return new Set(rows.map(row => String(row[0])))
}

/**
 * Decline and remove a pending friend request.
 */
export function declineFriendRequest(
  recipientId: number,
  requesterId: number
): void {
  getDb().exec(
    'DELETE FROM friend_connections WHERE (user_id = ? AND friend_user_id = ?) OR (user_id = ? AND friend_user_id = ?)',
    recipientId,
    requesterId,
    requesterId,
    recipientId
  )
}

/**
 * Remove an existing (accepted) friend connection from both sides.
 */
export function removeFriendConnection(
  userId: number,
  friendUserId: number
): void {
  getDb().exec(
    'DELETE FROM friend_connections WHERE (user_id = ? AND friend_user_id = ?) OR (user_id = ? AND friend_user_id = ?)',
    userId,
    friendUserId,
    friendUserId,
    userId
  )
}

/**
 * Get all friend connections for a user (both pending and accepted).
 */
export function getFriendConnections(userId: number): FriendConnection[] {
  try {
    const stmt = getDb().prepare(`
      SELECT fc.id, fc.user_id, fc.friend_user_id, fc.status, fc.is_initiator, fc.shares_server,
             fc.server_prompt_pending, fc.created_at, fc.updated_at,
             u.username, u.invite_code
      FROM friend_connections fc
      JOIN users u ON u.id = fc.friend_user_id
      WHERE fc.user_id = ?
      ORDER BY fc.created_at DESC
    `)
    const rows = stmt.values<unknown[]>(userId)
    stmt.finalize()
    return rows.map(row => {
      const [
        id,
        uid,
        friendId,
        status,
        isInitiator,
        sharesServer,
        serverPromptPending,
        createdAt,
        updatedAt,
        friendUsername,
        friendInviteCode,
      ] = row as [
        number,
        number,
        number,
        string,
        number,
        number,
        number,
        string,
        string,
        string,
        string
      ]
      return {
        id,
        userId: uid,
        friendUserId: friendId,
        friendUsername,
        friendInviteCode: friendInviteCode ?? '',
        status: status as FriendStatus,
        isInitiator: isInitiator === 1,
        sharesServer: sharesServer === 1,
        serverPromptPending: serverPromptPending === 1,
        createdAt,
        updatedAt,
      }
    })
  } catch (err) {
    log.error(`[auth] getFriendConnections error: ${err}`)
    return []
  }
}

