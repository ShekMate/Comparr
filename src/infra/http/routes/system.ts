import * as log from 'jsr:@std/log'
import type { CompatRequest } from '../compat-request.ts'
import { makeHeaders } from '../security-headers.ts'

type MatchSession = {
  removeMatch: (
    guid: string,
    userName: string,
    action: 'seen' | 'pass'
  ) => number
}

type SystemRouteDeps = {
  csrfCookieName: string
  createCsrfToken: () => string
  shouldUseSecureCookies: (req: CompatRequest) => boolean
  activeSessions: Map<string, MatchSession>
}

export const handleSystemRoutes = async (
  req: CompatRequest,
  pathname: string,
  deps: SystemRouteDeps
): Promise<Response | null> => {
  if (pathname === '/api/health' && req.method === 'GET') {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: makeHeaders(req, 'application/json'),
    })
  }

  if (pathname === '/api/csrf-token' && req.method === 'GET') {
    const token = deps.createCsrfToken()
    const headers = makeHeaders(req, 'application/json')
    const secureFlag = deps.shouldUseSecureCookies(req) ? '; Secure' : ''
    headers.set(
      'set-cookie',
      `${deps.csrfCookieName}=${token}; Path=/; SameSite=Strict; HttpOnly${secureFlag}`
    )
    return new Response(JSON.stringify({ csrfToken: token }), {
      status: 200,
      headers,
    })
  }

  if (pathname === '/api/match-action' && req.method === 'POST') {
    try {
      const body = await req.json()
      const { guid, action, roomCode, userName } = body as {
        guid: string
        action: 'seen' | 'pass'
        roomCode: string
        userName: string
      }

      log.info(
        `Match action: ${userName} in ${roomCode} marked ${guid} as ${action}`
      )

      const session = deps.activeSessions.get(roomCode)
      if (!session) {
        return new Response(JSON.stringify({ error: 'Room not found' }), {
          status: 404,
          headers: makeHeaders(req, 'application/json'),
        })
      }

      const removedCount = session.removeMatch(guid, userName, action)

      log.info(`Removed ${removedCount} match(es) for movie ${guid}`)

      return new Response(JSON.stringify({ success: true, removedCount }), {
        status: 200,
        headers: makeHeaders(req, 'application/json'),
      })
    } catch (err) {
      log.error(`Failed to process match action: ${err}`)
      return new Response(
        JSON.stringify({ error: 'Failed to process match action' }),
        {
          status: 500,
          headers: makeHeaders(req, 'application/json'),
        }
      )
    }
  }

  return null
}
