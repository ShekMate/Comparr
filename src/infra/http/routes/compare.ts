import type { CompatRequest } from '../compat-request.ts'
import { addSecurityHeaders } from '../security-headers.ts'
import { getCompareMatches } from '../../../features/session/session.ts'

// In-memory invite store — resets on server restart.
// Tokens are 8 uppercase hex chars; each stores the initiator's room code + name.
const invites = new Map<
  string,
  { roomCode: string; name: string; createdAt: number }
>()
const TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

const makeJson = (req: CompatRequest) => {
  const h = new Headers({ 'content-type': 'application/json' })
  addSecurityHeaders(h, req)
  return h
}

function pruneExpired() {
  const now = Date.now()
  for (const [k, v] of invites) {
    if (now - v.createdAt > TTL_MS) invites.delete(k)
  }
}

export async function handleCompareRoutes(
  req: CompatRequest,
  path: string
): Promise<Response | null> {
  // ── POST /api/compare/invite ─────────────────────────────────────────────
  // Body: { roomCode, name }
  // Returns: { token }  — client builds share URL as /?compare=TOKEN
  if (path === '/api/compare/invite' && req.method === 'POST') {
    let body: { roomCode?: string; name?: string } = {}
    try {
      body = await req.json()
    } catch { /* empty body ok */ }

    const roomCode = String(body.roomCode || '')
      .trim()
      .toUpperCase()
      .slice(0, 10)
    const name = String(body.name || '').trim().slice(0, 64)

    if (!roomCode || !name) {
      return new Response(
        JSON.stringify({ error: 'roomCode and name are required' }),
        { status: 400, headers: makeJson(req) }
      )
    }

    pruneExpired()

    // 8 uppercase hex chars
    const bytes = new Uint8Array(4)
    crypto.getRandomValues(bytes)
    const token = Array.from(bytes, b => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()

    invites.set(token, { roomCode, name, createdAt: Date.now() })

    return new Response(JSON.stringify({ token }), {
      status: 200,
      headers: makeJson(req),
    })
  }

  // ── GET /api/compare/invite/:token ───────────────────────────────────────
  // Returns initiator name so User B can see who's waiting before joining.
  if (path.startsWith('/api/compare/invite/') && req.method === 'GET') {
    const token = path.slice('/api/compare/invite/'.length).toUpperCase()
    pruneExpired()
    const invite = invites.get(token)
    if (!invite) {
      return new Response(
        JSON.stringify({ error: 'Invite not found or expired' }),
        { status: 404, headers: makeJson(req) }
      )
    }
    return new Response(JSON.stringify({ name: invite.name, token }), {
      status: 200,
      headers: makeJson(req),
    })
  }

  // ── POST /api/compare/join/:token ────────────────────────────────────────
  // Body: { roomCode, name }
  // Returns: { initiator: { name }, matches: MediaItem[] }
  if (path.startsWith('/api/compare/join/') && req.method === 'POST') {
    const token = path.slice('/api/compare/join/'.length).toUpperCase()
    pruneExpired()
    const invite = invites.get(token)
    if (!invite) {
      return new Response(
        JSON.stringify({ error: 'Invite not found or expired' }),
        { status: 404, headers: makeJson(req) }
      )
    }

    let body: { roomCode?: string; name?: string } = {}
    try {
      body = await req.json()
    } catch { /* empty body ok */ }

    const roomCode = String(body.roomCode || '')
      .trim()
      .toUpperCase()
      .slice(0, 10)
    const name = String(body.name || '').trim().slice(0, 64)

    if (!roomCode || !name) {
      return new Response(
        JSON.stringify({ error: 'roomCode and name are required' }),
        { status: 400, headers: makeJson(req) }
      )
    }

    const matches = getCompareMatches(invite.roomCode, invite.name, roomCode, name)

    return new Response(
      JSON.stringify({ initiator: { name: invite.name }, matches }),
      { status: 200, headers: makeJson(req) }
    )
  }

  return null
}
