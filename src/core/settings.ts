export type SettingsKey =
  | 'PLEX_URL'
  | 'PLEX_TOKEN'
  | 'PLEX_LIBRARY_NAME'
  | 'PORT'
  | 'ACCESS_PASSWORD'
  | 'TMDB_API_KEY'
  | 'OMDB_API_KEY'
  | 'RADARR_URL'
  | 'RADARR_API_KEY'
  | 'JELLYSEERR_URL'
  | 'JELLYSEERR_API_KEY'
  | 'OVERSEERR_URL'
  | 'OVERSEERR_API_KEY'
  | 'LOG_LEVEL'
  | 'MOVIE_BATCH_SIZE'
  | 'LIBRARY_FILTER'
  | 'COLLECTION_FILTER'
  | 'ROOT_PATH'
  | 'DEFAULT_SECTION_TYPE_FILTER'
  | 'LINK_TYPE'
  | 'IMDB_SYNC_URL'
  | 'IMDB_SYNC_INTERVAL_MINUTES'
  | 'STREAMING_PROFILE_MODE'
  | 'PAID_STREAMING_SERVICES'
  | 'PERSONAL_MEDIA_SOURCES'

export type Settings = Record<SettingsKey, string>

export class SettingsValidationError extends Error {
  details: Record<string, string>

  constructor(details: Record<string, string>) {
    super('Settings validation failed')
    this.name = 'SettingsValidationError'
    this.details = details
  }
}

const SETTINGS_KEYS: SettingsKey[] = [
  'PLEX_URL',
  'PLEX_TOKEN',
  'PLEX_LIBRARY_NAME',
  'PORT',
  'ACCESS_PASSWORD',
  'TMDB_API_KEY',
  'OMDB_API_KEY',
  'RADARR_URL',
  'RADARR_API_KEY',
  'JELLYSEERR_URL',
  'JELLYSEERR_API_KEY',
  'OVERSEERR_URL',
  'OVERSEERR_API_KEY',
  'LOG_LEVEL',
  'MOVIE_BATCH_SIZE',
  'LIBRARY_FILTER',
  'COLLECTION_FILTER',
  'ROOT_PATH',
  'DEFAULT_SECTION_TYPE_FILTER',
  'LINK_TYPE',
  'IMDB_SYNC_URL',
  'IMDB_SYNC_INTERVAL_MINUTES',
  'STREAMING_PROFILE_MODE',
  'PAID_STREAMING_SERVICES',
  'PERSONAL_MEDIA_SOURCES',
]

const DEFAULTS: Partial<Settings> = {
  PORT: '8000',
  ACCESS_PASSWORD: '',
  LOG_LEVEL: 'INFO',
  MOVIE_BATCH_SIZE: '20',
  LIBRARY_FILTER: '',
  COLLECTION_FILTER: '',
  ROOT_PATH: '',
  DEFAULT_SECTION_TYPE_FILTER: 'movie',
  LINK_TYPE: 'app',
  PLEX_LIBRARY_NAME: 'My Plex Library',
  IMDB_SYNC_URL: '',
  IMDB_SYNC_INTERVAL_MINUTES: '0',
  STREAMING_PROFILE_MODE: 'anywhere',
  PAID_STREAMING_SERVICES: '',
  PERSONAL_MEDIA_SOURCES: '[]',
}

const VALID_STREAMING_PROFILE_MODES = new Set([
  'anywhere',
  'my_subscriptions',
  'my_libraries',
  'my_availability',
])

const VALID_PAID_STREAMING_SERVICES = new Set([
  'netflix',
  'amazon-prime',
  'disney-plus',
  'hbo-max',
  'hulu',
  'paramount-plus',
  'peacock',
  'apple-tv-plus',
])

const normalizeCsvList = (value: string) =>
  Array.from(
    new Set(
      value
        .split(',')
        .map(part => part.trim().toLowerCase())
        .filter(Boolean)
    )
  )

