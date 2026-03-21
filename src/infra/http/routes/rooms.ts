import * as log from 'https://deno.land/std@0.79.0/log/mod.ts'
import {
  doesRoomCodeExist,
  generateUniqueRoomCode,
  isValidRoomCode,
  normalizeRoomCode,
} from '../../../features/session/session.ts'
import { addSecurityHeaders } from '../security-headers.ts'

const makeJsonHeaders = (req?: any) => {
  const headers = new Headers({ 'content-type': 'application/json' })
  addSecurityHeaders(headers, req)
  return headers
}

export async function handleRoomRoutes(req: any, path: string) {
  if (path === '/api/rooms/exists') {
    const url = new URL(req.url, 'http://local')
    const roomCode = normalizeRoomCode(url.searchParams.get('code') || '')

    if (!isValidRoomCode(roomCode)) {
      await req.respond({
        status: 400,
        headers: makeJsonHeaders(req),
        body: JSON.stringify({
          success: false,
          exists: false,
          message: 'Room code must be exactly 4 characters (A-Z or 0-9).',
        }),
      })
      return true
    }

    await req.respond({
      status: 200,
      headers: makeJsonHeaders(req),
      body: JSON.stringify({
        success: true,
        exists: doesRoomCodeExist(roomCode),
        roomCode,
      }),
    })
    return true
  }

  if (path === '/api/rooms/generate' && req.method === 'POST') {
    try {
      const roomCode = await generateUniqueRoomCode()
      await req.respond({
        status: 200,
        headers: makeJsonHeaders(req),
        body: JSON.stringify({ success: true, roomCode }),
      })
      return true
    } catch (err) {
      log.error(`Failed to generate room code: ${err}`)
      await req.respond({
        status: 500,
        headers: makeJsonHeaders(req),
        body: JSON.stringify({
          success: false,
          message:
            'Unable to generate a room code right now. Please try again.',
        }),
      })
      return true
    }
  }

  return false
}
