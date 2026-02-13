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


const splitCsvSetting = (value: string) =>
  value
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)

export const getPlexUrl = () => normalizeUrl(getSettingTrimmed('PLEX_URL'))
export const getPlexToken = () => getSettingTrimmed('PLEX_TOKEN')
export const getPort = () => getSettingTrimmed('PORT') ?? '8000'
export const LOG_LEVEL = getSettingTrimmed('LOG_LEVEL') ?? 'INFO'
export const getMovieBatchSize = () =>
  getSettingTrimmed('MOVIE_BATCH_SIZE') ?? '20'
export const getLinkType = () => getSettingTrimmed('LINK_TYPE') ?? 'app'
export const getDefaultSectionTypeFilter = () =>
  getSettingTrimmed('DEFAULT_SECTION_TYPE_FILTER') ?? 'movie'
export const getLibraryFilter = () => getSettingTrimmed('LIBRARY_FILTER') ?? ''
export const getCollectionFilter = () =>
  getSettingTrimmed('COLLECTION_FILTER') ?? ''
export const getRootPath = () => getSettingTrimmed('ROOT_PATH') ?? ''
export const getPlexLibraryName = () =>
  getSettingTrimmed('PLEX_LIBRARY_NAME') ?? 'My Plex Library'
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
export const getOmdbApiKey = () => getSettingTrimmed('OMDB_API_KEY')
export const getStreamingProfileMode = () =>
  getSettingTrimmed('STREAMING_PROFILE_MODE') ?? 'anywhere'
export const getPaidStreamingServices = () =>
  splitCsvSetting(getSettingTrimmed('PAID_STREAMING_SERVICES') ?? '')
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
