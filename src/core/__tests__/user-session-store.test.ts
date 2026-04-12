// Tests for src/core/user-session-store.ts

import { assertEquals, assertExists } from '../../testdata/test-helpers.ts'
import {
  createUserSession,
  getUserSession,
  invalidateUserSession,
  clearUserSessions,
} from '../user-session-store.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<Parameters<typeof createUserSession>[0]> = {}) {
  return {
    userId: 1,
    provider: 'plex' as const,
    providerUserId: 'plex-001',
    username: 'TestUser',
    avatarUrl: '',
    isAdmin: false,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test('user-session-store: createUserSession returns a non-empty token', () => {
  clearUserSessions()
  const token = createUserSession(makeSession())
  assertExists(token)
  assertEquals(typeof token, 'string')
  assertEquals(token.length > 0, true)
})

Deno.test('user-session-store: getUserSession returns session for valid token', () => {
  clearUserSessions()
  const token = createUserSession(makeSession({ username: 'Alice' }))
  const session = getUserSession(token)
  assertExists(session)
  assertEquals(session!.username, 'Alice')
  assertEquals(session!.provider, 'plex')
})

Deno.test('user-session-store: getUserSession returns null for unknown token', () => {
  clearUserSessions()
  const result = getUserSession('totally-made-up-token')
  assertEquals(result, null)
})

Deno.test('user-session-store: getUserSession returns null for empty string', () => {
  clearUserSessions()
  const result = getUserSession('')
  assertEquals(result, null)
})

Deno.test('user-session-store: invalidateUserSession removes the session', () => {
  clearUserSessions()
  const token = createUserSession(makeSession({ username: 'Bob' }))
  assertExists(getUserSession(token))

  invalidateUserSession(token)
  assertEquals(getUserSession(token), null)
})

Deno.test('user-session-store: invalidateUserSession is idempotent', () => {
  clearUserSessions()
  const token = createUserSession(makeSession())
  invalidateUserSession(token)
  // calling again should not throw
  invalidateUserSession(token)
  assertEquals(getUserSession(token), null)
})

Deno.test('user-session-store: clearUserSessions removes all sessions', () => {
  clearUserSessions()
  const t1 = createUserSession(makeSession({ username: 'Carol' }))
  const t2 = createUserSession(makeSession({ username: 'Dave', userId: 2 }))

  clearUserSessions()

  assertEquals(getUserSession(t1), null)
  assertEquals(getUserSession(t2), null)
})

Deno.test('user-session-store: sessions include isAdmin flag', () => {
  clearUserSessions()
  const token = createUserSession(makeSession({ isAdmin: true }))
  const session = getUserSession(token)
  assertExists(session)
  assertEquals(session!.isAdmin, true)
})

Deno.test('user-session-store: each createUserSession call returns a unique token', () => {
  clearUserSessions()
  const t1 = createUserSession(makeSession())
  const t2 = createUserSession(makeSession())
  assertEquals(t1 !== t2, true)
})
