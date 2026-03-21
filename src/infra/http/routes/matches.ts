import type { CompatRequest } from '../compat-request.ts'
import { addSecurityHeaders } from '../security-headers.ts'
import { getMatchesForUser } from '../../../features/session/session.ts'

const makeJsonHeaders = (req?: CompatRequest) => {
  const headers = new Headers({ 'content-type': 'application/json' })
  addSecurityHeaders(headers, req)
  return headers
}

export async function handleMatchesRoute(req: CompatRequest, path: string) {
  if (path !== '/api/matches') {
    return false
  }

  const url = new URL(req.url, 'http://local')
  const roomCode = url.searchParams.get('code') || ''
  const userName = url.searchParams.get('user') || ''

  if (!roomCode || !userName) {
    await req.respond({
      status: 400,
      body: JSON.stringify({ error: 'Missing room code or user' }),
      headers: makeJsonHeaders(req),
    })
    return true
  }

  const matches = getMatchesForUser(roomCode, userName)
  if (matches === null) {
    await req.respond({
      status: 404,
      body: JSON.stringify({ error: 'Room not found' }),
      headers: makeJsonHeaders(req),
    })
    return true
  }

  await req.respond({
    status: 200,
    body: JSON.stringify({ matches }),
    headers: makeJsonHeaders(req),
  })

  return true
}
