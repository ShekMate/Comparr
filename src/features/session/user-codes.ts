// deno-lint-ignore-file
import * as log from 'jsr:@std/log'
import { getDataDir } from '../../core/config.ts'
import { getCompareMatches } from './session.ts'

// ── Constants ──────────────────────────────────────────────────────────────
const CODE_MAP = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789'
export const USER_CODE_LENGTH = 6

// ── Types ──────────────────────────────────────────────────────────────────
interface UserConnection {
  code: string
  // roomCode is stored so we can compute match intersections per friend
  roomCode: string
  name: string
}

interface UserCodeRecord {
  code: string
  // roomCode is the user's *current* session room — updated on each request
  // so match computation always uses the latest data. It is NOT an identity key.
  roomCode: string
  name: string
  connections: UserConnection[]
}

type PersistedUserCodes = Record<
  string,
  { roomCode: string; name: string; connections: UserConnection[] }
>

// ── In-memory store ────────────────────────────────────────────────────────
// Keyed by authenticated user name only — room codes are ephemeral session
// details and must not be part of the user's stable identity.
const codeByName = new Map<string, string>()           // name → code
const recordByCode = new Map<string, UserCodeRecord>() // code → record

// ── Persistence ────────────────────────────────────────────────────────────
const DATA_DIR = getDataDir()
const USER_CODES_FILE = `${DATA_DIR}/user-codes.json`
let loaded = false

async function ensureLoaded() {
  if (loaded) return
  loaded = true
  try {
    const raw = await Deno.readTextFile(USER_CODES_FILE)
    const parsed: PersistedUserCodes = JSON.parse(raw)
    for (const [code, entry] of Object.entries(parsed)) {
      if (!entry?.name) continue
      if (!/^[A-Z0-9]{6}$/.test(code)) continue
      const record: UserCodeRecord = {
        code,
        roomCode: String(entry.roomCode || ''),
        name: String(entry.name),
        connections: Array.isArray(entry.connections)
          ? entry.connections.filter(
              c =>
                c &&
                typeof c.code === 'string' &&
                typeof c.name === 'string'
            )
          : [],
      }
      recordByCode.set(code, record)
      codeByName.set(record.name, code)
    }
    log.info(`[user-codes] Loaded ${recordByCode.size} user code(s)`)
  } catch {
    // No persisted codes yet — that's fine
  }
}

async function persist() {
  const out: PersistedUserCodes = {}
  for (const [code, record] of recordByCode.entries()) {
    out[code] = {
      roomCode: record.roomCode,
      name: record.name,
      connections: record.connections,
    }
  }
  await Deno.mkdir(DATA_DIR, { recursive: true }).catch(() => {})
  const tmp = `${USER_CODES_FILE}.tmp.${Date.now()}`
  await Deno.writeTextFile(tmp, JSON.stringify(out, null, 2))
  await Deno.rename(tmp, USER_CODES_FILE)
}

