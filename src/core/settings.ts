import {
  SettingsValidationError,
  validateAndNormalizeStreamingSettings,
} from './streamingProfileSettings.ts'

export type SettingsKey =
  | 'PLEX_URL'
  | 'PLEX_TOKEN'
  | 'PLEX_LIBRARY_NAME'
  | 'EMBY_URL'
  | 'EMBY_API_KEY'
  | 'EMBY_LIBRARY_NAME'
  | 'JELLYFIN_URL'
  | 'JELLYFIN_API_KEY'
  | 'JELLYFIN_LIBRARY_NAME'
  | 'PORT'
  | 'ACCESS_PASSWORD'
  | 'ADMIN_PASSWORD'
  | 'TMDB_API_KEY'
  | 'RADARR_URL'
  | 'RADARR_API_KEY'
  | 'SEERR_URL'
  | 'SEERR_API_KEY'
  | 'LOG_LEVEL'
  | 'MOVIE_BATCH_SIZE'
  | 'LIBRARY_FILTER'
  | 'COLLECTION_FILTER'
  | 'ROOT_PATH'
  | 'LINK_TYPE'
  | 'IMDB_SYNC_URL'
  | 'IMDB_SYNC_INTERVAL_MINUTES'
  | 'STREAMING_PROFILE_MODE'
  | 'PAID_STREAMING_SERVICES'
  | 'PERSONAL_MEDIA_SOURCES'
  | 'SETUP_WIZARD_COMPLETED'

export type Settings = Record<SettingsKey, string>

export { SettingsValidationError }

const SETTINGS_KEYS: SettingsKey[] = [
  'PLEX_URL',
  'PLEX_TOKEN',
  'PLEX_LIBRARY_NAME',
  'EMBY_URL',
  'EMBY_API_KEY',
  'EMBY_LIBRARY_NAME',
  'JELLYFIN_URL',
  'JELLYFIN_API_KEY',
  'JELLYFIN_LIBRARY_NAME',
  'PORT',
  'ACCESS_PASSWORD',
  'ADMIN_PASSWORD',
  'TMDB_API_KEY',
  'RADARR_URL',
  'RADARR_API_KEY',
  'SEERR_URL',
  'SEERR_API_KEY',
  'LOG_LEVEL',
  'MOVIE_BATCH_SIZE',
  'LIBRARY_FILTER',
  'COLLECTION_FILTER',
  'ROOT_PATH',
  'LINK_TYPE',
  'IMDB_SYNC_URL',
  'IMDB_SYNC_INTERVAL_MINUTES',
  'STREAMING_PROFILE_MODE',
  'PAID_STREAMING_SERVICES',
  'PERSONAL_MEDIA_SOURCES',
  'SETUP_WIZARD_COMPLETED',
]

const ENV_ONLY_KEYS = new Set<SettingsKey>(['PORT'])

const DEFAULTS: Partial<Settings> = {
  PORT: '8000',
  ACCESS_PASSWORD: '',
  ADMIN_PASSWORD: '',
  LOG_LEVEL: 'INFO',
  MOVIE_BATCH_SIZE: '20',
  LIBRARY_FILTER: '',
  COLLECTION_FILTER: '',
  ROOT_PATH: '',
  LINK_TYPE: 'app',
  PLEX_LIBRARY_NAME: 'My Plex Library',
  EMBY_LIBRARY_NAME: 'My Emby Library',
  JELLYFIN_LIBRARY_NAME: 'My Jellyfin Library',
  IMDB_SYNC_URL: '',
  IMDB_SYNC_INTERVAL_MINUTES: '0',
  STREAMING_PROFILE_MODE: 'anywhere',
  PAID_STREAMING_SERVICES: '[]',
  PERSONAL_MEDIA_SOURCES: '[]',
  SETUP_WIZARD_COMPLETED: 'false',
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
      if (ENV_ONLY_KEYS.has(key)) {
        continue
      }
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
  const persistedSettings = SETTINGS_KEYS.reduce((acc, key) => {
    if (ENV_ONLY_KEYS.has(key)) return acc
    acc[key] = settingsCache[key]
    return acc
  }, {} as Partial<Settings>)
  await Deno.writeTextFile(tmp, JSON.stringify(persistedSettings, null, 2))
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
    if (ENV_ONLY_KEYS.has(key)) {
      continue
    }
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

export const resetSettings = async (): Promise<Settings> => {
  for (const key of SETTINGS_KEYS) {
    if (ENV_ONLY_KEYS.has(key)) continue
    settingsCache[key] = normalizeValue(DEFAULTS[key] ?? '')
  }
  syncEnv(settingsCache)
  await persistSettings()
  return getSettings()
}
