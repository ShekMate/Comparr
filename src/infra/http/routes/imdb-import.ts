// routes/imdb-import.ts - /api/imdb-import* handlers
import * as log from 'jsr:@std/log'
import type { CompatRequest } from '../compat-request.ts'
import { makeHeaders } from '../security-headers.ts'
import { apiRateLimiter } from '../ip-rate-limiter.ts'
import { getTmdbApiKey } from '../../../core/config.ts'
import {
  processImdbImportBackground,
  recordImdbImportHistoryStart,
  finalizeImdbImportHistory,
  getImdbImportHistory,
  cancelImdbImport,
  rollbackImdbImport,
  getUserSeenMovies,
  sendImdbImportProgressUpdate,
} from '../../../features/session/session.ts'
import { parseImdbCsv } from '../../../features/session/imdb-import.ts'

const getClientIp = (req: CompatRequest): string =>
  String(
    (req?.conn?.remoteAddr as Deno.NetAddr | undefined)?.hostname || 'unknown'
  )

const sanitizeForLog = (value: string, maxLength = 64) =>
  String(value || '')
    .replace(/[\r\n\t]/g, ' ')
    .slice(0, maxLength)

const validateRoomCodeAndUserName = (
  roomCode: string,
  userName: string
): string => {
  if (!roomCode || !userName)
    return 'Missing required query params: roomCode, userName'
  if (roomCode.length > 16) return 'roomCode is too long'
  if (userName.length > 64) return 'userName is too long'
  return ''
}

const bodyTooLarge = (req: CompatRequest, max: number) => {
  const contentLength = Number(req.headers.get('content-length') || '0')
  return Number.isFinite(contentLength) && contentLength > max
}