// ── Code generation ────────────────────────────────────────────────────────
function generateCode(): string {
  return Array.from({ length: USER_CODE_LENGTH }, () => {
    const val = crypto.getRandomValues(new Uint32Array(1))[0]
    return CODE_MAP[val % CODE_MAP.length]
  }).join('')
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Get (or create) the user's static code.
 * roomCode is stored/updated so match computation works, but it is NOT
 * part of the identity key — the code persists across room changes.
 */
export async function getOrCreateUserCode(
  name: string,
  roomCode: string
): Promise<string> {
  await ensureLoaded()

  const existing = codeByName.get(name)
  if (existing && recordByCode.has(existing)) {
    // Keep the stored roomCode current so matches compute correctly
    const record = recordByCode.get(existing)!
    if (record.roomCode !== roomCode) {
      record.roomCode = roomCode
      await persist()
    }
    return existing
  }

  let code: string
  do {
    code = generateCode()
  } while (recordByCode.has(code))

  const record: UserCodeRecord = { code, roomCode, name, connections: [] }
  recordByCode.set(code, record)
  codeByName.set(name, code)
  await persist()
  log.info(`[user-codes] Created code ${code} for ${name}`)
  return code
}

/**
 * Link the caller and the user identified by friendCode.
 * Both sides are connected automatically — either user adding the other is enough.
 */
export async function addConnection(
  myName: string,
  myRoomCode: string,
  friendCode: string
): Promise<{ success: boolean; friendName?: string; error?: string }> {
  await ensureLoaded()

  const normalizedFriendCode = friendCode.trim().toUpperCase()
  const friend = recordByCode.get(normalizedFriendCode)
  if (!friend) {
    return {
      success: false,
      error: 'Code not found. Ask your friend to check their code.',
    }
  }

  const myCodeStr = await getOrCreateUserCode(myName, myRoomCode)
  if (myCodeStr === normalizedFriendCode) {
    return { success: false, error: 'That is your own code.' }
  }

  const myRecord = recordByCode.get(myCodeStr)!

  // Idempotent — add only if not already connected
  if (!myRecord.connections.some(c => c.code === normalizedFriendCode)) {
    myRecord.connections.push({
      code: normalizedFriendCode,
      roomCode: friend.roomCode,
      name: friend.name,
    })
  }

  if (!friend.connections.some(c => c.code === myCodeStr)) {
    friend.connections.push({
      code: myCodeStr,
      roomCode: myRoomCode,
      name: myName,
    })
  }

  await persist()
  log.info(
    `[user-codes] ${myName} (${myCodeStr}) connected to ${friend.name} (${normalizedFriendCode})`
  )
  return { success: true, friendName: friend.name }
}

/**
 * Remove a specific connection (both sides).
 */
export async function removeConnection(
  myName: string,
  friendCode: string
): Promise<boolean> {
  await ensureLoaded()

  const myCode = codeByName.get(myName)
  if (!myCode) return false

  const myRecord = recordByCode.get(myCode)
  if (!myRecord) return false

  const normalizedFriendCode = friendCode.trim().toUpperCase()
  myRecord.connections = myRecord.connections.filter(
    c => c.code !== normalizedFriendCode
  )

  const friendRecord = recordByCode.get(normalizedFriendCode)
  if (friendRecord) {
    friendRecord.connections = friendRecord.connections.filter(
      c => c.code !== myCode
    )
  }

  await persist()
  log.info(`[user-codes] ${myName} removed connection ${normalizedFriendCode}`)
  return true
}

/**
 * Generate a brand-new code for the user, clearing all connections.
 * Removes the user from every connected friend's list too.
 */
export async function refreshUserCode(
  name: string,
  roomCode: string
): Promise<string> {
  await ensureLoaded()

  const oldCode = codeByName.get(name)
  if (oldCode) {
    const oldRecord = recordByCode.get(oldCode)
    if (oldRecord) {
      for (const conn of oldRecord.connections) {
        const connRecord = recordByCode.get(conn.code)
        if (connRecord) {
          connRecord.connections = connRecord.connections.filter(
            c => c.code !== oldCode
          )
        }
      }
    }
    recordByCode.delete(oldCode)
  }
  codeByName.delete(name)

  let newCode: string
  do {
    newCode = generateCode()
  } while (recordByCode.has(newCode))

  const record: UserCodeRecord = { code: newCode, roomCode, name, connections: [] }
  recordByCode.set(newCode, record)
  codeByName.set(name, newCode)
  await persist()
  log.info(`[user-codes] Refreshed code for ${name} → ${newCode}`)
  return newCode
}

/**
 * Return all connections for a user with their matched movies.
 */
export async function getConnections(
  name: string,
  roomCode: string
): Promise<
  Array<{ code: string; name: string; matches: ReturnType<typeof getCompareMatches> }>
> {
  await ensureLoaded()

  // Keep roomCode current
  const myCode = codeByName.get(name)
  if (myCode) {
    const rec = recordByCode.get(myCode)
    if (rec && rec.roomCode !== roomCode) {
      rec.roomCode = roomCode
      // No need to persist just for a roomCode update — will persist on next write
    }
  }

  if (!myCode) return []
  const myRecord = recordByCode.get(myCode)
  if (!myRecord) return []

  return myRecord.connections.map(conn => ({
    code: conn.code,
    name: conn.name,
    matches: getCompareMatches(roomCode, name, conn.roomCode, conn.name),
  }))
}