const validateAndNormalizeStreamingSettings = (
  settings: Settings,
  touchedKeys: Set<SettingsKey>
) => {
  const errors: Record<string, string> = {}

  if (touchedKeys.has('STREAMING_PROFILE_MODE')) {
    const mode = settings.STREAMING_PROFILE_MODE.trim().toLowerCase()
    settings.STREAMING_PROFILE_MODE = mode

    if (!VALID_STREAMING_PROFILE_MODES.has(mode)) {
      errors.STREAMING_PROFILE_MODE =
        'Must be one of: anywhere, my_subscriptions, my_libraries, my_availability.'
    }
  }

  if (touchedKeys.has('PAID_STREAMING_SERVICES')) {
    const normalizedServices = normalizeCsvList(settings.PAID_STREAMING_SERVICES)
    const invalidServices = normalizedServices.filter(
      service => !VALID_PAID_STREAMING_SERVICES.has(service)
    )

    if (invalidServices.length > 0) {
      errors.PAID_STREAMING_SERVICES = `Unknown services: ${invalidServices.join(', ')}`
    } else {
      settings.PAID_STREAMING_SERVICES = normalizedServices.join(',')
    }
  }

  if (touchedKeys.has('PERSONAL_MEDIA_SOURCES')) {
    const raw = settings.PERSONAL_MEDIA_SOURCES.trim()

    if (raw === '') {
      settings.PERSONAL_MEDIA_SOURCES = '[]'
    } else {
      try {
        const parsed = JSON.parse(raw)

        if (!Array.isArray(parsed)) {
          errors.PERSONAL_MEDIA_SOURCES = 'Must be a JSON array of strings.'
        } else if (!parsed.every(item => typeof item === 'string')) {
          errors.PERSONAL_MEDIA_SOURCES =
            'Must be a JSON array containing only string values.'
        } else {
          const normalized = Array.from(
            new Set(parsed.map(item => item.trim().toLowerCase()).filter(Boolean))
          )
          settings.PERSONAL_MEDIA_SOURCES = JSON.stringify(normalized)
        }
      } catch {
        errors.PERSONAL_MEDIA_SOURCES = 'Must be valid JSON (example: ["plex"]).'
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    throw new SettingsValidationError(errors)
  }
}

const DATA_DIR = Deno.env.get('DATA_DIR') || '/data'
const SETTINGS_FILE = `${DATA_DIR}/settings.json`

let settingsCache: Settings = SETTINGS_KEYS.reduce((acc, key) => {
  const envValue = Deno.env.get(key)
  const fallback = DEFAULTS[key] ?? ''
  acc[key] = (envValue ?? fallback ?? '').trim()
  return acc
}, {} as Settings)

const normalizeValue = (value: unknown) => {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

const syncEnv = (settings: Settings) => {
  for (const key of SETTINGS_KEYS) {
    const value = settings[key] ?? ''
    if (value === '') {
      try {
        Deno.env.delete(key)
      } catch {
        // ignore
      }
      continue
    }
    try {
      Deno.env.set(key, value)
    } catch {
      // ignore
    }
  }
}

const loadSettingsFile = async (): Promise<Partial<Settings>> => {
  try {
    const text = await Deno.readTextFile(SETTINGS_FILE)
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object') {
      return {}
    }
    const sanitized: Partial<Settings> = {}
    for (const key of SETTINGS_KEYS) {
      if (key in parsed) {
        sanitized[key] = normalizeValue(
          (parsed as Record<string, unknown>)[key]
        )
      }
    }
    return sanitized
  } catch (err) {
    if (err?.name === 'NotFound' || err?.code === 'ENOENT') {
      return {}
    }
    return {}
  }
}

const persistSettings = async () => {
  await Deno.mkdir(DATA_DIR, { recursive: true }).catch(() => {})
  const tmp = `${SETTINGS_FILE}.tmp.${Date.now()}`
  await Deno.writeTextFile(tmp, JSON.stringify(settingsCache, null, 2))
  await Deno.rename(tmp, SETTINGS_FILE)
}

const initSettings = async () => {
  const fileSettings = await loadSettingsFile()
  settingsCache = {
    ...settingsCache,
    ...fileSettings,
  }
  syncEnv(settingsCache)
}

await initSettings()

export const getSettings = (): Settings => ({ ...settingsCache })

export const getSetting = (key: SettingsKey): string => settingsCache[key] ?? ''

export const updateSettings = async (
  updates: Partial<Settings>
): Promise<Settings> => {
  const touchedKeys = new Set<SettingsKey>()

  for (const key of SETTINGS_KEYS) {
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      settingsCache[key] = normalizeValue(updates[key])
      touchedKeys.add(key)
    }
  }

  validateAndNormalizeStreamingSettings(settingsCache, touchedKeys)

  syncEnv(settingsCache)
  await persistSettings()
  return getSettings()
}

export const getSettingsKeys = (): SettingsKey[] => [...SETTINGS_KEYS]
