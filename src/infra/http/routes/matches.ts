import type { CompatRequest } from '../compat-request.ts'
import { addSecurityHeaders } from '../security-headers.ts'
import { getMatchesForUser } from '../../../features/session/session.ts'

const makeJsonHeaders = (req?: CompatRequest) => {
  const headers = new Headers({ 'content-type': 'application/json' })
  addSecurityHeaders(headers, req)
  return headers
}

export async function handleMatchesRoute(
  req: CompatRequest,
  path: string
): Promise<Response | null> {
  if (path !== '/api/matches') {
    return null
  }

  const url = new URL(req.url, 'http://local')
  const roomCode = url.searchParams.get('code') || ''
  const userName = url.searchParams.get('user') || ''

  if (!roomCode || !userName) {
    return new Response(JSON.stringify({ error: 'Missing room code or user' }), {
      status: 400,
      headers: makeJsonHeaders(req),
    })
  }

  const matches = getMatchesForUser(roomCode, userName)
  if (matches === null) {
    return new Response(JSON.stringify({ error: 'Room not found' }), {
      status: 404,
      headers: makeJsonHeaders(req),
    })
  }

  return new Response(JSON.stringify({ matches }), {
    status: 200,
    headers: makeJsonHeaders(req),
  })
}
