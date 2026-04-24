// src/features/auth/user-db.ts
// SQLite-backed user store. Provider is always 'plex'.
// Also manages per-user settings and friend connections.

import { Database } from 'jsr:@db/sqlite'
import * as log from 'jsr:@std/log'
import { getDataDir } from '../../core/env.ts'

export type AuthProvider = 'plex'

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

    // Add invite_code column to existing databases that predate this schema
    try {
      db.exec(`ALTER TABLE users ADD COLUMN invite_code TEXT UNIQUE`)
    } catch {
      // Column already exists — ignore
    }

    // Add subscriptions column to existing user_settings tables
    try {
      db.exec(`ALTER TABLE user_settings ADD COLUMN subscriptions TEXT NOT NULL DEFAULT '[]'`)
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
        updated_at          TEXT NOT NULL
      )
    `)

    // Two rows per friendship — one for each direction.
    // shares_server: does THIS user share their server with friend?
    // server_prompt_pending: friend recently turned on sharing; THIS user hasn't been prompted yet.
    db.exec(`
      CREATE TABLE IF NOT EXISTS friend_connections (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id               INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        friend_user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status                TEXT    NOT NULL DEFAULT 'pending',
        shares_server         INTEGER NOT NULL DEFAULT 0,
        server_prompt_pending INTEGER NOT NULL DEFAULT 0,
        created_at            TEXT    NOT NULL,
        updated_at            TEXT    NOT NULL,
        UNIQUE(user_id, friend_user_id)
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
  const [id, provider, providerUserId, username, email, avatarUrl, isAdmin, inviteCode, createdAt, lastLogin] = row as [
    number, string, string, string, string, string, number, string | null, string, string
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
  if (_usersHasInviteCodeColumn !== null) return _usersHasInviteCodeColumn
  try {
    const stmt = getDb().prepare(`PRAGMA table_info(users)`)
    const rows = stmt.all<unknown[]>()
    stmt.finalize()
    _usersHasInviteCodeColumn = rows.some(row => String(row?.[1] || '') === 'invite_code')
  } catch {
    _usersHasInviteCodeColumn = false
  }
  return _usersHasInviteCodeColumn
}

function getUserSelect(): string {
  // Older databases may not have invite_code due SQLite ALTER limitations.
  // Use a synthetic empty column so row mapping stays stable.
  if (!usersHasInviteCodeColumn()) {
    return `SELECT id, provider, provider_user_id, username, email, avatar_url, is_admin, '' as invite_code, created_at, last_login FROM users`
  }
  return `SELECT id, provider, provider_user_id, username, email, avatar_url, is_admin, invite_code, created_at, last_login FROM users`
}

export function findUser(provider: AuthProvider, providerUserId: string): User | null {
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

export function findUserByInviteCode(inviteCode: string): User | null {
  try {
    if (!usersHasInviteCodeColumn()) return null
    const stmt = getDb().prepare(`${getUserSelect()} WHERE invite_code = ? LIMIT 1`)
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
    const stmt = getDb().prepare('SELECT 1 FROM users WHERE is_admin = 1 LIMIT 1')
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
}

/**
 * Insert or update a user record.
 * The first user ever created is automatically made admin.
 */
export function upsertUser(params: UpsertUserParams): User {
  const now = new Date().toISOString()
  const shouldBeAdmin = !adminExists() ? 1 : 0
  const providerUserId = String(params.providerUserId || '').trim()
  const username = String(params.username || '').trim() || 'Plex User'
  const email = String(params.email || '')
  const avatarUrl = String(params.avatarUrl || '')

  getDb().exec(
    `INSERT INTO users (provider, provider_user_id, username, email, avatar_url, is_admin, created_at, last_login)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(provider, provider_user_id) DO UPDATE SET
       username   = excluded.username,
       email      = excluded.email,
       avatar_url = excluded.avatar_url,
       last_login = excluded.last_login`,
    params.provider,
    providerUserId,
    username,
    email,
    avatarUrl,
    shouldBeAdmin,
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
 * Get or create the invite code for a user.
 * Invite codes are stable — they only change if explicitly refreshed.
 */
export function getOrCreateInviteCode(userId: number): string {
  const user = findUserById(userId)
  if (!user) throw new Error(`[auth] getOrCreateInviteCode: user ${userId} not found`)
  if (user.inviteCode) return user.inviteCode

  let code: string
  do {
    code = generateInviteCode()
  } while (findUserByInviteCode(code) !== null)

  getDb().exec('UPDATE users SET invite_code = ? WHERE id = ?', code, userId)
  return code
}

/**
 * Generate a brand-new invite code for the user, removing all existing friend connections.
 */
export function refreshInviteCode(userId: number): string {
  // Remove all friend connections for this user (both directions)
  getDb().exec(
    'DELETE FROM friend_connections WHERE user_id = ? OR friend_user_id = ?',
    userId, userId
  )

  let code: string
  do {
    code = generateInviteCode()
  } while (findUserByInviteCode(code) !== null)

  getDb().exec('UPDATE users SET invite_code = ? WHERE id = ?', code, userId)
  log.info(`[auth] Refreshed invite code for user ${userId}`)
  return code
}

// ── User settings ──────────────────────────────────────────────────────────

const USER_SETTINGS_SELECT = `
  SELECT user_id, plex_url, plex_token, plex_library_name,
    emby_url, emby_api_key, emby_library_name,
    jellyfin_url, jellyfin_api_key, jellyfin_library_name,
    radarr_url, radarr_api_key, seerr_url, seerr_api_key,
    default_filters, subscriptions, updated_at
  FROM user_settings`

function rowToUserSettings(row: unknown[]): UserSettings {
  const [userId, plexUrl, plexToken, plexLibraryName, embyUrl, embyApiKey, embyLibraryName,
    jellyfinUrl, jellyfinApiKey, jellyfinLibraryName, radarrUrl, radarrApiKey,
    seerrUrl, seerrApiKey, defaultFilters, subscriptions, updatedAt] = row as string[]
  return {
    userId: Number(userId),
    plexUrl, plexToken, plexLibraryName,
    embyUrl, embyApiKey, embyLibraryName,
    jellyfinUrl, jellyfinApiKey, jellyfinLibraryName,
    radarrUrl, radarrApiKey,
    seerrUrl, seerrApiKey,
    defaultFilters,
    subscriptions: subscriptions ?? '[]',
    updatedAt,
  }
}

export function getUserSettings(userId: number): UserSettings | null {
  try {
    const stmt = getDb().prepare(`${USER_SETTINGS_SELECT} WHERE user_id = ? LIMIT 1`)
    const row = stmt.value<unknown[]>(userId)
    stmt.finalize()
    return row ? rowToUserSettings(row) : null
  } catch (err) {
    log.error(`[auth] getUserSettings error: ${err}`)
    return null
  }
}

export function upsertUserSettings(userId: number, updates: Partial<Omit<UserSettings, 'userId' | 'updatedAt'>>): void {
  const now = new Date().toISOString()
  const existing = getUserSettings(userId)

  if (!existing) {
    getDb().exec(
      `INSERT INTO user_settings (user_id, plex_url, plex_token, plex_library_name,
        emby_url, emby_api_key, emby_library_name, jellyfin_url, jellyfin_api_key,
        jellyfin_library_name, radarr_url, radarr_api_key, seerr_url, seerr_api_key,
        default_filters, subscriptions, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      now
    )
  } else {
    const merged = { ...existing, ...updates }
    getDb().exec(
      `UPDATE user_settings SET
        plex_url = ?, plex_token = ?, plex_library_name = ?,
        emby_url = ?, emby_api_key = ?, emby_library_name = ?,
        jellyfin_url = ?, jellyfin_api_key = ?, jellyfin_library_name = ?,
        radarr_url = ?, radarr_api_key = ?, seerr_url = ?, seerr_api_key = ?,
        default_filters = ?, subscriptions = ?, updated_at = ?
       WHERE user_id = ?`,
      merged.plexUrl, merged.plexToken, merged.plexLibraryName,
      merged.embyUrl, merged.embyApiKey, merged.embyLibraryName,
      merged.jellyfinUrl, merged.jellyfinApiKey, merged.jellyfinLibraryName,
      merged.radarrUrl, merged.radarrApiKey, merged.seerrUrl, merged.seerrApiKey,
      merged.defaultFilters, merged.subscriptions ?? '[]', now,
      userId
    )
  }
}

// ── Friend connections ─────────────────────────────────────────────────────

function rowToFriendConnection(row: unknown[], friendUsername: string, friendInviteCode: string): FriendConnection {
  const [id, userId, friendUserId, status, sharesServer, serverPromptPending, createdAt, updatedAt] = row as [
    number, number, number, string, number, number, string, string
  ]
  return {
    id,
    userId,
    friendUserId,
    friendUsername,
    friendInviteCode,
    status: status as FriendStatus,
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
    return { success: false, error: 'Invite code not found. Ask your friend to check their code.' }
  }
  if (recipient.id === requesterId) {
    return { success: false, error: 'That is your own invite code.' }
  }

  const now = new Date().toISOString()
  try {
    // Requester → recipient row (pending)
    getDb().exec(
      `INSERT INTO friend_connections (user_id, friend_user_id, status, shares_server, server_prompt_pending, created_at, updated_at)
       VALUES (?, ?, 'pending', 0, 0, ?, ?)
       ON CONFLICT(user_id, friend_user_id) DO NOTHING`,
      requesterId, recipient.id, now, now
    )
    // Recipient → requester row (pending, recipient needs to accept)
    getDb().exec(
      `INSERT INTO friend_connections (user_id, friend_user_id, status, shares_server, server_prompt_pending, created_at, updated_at)
       VALUES (?, ?, 'pending', 0, 0, ?, ?)
       ON CONFLICT(user_id, friend_user_id) DO NOTHING`,
      recipient.id, requesterId, now, now
    )
  } catch (err) {
    log.error(`[auth] sendFriendRequest error: ${err}`)
    return { success: false, error: 'Failed to create connection.' }
  }

  log.info(`[auth] Friend request: user ${requesterId} → user ${recipient.id} (${recipient.username})`)
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
    sharesServer ? 1 : 0, now, recipientId, requesterId
  )

  // Mark requester → recipient as accepted too
  getDb().exec(
    `UPDATE friend_connections SET status = 'accepted', updated_at = ?
     WHERE user_id = ? AND friend_user_id = ?`,
    now, requesterId, recipientId
  )

  // If recipient chose to share their server, set prompt flag for requester
  if (sharesServer) {
    getDb().exec(
      `UPDATE friend_connections SET server_prompt_pending = 1, updated_at = ?
       WHERE user_id = ? AND friend_user_id = ?`,
      now, requesterId, recipientId
    )
  }

  log.info(`[auth] Friend request accepted: user ${recipientId} ← user ${requesterId}`)
  return { success: true }
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
    recipientId, requesterId, requesterId, recipientId
  )
}

/**
 * Remove an existing (accepted) friend connection from both sides.
 */
export function removeFriendConnection(userId: number, friendUserId: number): void {
  getDb().exec(
    'DELETE FROM friend_connections WHERE (user_id = ? AND friend_user_id = ?) OR (user_id = ? AND friend_user_id = ?)',
    userId, friendUserId, friendUserId, userId
  )
}

/**
 * Toggle server sharing for a specific friendship.
 * If turning ON, sets server_prompt_pending on the friend's side so they get re-prompted.
 */
export function updateFriendSharing(
  userId: number,
  friendUserId: number,
  sharesServer: boolean
): void {
  const now = new Date().toISOString()
  getDb().exec(
    `UPDATE friend_connections SET shares_server = ?, updated_at = ?
     WHERE user_id = ? AND friend_user_id = ? AND status = 'accepted'`,
    sharesServer ? 1 : 0, now, userId, friendUserId
  )

  if (sharesServer) {
    // Notify friend they need to be re-prompted about accepting the server
    getDb().exec(
      `UPDATE friend_connections SET server_prompt_pending = 1, updated_at = ?
       WHERE user_id = ? AND friend_user_id = ? AND status = 'accepted'`,
      now, friendUserId, userId
    )
  }
}

/**
 * Mark server prompt as seen for a user/friend pair.
 * acceptsServer: whether the user accepts the friend's shared server.
 */
export function resolveServerPrompt(
  userId: number,
  friendUserId: number,
  acceptsServer: boolean
): void {
  const now = new Date().toISOString()
  // Clear the prompt flag
  getDb().exec(
    `UPDATE friend_connections SET server_prompt_pending = 0, updated_at = ?
     WHERE user_id = ? AND friend_user_id = ?`,
    now, userId, friendUserId
  )
  // If they declined, turn off sharing on the friend's side for this user
  if (!acceptsServer) {
    getDb().exec(
      `UPDATE friend_connections SET shares_server = 0, updated_at = ?
       WHERE user_id = ? AND friend_user_id = ?`,
      now, friendUserId, userId
    )
  }
}

/**
 * Get all friend connections for a user (both pending and accepted).
 */
export function getFriendConnections(userId: number): FriendConnection[] {
  try {
    const stmt = getDb().prepare(`
      SELECT fc.id, fc.user_id, fc.friend_user_id, fc.status, fc.shares_server,
             fc.server_prompt_pending, fc.created_at, fc.updated_at,
             u.username, u.invite_code
      FROM friend_connections fc
      JOIN users u ON u.id = fc.friend_user_id
      WHERE fc.user_id = ?
      ORDER BY fc.created_at DESC
    `)
    const rows = stmt.values<unknown[][]>(userId)
    stmt.finalize()
    return rows.map(row => {
      const [id, uid, friendId, status, sharesServer, serverPromptPending, createdAt, updatedAt, friendUsername, friendInviteCode] = row as [
        number, number, number, string, number, number, string, string, string, string
      ]
      return {
        id,
        userId: uid,
        friendUserId: friendId,
        friendUsername,
        friendInviteCode: friendInviteCode ?? '',
        status: status as FriendStatus,
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

/**
 * Get friend IDs for a user who have accepted connections.
 * Used by the swiping queue to prioritize friend-liked movies.
 */
export function getAcceptedFriendIds(userId: number): number[] {
  try {
    const stmt = getDb().prepare(
      `SELECT friend_user_id FROM friend_connections
       WHERE user_id = ? AND status = 'accepted'`
    )
    const rows = stmt.values<[number][]>(userId)
    stmt.finalize()
    return rows.map(r => r[0])
  } catch (err) {
    log.error(`[auth] getAcceptedFriendIds error: ${err}`)
    return []
  }
}
