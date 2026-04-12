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
  roomCode: string
  name: string
}

interface UserCodeRecord {
  code: string
  roomCode: string
  name: string
  connections: UserConnection[]
}

type PersistedUserCodes = Record<
  string,
  { roomCode: string; name: string; connections: UserConnection[] }
>

// ── In-memory store ────────────────────────────────────────────────────────
const codeByUser = new Map<string, string>() // `${roomCode}:${name}` → code
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
      if (!entry?.roomCode || !entry?.name) continue
      if (!/^[A-Z0-9]{6}$/.test(code)) continue
      const record: UserCodeRecord = {
        code,
        roomCode: String(entry.roomCode),
        name: String(entry.name),
        connections: Array.isArray(entry.connections)
          ? entry.connections.filter(
              c => c && typeof c.code === 'string' && typeof c.roomCode === 'string' && typeof c.name === 'string'
            )
          : [],
      }
      recordByCode.set(code, record)
      codeByUser.set(`${record.roomCode}:${record.name}`, code)
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

export function isValidUserCode(code: string): boolean {
  return new RegExp(`^[A-Z0-9]{${USER_CODE_LENGTH}}$`).test(
    String(code || '').trim().toUpperCase()
  )
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Get the current user code for (roomCode, name), creating one if missing.
 */
export async function getOrCreateUserCode(
  roomCode: string,
  name: string
): Promise<string> {
  await ensureLoaded()
  const key = `${roomCode}:${name}`
  const existing = codeByUser.get(key)
  if (existing && recordByCode.has(existing)) return existing

  let code: string
  do {
    code = generateCode()
  } while (recordByCode.has(code))

  const record: UserCodeRecord = { code, roomCode, name, connections: [] }
  recordByCode.set(code, record)
  codeByUser.set(key, code)
  await persist()
  log.info(`[user-codes] Created code ${code} for ${name} in room ${roomCode}`)
  return code
}

/**
 * Add a connection between the caller and the user identified by friendCode.
 * Both sides are linked automatically.
 */
export async function addConnection(
  myRoomCode: string,
  myName: string,
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

  // Don't let a user add themselves
  const myCodeStr = await getOrCreateUserCode(myRoomCode, myName)
  if (myCodeStr === normalizedFriendCode) {
    return { success: false, error: 'That is your own code.' }
  }

  const myRecord = recordByCode.get(myCodeStr)!

  // Add friend to my list (idempotent)
  if (!myRecord.connections.some(c => c.code === normalizedFriendCode)) {
    myRecord.connections.push({
      code: normalizedFriendCode,
      roomCode: friend.roomCode,
      name: friend.name,
    })
  }

  // Add me to friend's list (idempotent)
  if (!friend.connections.some(c => c.code === myCodeStr)) {
    friend.connections.push({
      code: myCodeStr,
      roomCode: myRoomCode,
      name: myName,
    })
  }

  await persist()
  log.info(`[user-codes] ${myName} (${myCodeStr}) connected to ${friend.name} (${normalizedFriendCode})`)
  return { success: true, friendName: friend.name }
}

/**
 * Remove a connection between the caller and friendCode (both sides).
 */
export async function removeConnection(
  myRoomCode: string,
  myName: string,
  friendCode: string
): Promise<boolean> {
  await ensureLoaded()
  const key = `${myRoomCode}:${myName}`
  const myCode = codeByUser.get(key)
  if (!myCode) return false

  const myRecord = recordByCode.get(myCode)
  if (!myRecord) return false

  const normalizedFriendCode = friendCode.trim().toUpperCase()
  myRecord.connections = myRecord.connections.filter(
    c => c.code !== normalizedFriendCode
  )

  // Remove reverse link
  const friendRecord = recordByCode.get(normalizedFriendCode)
  if (friendRecord) {
    friendRecord.connections = friendRecord.connections.filter(
      c => c.code !== myCode
    )
  }

  await persist()
  log.info(`[user-codes] ${myName} removed connection to ${normalizedFriendCode}`)
  return true
}

/**
 * Generate a brand-new code for the user, clearing all their connections.
 * Also removes them from every connected user's list.
 */
export async function refreshUserCode(
  roomCode: string,
  name: string
): Promise<string> {
  await ensureLoaded()
  const key = `${roomCode}:${name}`
  const oldCode = codeByUser.get(key)

  if (oldCode) {
    const oldRecord = recordByCode.get(oldCode)
    if (oldRecord) {
      // Remove me from all my connections' lists
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
  codeByUser.delete(key)

  let newCode: string
  do {
    newCode = generateCode()
  } while (recordByCode.has(newCode))

  const record: UserCodeRecord = {
    code: newCode,
    roomCode,
    name,
    connections: [],
  }
  recordByCode.set(newCode, record)
  codeByUser.set(key, newCode)
  await persist()
  log.info(`[user-codes] Refreshed code for ${name} in room ${roomCode} → ${newCode}`)
  return newCode
}

/**
 * Return all connections for a user along with their matched movies.
 */
export async function getConnections(
  roomCode: string,
  name: string
): Promise<
  Array<{ code: string; name: string; matches: ReturnType<typeof getCompareMatches> }>
> {
  await ensureLoaded()
  const myCode = codeByUser.get(`${roomCode}:${name}`)
  if (!myCode) return []

  const myRecord = recordByCode.get(myCode)
  if (!myRecord) return []

  return myRecord.connections.map(conn => ({
    code: conn.code,
    name: conn.name,
    matches: getCompareMatches(roomCode, name, conn.roomCode, conn.name),
  }))
}
