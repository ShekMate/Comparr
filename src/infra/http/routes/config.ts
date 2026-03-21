import type { CompatRequest } from '../compat-request.ts'
import {
  getJellyseerrApiKey,
  getJellyseerrUrl,
  getOverseerrApiKey,
  getOverseerrUrl,
  getSeerrApiKey,
  getSeerrUrl,
  getPlexToken,
  getPlexUrl,
  getRadarrApiKey,
  getRadarrUrl,
  getTmdbApiKey,
} from '../../../core/config.ts'

export async function handleConfigDebugRoute(
  _req: CompatRequest,
  path: string
): Promise<Response | null> {
  if (path !== '/api/debug/config') {
    return null
  }

  return new Response(
    JSON.stringify(
      {
        tmdb_configured: !!getTmdbApiKey(),
        plex_configured: !!(getPlexUrl() && getPlexToken()),
        radarr_configured: !!(getRadarrUrl() && getRadarrApiKey()),
        jellyseerr_configured: !!(getJellyseerrUrl() && getJellyseerrApiKey()),
        overseerr_configured: !!(getOverseerrUrl() && getOverseerrApiKey()),
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
}
