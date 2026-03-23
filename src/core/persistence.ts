// persistence.ts (Deno)
// Minimal file-based persistence for per-room user responses

import * as log from 'jsr:@std/log'
import { getDataDir } from './env.ts'

export type PersistedResponse = {
  guid: string
  key?: string | null
  wantsToWatch: boolean
}

export type PersistedRoom = {
  users: Record<string, { responses: PersistedResponse[] }>
}

export type PersistedState = {
  version: 1
  rooms: Record<string, PersistedRoom>
}

const DATA_DIR = getDataDir()
const STATE_FILE = `${DATA_DIR}/session-state.json`

let state: PersistedState = { version: 1, rooms: {} }
let writeQueued = false

// Ensure data dir exists
async function ensureDir() {
  try {
    await Deno.mkdir(DATA_DIR, { recursive: true })
  } catch (_) {
    /* ignore */
  }
}

export async function loadState(): Promise<PersistedState> {
  await ensureDir()
  try {
    const txt = await Deno.readTextFile(STATE_FILE)
    const parsed = JSON.parse(txt) as PersistedState
    // Basic sanity
    if (!parsed || typeof parsed !== 'object' || !parsed.rooms) {
      return state
    }
    state = parsed
  } catch (_) {
    // File may not exist on first run — that’s fine
  }
  return state
}

// Debounced write (batch fast changes)
let _pending: Promise<void> | null = null
export function saveStateSoon() {
  if (writeQueued) return
  writeQueued = true
  _pending = (async () => {
    try {
      await ensureDir()
      // small debounce
      await new Promise(r => setTimeout(r, 300))
      const tmpFile = `${STATE_FILE}.tmp`
      await Deno.writeTextFile(tmpFile, JSON.stringify(state, null, 2))
      await Deno.rename(tmpFile, STATE_FILE) // atomic-ish on same fs
    } catch (e) {
      log.error(`Failed to persist session state: ${e}`)
    } finally {
      writeQueued = false
    }
  })()
}

export function getRoom(roomCode: string): PersistedRoom {
  if (!state.rooms[roomCode]) {
    state.rooms[roomCode] = { users: {} }
    saveStateSoon()
  }
  return state.rooms[roomCode]
}

export function setUserResponses(
  roomCode: string,
  userName: string,
  responses: PersistedResponse[]
) {
  const room = getRoom(roomCode)
  if (!room.users[userName]) {
    room.users[userName] = { responses: [] }
  }
  room.users[userName].responses = responses
  saveStateSoon()
}

export function getUserResponses(
  roomCode: string,
  userName: string
): PersistedResponse[] {
  const room = getRoom(roomCode)
  return room.users[userName]?.responses ?? []
}

export function getAllUsers(
  roomCode: string
): Record<string, { responses: PersistedResponse[] }> {
  return getRoom(roomCode).users
}

export function getAllRooms(): Record<string, PersistedRoom> {
  return { ...state.rooms }
}

export function clearAllRooms(): void {
  state.rooms = {}
  saveStateSoon()
}

export function clearRooms(roomCodes: string[]): void {
  for (const code of roomCodes) {
    delete state.rooms[code]
  }
  saveStateSoon()
}

export function clearUsersFromRoom(
  roomCode: string,
  userNames: string[]
): void {
  if (!state.rooms[roomCode]) return
  for (const name of userNames) {
    delete state.rooms[roomCode].users[name]
  }
  // Remove the room entirely if no users remain
  if (Object.keys(state.rooms[roomCode].users).length === 0) {
    delete state.rooms[roomCode]
  }
  saveStateSoon()
}
