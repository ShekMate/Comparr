import type { CompatRequest } from '../compat-request.ts'
import { addSecurityHeaders } from '../security-headers.ts'
import { getUserTokenFromCookie } from './auth.ts'
import { getUserSession } from '../../../core/user-session-store.ts'
import {
  getOrCreateUserCode,
  addConnection,
  removeConnection,
  refreshUserCode,
  getConnections,
  isValidUserCode,
  USER_CODE_LENGTH,
} from '../../../features/session/user-codes.ts'

// Matches the deterministic room code formula used on the frontend:
//   const userRoomCode = id => `U${String(id).padStart(3, '0')}`
// Each authenticated user owns a stable personal room keyed to their DB id.
function roomCodeForUser(userId: number): string {
  return `U${String(userId).padStart(3, '0')}`
}

const makeJson = (req: CompatRequest) => {
  const h = new Headers({ 'content-type': 'application/json' })
  addSecurityHeaders(h, req)
  return h
}

/** Read the caller's identity from their auth session cookie. */
function getCallerIdentity(req: CompatRequest): { name: string; roomCode: string } | null {
  const token = getUserTokenFromCookie(req)
  const session = getUserSession(token)
  if (!session) return null
  return {
    name: session.username,
    roomCode: roomCodeForUser(session.userId),
  }
}

export async function handleCompareRoutes(
  req: CompatRequest,
  path: string
): Promise<Response | null> {

  // ── GET /api/user/code ──────────────────────────────────────────────────
  if (path === '/api/user/code' && req.method === 'GET') {
    const caller = getCallerIdentity(req)
    if (!caller) {
      return new Response(JSON.stringify({ error: 'Not authenticated.' }), {
        status: 401, headers: makeJson(req),
      })
    }
    const code = await getOrCreateUserCode(caller.name, caller.roomCode)
    return new Response(JSON.stringify({ code }), {
      status: 200, headers: makeJson(req),
    })
  }

  // ── POST /api/user/refresh ──────────────────────────────────────────────
  // Returns: { code } — brand-new code, all connections cleared
  if (path === '/api/user/refresh' && req.method === 'POST') {
    const caller = getCallerIdentity(req)
    if (!caller) {
      return new Response(JSON.stringify({ error: 'Not authenticated.' }), {
        status: 401, headers: makeJson(req),
      })
    }
    const code = await refreshUserCode(caller.name, caller.roomCode)
    return new Response(JSON.stringify({ code }), {
      status: 200, headers: makeJson(req),
    })
  }

  // ── POST /api/matches/add ───────────────────────────────────────────────
  // Body: { friendCode }
  // Returns: { success, friendName }
  if (path === '/api/matches/add' && req.method === 'POST') {
    const caller = getCallerIdentity(req)
    if (!caller) {
      return new Response(JSON.stringify({ error: 'Not authenticated.' }), {
        status: 401, headers: makeJson(req),
      })
    }

    let body: { friendCode?: string } = {}
    try { body = await req.json() } catch { /* empty body ok */ }

    const friendCode = String(body.friendCode || '')
      .trim()
      .toUpperCase()
      .slice(0, USER_CODE_LENGTH)

    if (!friendCode) {
      return new Response(JSON.stringify({ error: 'friendCode is required' }), {
        status: 400, headers: makeJson(req),
      })
    }

    if (!isValidUserCode(friendCode)) {
      return new Response(
        JSON.stringify({ error: `Friend code must be ${USER_CODE_LENGTH} characters (A-Z or 0-9).` }),
        { status: 400, headers: makeJson(req) }
      )
    }

    const result = await addConnection(caller.name, caller.roomCode, friendCode)
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

  // ── DELETE /api/matches/remove-user ────────────────────────────────────
  // Body: { friendCode }
  if (path === '/api/matches/remove-user' && req.method === 'DELETE') {
    const caller = getCallerIdentity(req)
    if (!caller) {
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

    await removeConnection(caller.name, friendCode)
    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: makeJson(req),
    })
  }

  // ── GET /api/matches/connections ────────────────────────────────────────
  if (path === '/api/matches/connections' && req.method === 'GET') {
    const caller = getCallerIdentity(req)
    if (!caller) {
      return new Response(JSON.stringify({ error: 'Not authenticated.' }), {
        status: 401, headers: makeJson(req),
      })
    }

    const connections = await getConnections(caller.name, caller.roomCode)
    return new Response(JSON.stringify({ connections }), {
      status: 200, headers: makeJson(req),
    })
  }

  return null
}
