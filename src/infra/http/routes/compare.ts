import type { CompatRequest } from '../compat-request.ts'
import { addSecurityHeaders } from '../security-headers.ts'
import { getUserTokenFromCookie } from './auth.ts'
import { getUserSession } from '../../../core/user-session-store.ts'
import {
  getOrCreateInviteCode,
  refreshInviteCode,
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  removeFriendConnection,
  updateFriendSharing,
  resolveServerPrompt,
  getFriendConnections,
  getUserSettings,
  upsertUserSettings,
} from '../../../features/auth/user-db.ts'
import { getCompareMatches } from '../../../features/session/session.ts'

// Each authenticated user has a deterministic personal room code derived from their DB ID.
function roomCodeForUser(userId: number): string {
  return `U${String(userId).padStart(3, '0')}`
}

const makeJson = (req: CompatRequest) => {
  const h = new Headers({ 'content-type': 'application/json' })
  addSecurityHeaders(h, req)
  return h
}

function getCallerSession(req: CompatRequest) {
  const token = getUserTokenFromCookie(req)
  return token ? getUserSession(token) : null
}

export async function handleCompareRoutes(
  req: CompatRequest,
  path: string
): Promise<Response | null> {

  // ── GET /api/user/code ──────────────────────────────────────────────────
  // Returns the user's invite code (creates one if needed).
  if (path === '/api/user/code' && req.method === 'GET') {
    const session = getCallerSession(req)
    if (!session) {
      return new Response(JSON.stringify({ error: 'Not authenticated.' }), {
        status: 401, headers: makeJson(req),
      })
    }
    const code = getOrCreateInviteCode(session.userId)
    return new Response(JSON.stringify({ code }), {
      status: 200, headers: makeJson(req),
    })
  }

  // ── POST /api/user/refresh ──────────────────────────────────────────────
  // Generates a new invite code; clears all friend connections.
  if (path === '/api/user/refresh' && req.method === 'POST') {
    const session = getCallerSession(req)
    if (!session) {
      return new Response(JSON.stringify({ error: 'Not authenticated.' }), {
        status: 401, headers: makeJson(req),
      })
    }
    const code = refreshInviteCode(session.userId)
    return new Response(JSON.stringify({ code }), {
      status: 200, headers: makeJson(req),
    })
  }

  // ── POST /api/matches/add ───────────────────────────────────────────────
  // Send a friend request by entering the other user's invite code.
  // Creates a PENDING connection — the recipient must accept.
  // Body: { friendCode }
  if (path === '/api/matches/add' && req.method === 'POST') {
    const session = getCallerSession(req)
    if (!session) {
      return new Response(JSON.stringify({ error: 'Not authenticated.' }), {
        status: 401, headers: makeJson(req),
      })
    }

    let body: { friendCode?: string } = {}
    try { body = await req.json() } catch { /* empty body ok */ }

    const friendCode = String(body.friendCode || '').trim().toUpperCase()
    if (!friendCode) {
      return new Response(JSON.stringify({ error: 'friendCode is required' }), {
        status: 400, headers: makeJson(req),
      })
    }

    const result = sendFriendRequest(session.userId, friendCode)
    if (!result.success) {
      return new Response(JSON.stringify({ error: result.error }), {
        status: 404, headers: makeJson(req),
      })
    }

    return new Response(
      JSON.stringify({ success: true, friendName: result.friendName }),
      { status: 200, headers: makeJson(req) }
    )
  }

  // ── POST /api/matches/accept ────────────────────────────────────────────
  // Accept a pending friend request.
  // Body: { requesterId, sharesServer }
  if (path === '/api/matches/accept' && req.method === 'POST') {
    const session = getCallerSession(req)
    if (!session) {
      return new Response(JSON.stringify({ error: 'Not authenticated.' }), {
        status: 401, headers: makeJson(req),
      })
    }

    let body: { requesterId?: number; sharesServer?: boolean } = {}
    try { body = await req.json() } catch { /* empty body ok */ }

    const requesterId = Number(body.requesterId)
    if (!requesterId) {
      return new Response(JSON.stringify({ error: 'requesterId is required' }), {
        status: 400, headers: makeJson(req),
      })
    }

    const result = acceptFriendRequest(session.userId, requesterId, Boolean(body.sharesServer))
    if (!result.success) {
      return new Response(JSON.stringify({ error: result.error }), {
        status: 400, headers: makeJson(req),
      })
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: makeJson(req),
    })
  }

  // ── POST /api/matches/decline ───────────────────────────────────────────
  // Decline and remove a pending friend request.
  // Body: { requesterId }
  if (path === '/api/matches/decline' && req.method === 'POST') {
    const session = getCallerSession(req)
    if (!session) {
      return new Response(JSON.stringify({ error: 'Not authenticated.' }), {
        status: 401, headers: makeJson(req),
      })
    }

    let body: { requesterId?: number } = {}
    try { body = await req.json() } catch { /* empty body ok */ }

    const requesterId = Number(body.requesterId)
    if (!requesterId) {
      return new Response(JSON.stringify({ error: 'requesterId is required' }), {
        status: 400, headers: makeJson(req),
      })
    }

    declineFriendRequest(session.userId, requesterId)
    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: makeJson(req),
    })
  }

  // ── DELETE /api/matches/remove-user ────────────────────────────────────
  // Remove an accepted friend connection.
  // Body: { friendUserId }
  if (path === '/api/matches/remove-user' && req.method === 'DELETE') {
    const session = getCallerSession(req)
    if (!session) {
      return new Response(JSON.stringify({ error: 'Not authenticated.' }), {
        status: 401, headers: makeJson(req),
      })
    }

    let body: { friendUserId?: number } = {}
    try { body = await req.json() } catch { /* empty body ok */ }

    const friendUserId = Number(body.friendUserId)
    if (!friendUserId) {
      return new Response(JSON.stringify({ error: 'friendUserId is required' }), {
        status: 400, headers: makeJson(req),
      })
    }

    removeFriendConnection(session.userId, friendUserId)
    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: makeJson(req),
    })
  }

  // ── PUT /api/matches/sharing ────────────────────────────────────────────
  // Toggle server sharing for a specific friend.
  // Body: { friendUserId, sharesServer }
  if (path === '/api/matches/sharing' && req.method === 'PUT') {
    const session = getCallerSession(req)
    if (!session) {
      return new Response(JSON.stringify({ error: 'Not authenticated.' }), {
        status: 401, headers: makeJson(req),
      })
    }

    let body: { friendUserId?: number; sharesServer?: boolean } = {}
    try { body = await req.json() } catch { /* empty body ok */ }

    const friendUserId = Number(body.friendUserId)
    if (!friendUserId) {
      return new Response(JSON.stringify({ error: 'friendUserId is required' }), {
        status: 400, headers: makeJson(req),
      })
    }

    updateFriendSharing(session.userId, friendUserId, Boolean(body.sharesServer))
    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: makeJson(req),
    })
  }

  // ── POST /api/matches/resolve-server-prompt ─────────────────────────────
  // Dismiss the server-sharing consent prompt (accept or decline).
  // Body: { friendUserId, acceptsServer }
  if (path === '/api/matches/resolve-server-prompt' && req.method === 'POST') {
    const session = getCallerSession(req)
    if (!session) {
      return new Response(JSON.stringify({ error: 'Not authenticated.' }), {
        status: 401, headers: makeJson(req),
      })
    }

    let body: { friendUserId?: number; acceptsServer?: boolean } = {}
    try { body = await req.json() } catch { /* empty body ok */ }

    const friendUserId = Number(body.friendUserId)
    if (!friendUserId) {
      return new Response(JSON.stringify({ error: 'friendUserId is required' }), {
        status: 400, headers: makeJson(req),
      })
    }

    resolveServerPrompt(session.userId, friendUserId, Boolean(body.acceptsServer))
    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: makeJson(req),
    })
  }

  // ── GET /api/matches/connections ────────────────────────────────────────
  // Returns all friend connections (pending + accepted) with matches for accepted ones.
  if (path === '/api/matches/connections' && req.method === 'GET') {
    const session = getCallerSession(req)
    if (!session) {
      return new Response(JSON.stringify({ error: 'Not authenticated.' }), {
        status: 401, headers: makeJson(req),
      })
    }

    const myRoomCode = roomCodeForUser(session.userId)
    const connections = getFriendConnections(session.userId)

    const result = connections.map(conn => {
      const friendRoomCode = roomCodeForUser(conn.friendUserId)
      const matches = conn.status === 'accepted'
        ? getCompareMatches(myRoomCode, session.username, friendRoomCode, conn.friendUsername)
        : []

      // Whether friend is sharing their server with me (look at FRIEND's row)
      const friendConnections = getFriendConnections(conn.friendUserId)
      const friendRow = friendConnections.find(fc => fc.friendUserId === session.userId)
      const friendSharesServerWithMe = friendRow?.sharesServer ?? false

      return {
        friendUserId: conn.friendUserId,
        friendName: conn.friendUsername,
        friendInviteCode: conn.friendInviteCode,
        status: conn.status,
        sharesServer: conn.sharesServer,
        friendSharesServerWithMe,
        serverPromptPending: conn.serverPromptPending,
        matches,
      }
    })

    return new Response(JSON.stringify({ connections: result }), {
      status: 200, headers: makeJson(req),
    })
  }

  // ── GET /api/profile/settings ───────────────────────────────────────────
  // Returns authenticated user preferences + invite metadata.
  if (path === '/api/profile/settings' && req.method === 'GET') {
    const session = getCallerSession(req)
    if (!session) {
      return new Response(JSON.stringify({ error: 'Not authenticated.' }), {
        status: 401, headers: makeJson(req),
      })
    }

    const settings = getUserSettings(session.userId)
    const inviteCode = getOrCreateInviteCode(session.userId)
    return new Response(
      JSON.stringify({
        settings: {
          defaultFilters: settings?.defaultFilters ?? '{}',
        },
        inviteCode,
      }),
      {
        status: 200,
        headers: makeJson(req),
      }
    )
  }

  // ── PUT /api/profile/settings ───────────────────────────────────────────
  // Updates authenticated user preferences.
  if (path === '/api/profile/settings' && req.method === 'PUT') {
    const session = getCallerSession(req)
    if (!session) {
      return new Response(JSON.stringify({ error: 'Not authenticated.' }), {
        status: 401, headers: makeJson(req),
      })
    }

    let body: Record<string, unknown> = {}
    try { body = await req.json() } catch { /* empty body ok */ }

    upsertUserSettings(session.userId, {
      defaultFilters:
        typeof body.defaultFilters === 'string' ? body.defaultFilters : undefined,
<<<<<<< codex/task-title-ucuzdd
=======
      subscriptions:
        typeof body.subscriptions === 'string' ? body.subscriptions : undefined,
>>>>>>> dev
    })

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: makeJson(req),
    })
  }

  return null
}
