// src/features/auth/user-db.ts
// SQLite-backed user store. Each row represents one authenticated user,
// keyed by their identity provider and provider-assigned user ID.

import { Database } from 'jsr:@db/sqlite'
import * as log from 'jsr:@std/log'
import { getDataDir } from '../../core/env.ts'

export type AuthProvider = 'plex' | 'jellyfin' | 'emby'

export interface User {
  id: number
  provider: AuthProvider
  providerUserId: string
  username: string
  email: string
  avatarUrl: string
  isAdmin: boolean
  createdAt: string
  lastLogin: string
}

const DB_PATH = `${getDataDir()}/users.db`

let db: Database | null = null

export function initUserDatabase(): Database {
  if (db) return db

  try {
    db = new Database(DB_PATH)
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        provider         TEXT    NOT NULL,
        provider_user_id TEXT    NOT NULL,
        username         TEXT    NOT NULL,
        email            TEXT    NOT NULL DEFAULT '',
        avatar_url       TEXT    NOT NULL DEFAULT '',
        is_admin         INTEGER NOT NULL DEFAULT 0,
        created_at       TEXT    NOT NULL,
        last_login       TEXT    NOT NULL,
        UNIQUE(provider, provider_user_id)
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

function rowToUser(row: unknown[]): User {
  const [id, provider, providerUserId, username, email, avatarUrl, isAdmin, createdAt, lastLogin] = row as [
    number, string, string, string, string, string, number, string, string
  ]
  return {
    id,
    provider: provider as AuthProvider,
    providerUserId,
    username,
    email,
    avatarUrl,
    isAdmin: isAdmin === 1,
    createdAt,
    lastLogin,
  }
}

/** Return the user for a given provider + provider user ID, or null. */
export function findUser(provider: AuthProvider, providerUserId: string): User | null {
  try {
    const stmt = getDb().prepare(
      'SELECT id, provider, provider_user_id, username, email, avatar_url, is_admin, created_at, last_login FROM users WHERE provider = ? AND provider_user_id = ? LIMIT 1'
    )
    const row = stmt.value<unknown[]>(provider, providerUserId)
    stmt.finalize()
    return row ? rowToUser(row) : null
  } catch (err) {
    log.error(`[auth] findUser error: ${err}`)
    return null
  }
}

/** Find user by internal numeric ID. */
export function findUserById(id: number): User | null {
  try {
    const stmt = getDb().prepare(
      'SELECT id, provider, provider_user_id, username, email, avatar_url, is_admin, created_at, last_login FROM users WHERE id = ? LIMIT 1'
    )
    const row = stmt.value<unknown[]>(id)
    stmt.finalize()
    return row ? rowToUser(row) : null
  } catch (err) {
    log.error(`[auth] findUserById error: ${err}`)
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
 * The first user ever created (when no admin exists) is automatically made admin.
 * Returns the saved User.
 */
export function upsertUser(params: UpsertUserParams): User {
  const now = new Date().toISOString()
  const shouldBeAdmin = !adminExists() ? 1 : 0

  getDb().exec(
    `INSERT INTO users (provider, provider_user_id, username, email, avatar_url, is_admin, created_at, last_login)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(provider, provider_user_id) DO UPDATE SET
       username   = excluded.username,
       email      = excluded.email,
       avatar_url = excluded.avatar_url,
       last_login = excluded.last_login`,
    params.provider,
    params.providerUserId,
    params.username,
    params.email,
    params.avatarUrl,
    shouldBeAdmin,
    now,
    now
  )

  const saved = findUser(params.provider, params.providerUserId)
  if (!saved) throw new Error('[auth] upsertUser: failed to retrieve saved user')
  return saved
}
