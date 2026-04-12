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

  // ── GET /api/user/code?roomCode=XXX&user=YYY ────────────────────────────
  if (path === '/api/user/code' && req.method === 'GET') {
    const url = new URL(req.url, 'http://local')
    const roomCode = (url.searchParams.get('roomCode') || '').trim().toUpperCase().slice(0, 10)
    const name = (url.searchParams.get('user') || '').trim().slice(0, 64)

    if (!roomCode || !name) {
      return new Response(
        JSON.stringify({ error: 'roomCode and user are required' }),
        { status: 400, headers: makeJson(req) }
      )
    }

    const code = await getOrCreateUserCode(roomCode, name)
    return new Response(JSON.stringify({ code }), {
      status: 200,
      headers: makeJson(req),
    })
  }

  // ── POST /api/user/refresh ──────────────────────────────────────────────
  // Body: { roomCode, name }
  // Returns: { code } — brand-new code, all connections cleared
  if (path === '/api/user/refresh' && req.method === 'POST') {
    let body: { roomCode?: string; name?: string } = {}
    try {
      body = await req.json()
    } catch { /* empty body ok */ }

    const roomCode = String(body.roomCode || '').trim().toUpperCase().slice(0, 10)
    const name = String(body.name || '').trim().slice(0, 64)

    if (!roomCode || !name) {
      return new Response(
        JSON.stringify({ error: 'roomCode and name are required' }),
        { status: 400, headers: makeJson(req) }
      )
    }

    const code = await refreshUserCode(roomCode, name)
    return new Response(JSON.stringify({ code }), {
      status: 200,
      headers: makeJson(req),
    })
  }

  // ── POST /api/matches/add ───────────────────────────────────────────────
  // Body: { roomCode, name, friendCode }
  // Returns: { success, friendName }
  if (path === '/api/matches/add' && req.method === 'POST') {
    let body: { roomCode?: string; name?: string; friendCode?: string } = {}
    try {
      body = await req.json()
    } catch { /* empty body ok */ }

    const roomCode = String(body.roomCode || '').trim().toUpperCase().slice(0, 10)
    const name = String(body.name || '').trim().slice(0, 64)
    const friendCode = String(body.friendCode || '')
      .trim()
      .toUpperCase()
      .slice(0, USER_CODE_LENGTH)

    if (!roomCode || !name || !friendCode) {
      return new Response(
        JSON.stringify({ error: 'roomCode, name, and friendCode are required' }),
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

    const result = await addConnection(roomCode, name, friendCode)
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
  // Body: { roomCode, name, friendCode }
  if (path === '/api/matches/remove-user' && req.method === 'DELETE') {
    let body: { roomCode?: string; name?: string; friendCode?: string } = {}
    try {
      body = await req.json()
    } catch { /* empty body ok */ }

    const roomCode = String(body.roomCode || '').trim().toUpperCase().slice(0, 10)
    const name = String(body.name || '').trim().slice(0, 64)
    const friendCode = String(body.friendCode || '').trim().toUpperCase()

    if (!roomCode || !name || !friendCode) {
      return new Response(
        JSON.stringify({ error: 'roomCode, name, and friendCode are required' }),
        { status: 400, headers: makeJson(req) }
      )
    }

    await removeConnection(roomCode, name, friendCode)
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: makeJson(req),
    })
  }

  // ── GET /api/matches/connections?roomCode=XXX&user=YYY ──────────────────
  if (path === '/api/matches/connections' && req.method === 'GET') {
    const url = new URL(req.url, 'http://local')
    const roomCode = (url.searchParams.get('roomCode') || '').trim().toUpperCase().slice(0, 10)
    const name = (url.searchParams.get('user') || '').trim().slice(0, 64)

    if (!roomCode || !name) {
      return new Response(
        JSON.stringify({ error: 'roomCode and user are required' }),
        { status: 400, headers: makeJson(req) }
      )
    }

    const connections = await getConnections(roomCode, name)
    return new Response(JSON.stringify({ connections }), {
      status: 200,
      headers: makeJson(req),
    })
  }

  return null
}
