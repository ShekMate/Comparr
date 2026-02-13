import {
  getJellyseerrApiKey,
  getJellyseerrUrl,
  getOmdbApiKey,
  getOverseerrApiKey,
  getOverseerrUrl,
  getPlexToken,
  getPlexUrl,
  getRadarrApiKey,
  getRadarrUrl,
  getTmdbApiKey,
} from '../../../core/config.ts'

export async function handleConfigDebugRoute(req: any, path: string) {
  if (path !== '/api/debug/config') {
    return false
  }

  await req.respond({
    status: 200,
    body: JSON.stringify(
      {
        tmdb_configured: !!getTmdbApiKey(),
        omdb_configured: !!getOmdbApiKey(),
        plex_configured: !!(getPlexUrl() && getPlexToken()),
        radarr_configured: !!(getRadarrUrl() && getRadarrApiKey()),
        jellyseerr_configured: !!(getJellyseerrUrl() && getJellyseerrApiKey()),
        overseerr_configured: !!(getOverseerrUrl() && getOverseerrApiKey()),
      },
      null,
      2
    ),
    headers: new Headers({ 'content-type': 'application/json' }),
  })

  return true
}
