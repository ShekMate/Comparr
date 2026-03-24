import type { CompatRequest } from '../compat-request.ts'
import * as log from 'jsr:@std/log'
import {
  doesRoomCodeExist,
  generateUniqueRoomCode,
  isValidRoomCode,
  normalizeRoomCode,
} from '../../../features/session/session.ts'
import { addSecurityHeaders } from '../security-headers.ts'

const makeJsonHeaders = (req?: CompatRequest) => {
  const headers = new Headers({ 'content-type': 'application/json' })
  addSecurityHeaders(headers, req)
  return headers
}

export async function handleRoomRoutes(
  req: CompatRequest,
  path: string
): Promise<Response | null> {
  if (path === '/api/rooms/exists') {
    const url = new URL(req.url, 'http://local')
    const roomCode = normalizeRoomCode(url.searchParams.get('code') || '')

    if (!isValidRoomCode(roomCode)) {
      return new Response(
        JSON.stringify({
          success: false,
          exists: false,
          message: 'Room code must be exactly 4 characters (A-Z or 0-9).',
        }),
        {
          status: 400,
          headers: makeJsonHeaders(req),
        }
      )
    }

    return new Response(
      JSON.stringify({
        success: true,
        exists: doesRoomCodeExist(roomCode),
        roomCode,
      }),
      {
        status: 200,
        headers: makeJsonHeaders(req),
      }
    )
  }

  if (path === '/api/rooms/generate' && req.method === 'POST') {
    try {
      const roomCode = await generateUniqueRoomCode()
      return new Response(JSON.stringify({ success: true, roomCode }), {
        status: 200,
        headers: makeJsonHeaders(req),
      })
    } catch (err) {
      log.error(`Failed to generate room code: ${err}`)
      return new Response(
        JSON.stringify({
          success: false,
          message:
            'Unable to generate a room code right now. Please try again.',
        }),
        {
          status: 500,
          headers: makeJsonHeaders(req),
        }
      )
    }
  }

  return null
}
