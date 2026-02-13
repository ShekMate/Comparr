import { getMatchesForUser } from '../../../features/session/session.ts'

export async function handleMatchesRoute(req: any, path: string) {
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
      headers: new Headers({ 'content-type': 'application/json' }),
    })
    return true
  }

  const matches = getMatchesForUser(roomCode, userName)
  if (matches === null) {
    await req.respond({
      status: 404,
      body: JSON.stringify({ error: 'Room not found' }),
      headers: new Headers({ 'content-type': 'application/json' }),
    })
    return true
  }

  await req.respond({
    status: 200,
    body: JSON.stringify({ matches }),
    headers: new Headers({ 'content-type': 'application/json' }),
  })

  return true
}
