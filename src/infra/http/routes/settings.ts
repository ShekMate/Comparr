import { SettingsValidationError } from '../../../core/settings.ts'
import * as log from 'https://deno.land/std@0.79.0/log/mod.ts'

export type SettingsRouteDeps = {
  buildPlexCache: () => Promise<void>
  clearAllMoviesCache: () => void
  getPlexLibraryName: () => string
  getSettings: () => Record<string, unknown>
  isLocalRequest: (req: any) => boolean
  refreshRadarrCache: () => Promise<void>
  updateSettings: (
    settings: Record<string, unknown>
  ) => Promise<Record<string, unknown>>
}

export async function handleSettingsRoutes(
  req: any,
  pathname: string,
  deps: SettingsRouteDeps
): Promise<boolean> {
  const {
    buildPlexCache,
    clearAllMoviesCache,
    getPlexLibraryName,
    getSettings,
    isLocalRequest,
    refreshRadarrCache,
    updateSettings,
  } = deps

  if (pathname === '/api/settings-access') {
    await req.respond({
      status: 200,
      body: JSON.stringify({ canAccess: isLocalRequest(req) }),
      headers: new Headers({ 'content-type': 'application/json' }),
    })
    return true
  }

  if (pathname === '/api/client-config') {
    const settings = getSettings()
    await req.respond({
      status: 200,
      body: JSON.stringify({
        plexLibraryName: getPlexLibraryName(),
        streamingProfileMode: settings.STREAMING_PROFILE_MODE,
        paidStreamingServices: settings.PAID_STREAMING_SERVICES,
        personalMediaSources: settings.PERSONAL_MEDIA_SOURCES,
      }),
      headers: new Headers({ 'content-type': 'application/json' }),
    })
    return true
  }

  if (pathname === '/api/settings' && req.method === 'GET') {
    if (!isLocalRequest(req)) {
      await req.respond({ status: 403, body: 'Forbidden' })
      return true
    }

    await req.respond({
      status: 200,
      body: JSON.stringify({ settings: getSettings() }),
      headers: new Headers({ 'content-type': 'application/json' }),
    })
    return true
  }

  if (pathname === '/api/settings' && req.method === 'POST') {
    if (!isLocalRequest(req)) {
      await req.respond({ status: 403, body: 'Forbidden' })
      return true
    }

    try {
      const decoder = new TextDecoder()
      const body = decoder.decode(await Deno.readAll(req.body))
      const { settings } = JSON.parse(body)
      const updated = await updateSettings(
        (settings ?? {}) as Record<string, unknown>
      )

      clearAllMoviesCache()
      await refreshRadarrCache().catch(err =>
        log.error(
          `Failed to refresh Radarr cache after settings update: ${err}`
        )
      )
      await buildPlexCache().catch(err =>
        log.error(`Failed to refresh Plex cache after settings update: ${err}`)
      )

      await req.respond({
        status: 200,
        body: JSON.stringify({ settings: updated }),
        headers: new Headers({ 'content-type': 'application/json' }),
      })
    } catch (err) {
      if (err instanceof SettingsValidationError) {
        await req.respond({
          status: 400,
          body: JSON.stringify({
            error: 'Invalid settings payload',
            details: err.details,
          }),
          headers: new Headers({ 'content-type': 'application/json' }),
        })
        return true
      }

      log.error(`Settings update failed: ${err}`)
      await req.respond({
        status: 500,
        body: JSON.stringify({ error: 'Failed to update settings' }),
        headers: new Headers({ 'content-type': 'application/json' }),
      })
    }

    return true
  }

  return false
}