export async function handleImdbImportRoutes(
  req: CompatRequest,
  path: string,
  maxBodySize: number
): Promise<Response | null> {
  const url = new URL(req.url, 'http://local')

  if (path === '/api/seen-movies' && req.method === 'GET') {
    try {
      const roomCode = url.searchParams.get('roomCode')?.trim() || ''
      const userName = url.searchParams.get('userName')?.trim() || ''
      const validationError = validateRoomCodeAndUserName(roomCode, userName)
      if (validationError) {
        return new Response(JSON.stringify({ error: validationError }), {
          status: 400,
          headers: makeHeaders(req, 'application/json'),
        })
      }
      const movies = getUserSeenMovies(roomCode, userName)
      return new Response(JSON.stringify({ movies }), {
        status: 200,
        headers: makeHeaders(req, 'application/json'),
      })
    } catch (err) {
      log.error(`seen-movies fetch failed: ${err?.message || err}`)
      return new Response(
        JSON.stringify({ error: 'Failed to fetch seen movies' }),
        { status: 500, headers: makeHeaders(req, 'application/json') }
      )
    }
  }

  if (path === '/api/imdb-import-history' && req.method === 'GET') {
    try {
      const roomCode = url.searchParams.get('roomCode')?.trim() || ''
      const userName = url.searchParams.get('userName')?.trim() || ''
      const validationError = validateRoomCodeAndUserName(roomCode, userName)
      if (validationError) {
        return new Response(JSON.stringify({ error: validationError }), {
          status: 400,
          headers: makeHeaders(req, 'application/json'),
        })
      }
      const history = getImdbImportHistory(roomCode, userName)
      return new Response(JSON.stringify({ history }), {
        status: 200,
        headers: makeHeaders(req, 'application/json'),
      })
    } catch (err) {
      log.error(`IMDb history fetch failed: ${err?.message || err}`)
      return new Response(
        JSON.stringify({ error: 'Failed to fetch IMDb import history' }),
        { status: 500, headers: makeHeaders(req, 'application/json') }
      )
    }
  }

  if (path === '/api/imdb-import' && req.method === 'POST') {
    try {
      const requestIp = getClientIp(req)
      if (!apiRateLimiter.check(requestIp)) {
        return new Response(
          JSON.stringify({
            error: 'Too many import requests. Please wait and retry.',
          }),
          { status: 429, headers: makeHeaders(req, 'application/json') }
        )
      }

      if (bodyTooLarge(req, maxBodySize)) {
        return new Response(JSON.stringify({ error: 'Payload too large' }), {
          status: 413,
          headers: makeHeaders(req, 'application/json'),
        })
      }

      const TMDB_KEY = getTmdbApiKey()
      if (!TMDB_KEY) {
        return new Response(
          JSON.stringify({ error: 'TMDb API key is required for IMDb import' }),
          { status: 400, headers: makeHeaders(req, 'application/json') }
        )
      }

      const body = await req.text()
      const { csvContent, roomCode, userName, fileName } = JSON.parse(body)
      const validationError = validateRoomCodeAndUserName(roomCode, userName)
      if (!csvContent || validationError) {
        return new Response(
          JSON.stringify({
            error: validationError || 'Missing required field: csvContent',
          }),
          { status: 400, headers: makeHeaders(req, 'application/json') }
        )
      }

      log.info(
        `IMDb CSV import requested by ${sanitizeForLog(
          userName
        )} in room ${sanitizeForLog(roomCode, 16)}`
      )

      const rows = parseImdbCsv(csvContent)
      log.info(`IMDb CSV parsed: ${rows.length} movie entries found`)

      const importHistoryId = recordImdbImportHistoryStart(
        roomCode,
        userName,
        typeof fileName === 'string' ? fileName : 'IMDb CSV',
        rows.length
      )

      if (rows.length === 0) {
        finalizeImdbImportHistory(
          roomCode,
          userName,
          importHistoryId,
          'successful'
        )
        return new Response(JSON.stringify({ status: 'completed', total: 0 }), {
          status: 200,
          headers: makeHeaders(req, 'application/json'),
        })
      }

      const imdbRows = rows.map(r => ({
        imdbId: r.imdbId,
        title: r.title,
        year: r.year,
      }))

      // Kick off visible progress immediately after upload parsing succeeds.
      sendImdbImportProgressUpdate(roomCode, userName, {
        status: 'started',
        total: rows.length,
        processed: 0,
        imported: 0,
        skipped: 0,
      })

      processImdbImportBackground({
        roomCode,
        userName,
        imdbRows,
        importHistoryId,
      }).catch(err => {
        finalizeImdbImportHistory(roomCode, userName, importHistoryId, 'failed')
        log.error(`Background IMDb import failed: ${err?.message || err}`)
      })

      log.info(
        `IMDb CSV import started in background: ${rows.length} movies to process`
      )
      return new Response(
        JSON.stringify({ status: 'started', total: rows.length }),
        { status: 202, headers: makeHeaders(req, 'application/json') }
      )
    } catch (err) {
      log.error(`IMDb import failed: ${err?.message || err}`)
      return new Response(
        JSON.stringify({
          error: 'IMDb import failed',
          detail: 'An internal error occurred.',
        }),
        { status: 500, headers: makeHeaders(req, 'application/json') }
      )
    }
  }

  if (path === '/api/imdb-import-rollback' && req.method === 'POST') {
    try {
      const body = await req.text()
      const { roomCode, userName, guids } = JSON.parse(body)
      const validationError = validateRoomCodeAndUserName(roomCode, userName)
      if (validationError) {
        return new Response(JSON.stringify({ error: validationError }), {
          status: 400,
          headers: makeHeaders(req, 'application/json'),
        })
      }
      if (!Array.isArray(guids) || guids.some(g => typeof g !== 'string')) {
        return new Response(
          JSON.stringify({ error: 'guids must be a string array' }),
          {
            status: 400,
            headers: makeHeaders(req, 'application/json'),
          }
        )
      }
      const { removed } = await rollbackImdbImport(roomCode, userName, guids)
      log.info(
        `IMDb import rollback: removed ${removed} movies for ${sanitizeForLog(
          userName
        )}`
      )
      return new Response(JSON.stringify({ status: 'ok', removed }), {
        status: 200,
        headers: makeHeaders(req, 'application/json'),
      })
    } catch (err) {
      log.error(`IMDb import rollback failed: ${err?.message || err}`)
      return new Response(
        JSON.stringify({ error: 'Failed to rollback import' }),
        {
          status: 500,
          headers: makeHeaders(req, 'application/json'),
        }
      )
    }
  }

  if (path === '/api/imdb-import-cancel' && req.method === 'POST') {
    try {
      const body = await req.text()
      const { roomCode, userName } = JSON.parse(body)
      const validationError = validateRoomCodeAndUserName(roomCode, userName)
      if (validationError) {
        return new Response(JSON.stringify({ error: validationError }), {
          status: 400,
          headers: makeHeaders(req, 'application/json'),
        })
      }
      cancelImdbImport(roomCode, userName)
      return new Response(JSON.stringify({ status: 'cancel_requested' }), {
        status: 200,
        headers: makeHeaders(req, 'application/json'),
      })
    } catch (err) {
      log.error(`IMDb import cancel failed: ${err?.message || err}`)
      return new Response(
        JSON.stringify({ error: 'Failed to cancel import' }),
        {
          status: 500,
          headers: makeHeaders(req, 'application/json'),
        }
      )
    }
  }

  if (path === '/api/imdb-import-url' && req.method === 'POST') {
    return new Response(
      JSON.stringify({
        error:
          'IMDb URL import is temporarily disabled. Please use CSV import.',
      }),
      { status: 410, headers: makeHeaders(req, 'application/json') }
    )
  }

  return null
}
