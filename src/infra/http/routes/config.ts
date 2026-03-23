import type { CompatRequest } from '../compat-request.ts'
import {
  getSeerrApiKey,
  getSeerrUrl,
  getPlexToken,
  getPlexUrl,
  getRadarrApiKey,
  getRadarrUrl,
  getTmdbApiKey,
} from '../../../core/config.ts'

export function handleConfigDebugRoute(
  _req: CompatRequest,
  path: string
): Promise<Response | null> {
  if (path !== '/api/debug/config') {
    return Promise.resolve(null)
  }

  return Promise.resolve(
    new Response(
      JSON.stringify(
        {
          tmdb_configured: !!getTmdbApiKey(),
          plex_configured: !!(getPlexUrl() && getPlexToken()),
          radarr_configured: !!(getRadarrUrl() && getRadarrApiKey()),
          seerr_configured: !!(getSeerrUrl() && getSeerrApiKey()),
        },
        null,
        2
      ),
      {
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
      }
    )
  )
}
