import type { CompatRequest } from '../compat-request.ts'
import { addSecurityHeaders } from '../security-headers.ts'
import {
  getOrCreateUserCode,
  addConnection,
  removeConnection,
  refreshUserCode,
  getConnections,
  isValidUserCode,
  USER_CODE_LENGTH,
} from '../../../features/session/user-codes.ts'

const makeJson = (req: CompatRequest) => {
  const h = new Headers({ 'content-type': 'application/json' })
  addSecurityHeaders(h, req)
  return h
}

export async function handleCompareRoutes(
  req: CompatRequest,
  path: string
): Promise<Response | null> {

  // ── GET /api/user/code?user=NAME&roomCode=XXX ───────────────────────────
  // roomCode is passed so match computation uses the right session data,
  // but it is NOT the identity key — the code is stable across room changes.
  if (path === '/api/user/code' && req.method === 'GET') {
    const url = new URL(req.url, 'http://local')
    const name = (url.searchParams.get('user') || '').trim().slice(0, 64)
    const roomCode = (url.searchParams.get('roomCode') || '').trim().toUpperCase().slice(0, 10)

    if (!name) {
      return new Response(
        JSON.stringify({ error: 'user is required' }),
        { status: 400, headers: makeJson(req) }
      )
    }

    const code = await getOrCreateUserCode(name, roomCode)
    return new Response(JSON.stringify({ code }), {
      status: 200,
      headers: makeJson(req),
    })
  }

  // ── POST /api/user/refresh ──────────────────────────────────────────────
  // Body: { name, roomCode }
  // Returns: { code } — brand-new code, all connections cleared
  if (path === '/api/user/refresh' && req.method === 'POST') {
    let body: { name?: string; roomCode?: string } = {}
    try {
      body = await req.json()
    } catch { /* empty body ok */ }

    const name = String(body.name || '').trim().slice(0, 64)
    const roomCode = String(body.roomCode || '').trim().toUpperCase().slice(0, 10)

    if (!name) {
      return new Response(
        JSON.stringify({ error: 'name is required' }),
        { status: 400, headers: makeJson(req) }
      )
    }

    const code = await refreshUserCode(name, roomCode)
    return new Response(JSON.stringify({ code }), {
      status: 200,
      headers: makeJson(req),
    })
  }

  // ── POST /api/matches/add ───────────────────────────────────────────────
  // Body: { name, roomCode, friendCode }
  // Returns: { success, friendName }
  if (path === '/api/matches/add' && req.method === 'POST') {
    let body: { name?: string; roomCode?: string; friendCode?: string } = {}
    try {
      body = await req.json()
    } catch { /* empty body ok */ }

    const name = String(body.name || '').trim().slice(0, 64)
    const roomCode = String(body.roomCode || '').trim().toUpperCase().slice(0, 10)
    const friendCode = String(body.friendCode || '')
      .trim()
      .toUpperCase()
      .slice(0, USER_CODE_LENGTH)

    if (!name || !friendCode) {
      return new Response(
        JSON.stringify({ error: 'name and friendCode are required' }),
        { status: 400, headers: makeJson(req) }
      )
    }

    if (!isValidUserCode(friendCode)) {
      return new Response(
        JSON.stringify({
          error: `Friend code must be exactly ${USER_CODE_LENGTH} characters (A-Z or 0-9).`,
        }),
        { status: 400, headers: makeJson(req) }
      )
    }

    const result = await addConnection(name, roomCode, friendCode)
    if (!result.success) {
      return new Response(JSON.stringify({ error: result.error }), {
        status: 404,
        headers: makeJson(req),
      })
    }

    return new Response(
      JSON.stringify({ success: true, friendName: result.friendName }),
      { status: 200, headers: makeJson(req) }
    )
  }

  // ── DELETE /api/matches/remove-user ────────────────────────────────────
  // Body: { name, friendCode }
  if (path === '/api/matches/remove-user' && req.method === 'DELETE') {
    let body: { name?: string; friendCode?: string } = {}
    try {
      body = await req.json()
    } catch { /* empty body ok */ }

    const name = String(body.name || '').trim().slice(0, 64)
    const friendCode = String(body.friendCode || '').trim().toUpperCase()

    if (!name || !friendCode) {
      return new Response(
        JSON.stringify({ error: 'name and friendCode are required' }),
        { status: 400, headers: makeJson(req) }
      )
    }

    await removeConnection(name, friendCode)
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: makeJson(req),
    })
  }

  // ── GET /api/matches/connections?user=NAME&roomCode=XXX ─────────────────
  if (path === '/api/matches/connections' && req.method === 'GET') {
    const url = new URL(req.url, 'http://local')
    const name = (url.searchParams.get('user') || '').trim().slice(0, 64)
    const roomCode = (url.searchParams.get('roomCode') || '').trim().toUpperCase().slice(0, 10)

    if (!name) {
      return new Response(
        JSON.stringify({ error: 'user is required' }),
        { status: 400, headers: makeJson(req) }
      )
    }

    const connections = await getConnections(name, roomCode)
    return new Response(JSON.stringify({ connections }), {
      status: 200,
      headers: makeJson(req),
    })
  }

  return null
}
