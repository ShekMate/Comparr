// routes/streaming.ts - /api/refresh-streaming and /api/update-persisted-movie handlers
import * as log from 'jsr:@std/log'
import type { CompatRequest } from '../compat-request.ts'
import { makeHeaders } from '../security-headers.ts'
import { updateStreamingForTmdbId } from '../../../features/streaming/streaming-update.ts'

const streamingUpdateInFlight = new Map<number, Promise<any>>()

const updateStreamingForTmdbIdDeduped = async (tmdbId: number) => {
  if (!Number.isFinite(tmdbId) || tmdbId <= 0) {
    return updateStreamingForTmdbId(tmdbId)
  }
  const existing = streamingUpdateInFlight.get(tmdbId)
  if (existing) return existing
  const task = updateStreamingForTmdbId(tmdbId).finally(() =>
    streamingUpdateInFlight.delete(tmdbId)
  )
  streamingUpdateInFlight.set(tmdbId, task)
  return task
}

export async function handleStreamingRoutes(
  req: CompatRequest,
  path: string
): Promise<Response | null> {
  if (path.startsWith('/api/refresh-streaming/')) {
    try {
      const tmdbId = parseInt(path.split('/').pop() || '')
      const res = await updateStreamingForTmdbIdDeduped(tmdbId)
      return new Response(
        JSON.stringify(res.body),
        { status: res.status, headers: makeHeaders(req, 'application/json') }
      )
    } catch (err) {
      log.error(`Error refreshing streaming data: ${err}`)
      return new Response(
        JSON.stringify({ error: 'Failed to refresh' }),
        { status: 500, headers: makeHeaders(req, 'application/json') }
      )
    }
  }

  if (path.startsWith('/api/update-persisted-movie/') && req.method === 'POST') {
    try {
      const tmdbId = parseInt(path.split('/').pop() || '')
      const res = await updateStreamingForTmdbIdDeduped(tmdbId)
      return new Response(
        JSON.stringify({ updated: res.ok, tmdbId, ...res.body }),
        { status: res.status, headers: makeHeaders(req, 'application/json') }
      )
    } catch (err) {
      log.error(`Error updating persisted movie: ${err}`)
      return new Response(
        JSON.stringify({ error: 'Failed to update persisted movie' }),
        { status: 500, headers: makeHeaders(req, 'application/json') }
      )
    }
  }

  return null
}
