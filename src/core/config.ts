import * as log from 'https://deno.land/std@0.79.0/log/mod.ts'
import { getSetting } from './settings.ts'

const getSettingTrimmed = (name: Parameters<typeof getSetting>[0]) => {
  const value = getSetting(name)
  if (typeof value === 'string') {
    return value.trim()
  }

  return value
}

const normalizeUrl = (value?: string) =>
  typeof value === 'string' && value !== '' ? value.replace(/\/$/, '') : ''

const normalizePlexUrl = (value?: string) => {
  const trimmed = normalizeUrl(value)
  if (!trimmed) return ''

  try {
    const parsed = new URL(trimmed)
    const normalizedPath = parsed.pathname
      .replace(/\/$/, '')
      .replace(/\/web$/i, '')
      .replace(/\/web\/index\.html$/i, '')

    return `${parsed.origin}${normalizedPath}`.replace(/\/$/, '')
  } catch {
    return trimmed
      .replace(/\/web\/index\.html$/i, '')
      .replace(/\/web$/i, '')
      .replace(/\/$/, '')
  }
}

const splitCsvSetting = (value: string) =>
  value
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)

const parseJsonArraySetting = (value: string): string[] => {
  if (!value) return []

  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.map(item => String(item).trim().toLowerCase()).filter(Boolean)
  } catch {
    return []
  }
}

export const getPlexUrl = () => normalizePlexUrl(getSettingTrimmed('PLEX_URL'))
export const getPlexToken = () => getSettingTrimmed('PLEX_TOKEN')
export const getPort = () => getSettingTrimmed('PORT') ?? '8000'
export const LOG_LEVEL = getSettingTrimmed('LOG_LEVEL') ?? 'INFO'
export const getMovieBatchSize = () =>
  getSettingTrimmed('MOVIE_BATCH_SIZE') ?? '20'
export const getLinkType = () => getSettingTrimmed('LINK_TYPE') ?? 'app'
export const getLibraryFilter = () => getSettingTrimmed('LIBRARY_FILTER') ?? ''
export const getCollectionFilter = () =>
  getSettingTrimmed('COLLECTION_FILTER') ?? ''
export const getRootPath = () => getSettingTrimmed('ROOT_PATH') ?? ''
export const getPlexLibraryName = () =>
  getSettingTrimmed('PLEX_LIBRARY_NAME') ?? 'My Plex Library'

export const getEmbyUrl = () => normalizeUrl(getSettingTrimmed('EMBY_URL'))
export const getEmbyApiKey = () => getSettingTrimmed('EMBY_API_KEY')
export const getEmbyLibraryName = () =>
  getSettingTrimmed('EMBY_LIBRARY_NAME') ?? 'My Emby Library'
export const getJellyfinUrl = () =>
  normalizeUrl(getSettingTrimmed('JELLYFIN_URL'))
export const getJellyfinApiKey = () => getSettingTrimmed('JELLYFIN_API_KEY')
export const getJellyfinLibraryName = () =>
  getSettingTrimmed('JELLYFIN_LIBRARY_NAME') ?? 'My Jellyfin Library'
export const getRadarrUrl = () => normalizeUrl(getSettingTrimmed('RADARR_URL'))
export const getRadarrApiKey = () => getSettingTrimmed('RADARR_API_KEY')
export const getAccessPassword = () =>
  getSettingTrimmed('ACCESS_PASSWORD') ?? ''
export const getJellyseerrUrl = () =>
  normalizeUrl(getSettingTrimmed('JELLYSEERR_URL'))
export const getJellyseerrApiKey = () => getSettingTrimmed('JELLYSEERR_API_KEY')
export const getOverseerrUrl = () =>
  normalizeUrl(getSettingTrimmed('OVERSEERR_URL'))
export const getOverseerrApiKey = () => getSettingTrimmed('OVERSEERR_API_KEY')
export const getTmdbApiKey = () => getSettingTrimmed('TMDB_API_KEY')
export const getStreamingProfileMode = () =>
  getSettingTrimmed('STREAMING_PROFILE_MODE') ?? 'anywhere'
export const getPaidStreamingServices = () =>
  splitCsvSetting(getSettingTrimmed('PAID_STREAMING_SERVICES') ?? '')
export const getPersonalMediaSources = () =>
  parseJsonArraySetting(getSettingTrimmed('PERSONAL_MEDIA_SOURCES') ?? '[]')
export const getTrustProxy = () =>
  (Deno.env.get('TRUST_PROXY') ?? 'false').trim().toLowerCase() === 'true'
export const getMaxBodySize = () => {
  const raw = Number((Deno.env.get('MAX_BODY_SIZE') ?? '1048576').trim())
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 1_048_576
}
export const getAllowedOrigins = () =>
  (Deno.env.get('ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean)
export const getVersion = async () => {
  const pkgText = await Deno.readTextFile(Deno.cwd() + '/package.json')
  const pkg: { version: string } = JSON.parse(pkgText)
  return pkg.version
}

function getLogLevel(): keyof typeof log.LogLevels {
  if (LOG_LEVEL in log.LogLevels) {
    return LOG_LEVEL as keyof typeof log.LogLevels
  } else {
    throw new Error(
      `${LOG_LEVEL} is not a recognised log level. Please use one of these: ${Object.keys(
        log.LogLevels
      )}`
    )
  }
}

await log.setup({
  handlers: {
    console: new log.handlers.ConsoleHandler(getLogLevel()),
  },

  loggers: {
    default: {
      level: getLogLevel(),
      handlers: ['console'],
    },
  },
})

log.debug(`Log level ${LOG_LEVEL}`)
