import type { Settings, SettingsKey } from './settings.ts'

export class SettingsValidationError extends Error {
  details: Record<string, string>

  constructor(details: Record<string, string>) {
    super('Settings validation failed')
    this.name = 'SettingsValidationError'
    this.details = details
  }
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

export const validateAndNormalizeStreamingSettings = (
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
