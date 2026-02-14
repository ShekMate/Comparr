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

const normalizeStringList = (value: string[]): string[] =>
  Array.from(
    new Set(value.map(part => part.trim().toLowerCase()).filter(Boolean))
  )

const parseServiceList = (raw: string): string[] => {
  const trimmed = raw.trim()
  if (!trimmed) return []

  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed)
    if (
      !Array.isArray(parsed) ||
      !parsed.every(item => typeof item === 'string')
    ) {
      throw new Error('Invalid paid services array')
    }
    return normalizeStringList(parsed as string[])
  }

  // Backward compatibility for existing CSV settings.
  return normalizeStringList(trimmed.split(','))
}

const parsePersonalMediaSources = (raw: string): string[] => {
  const trimmed = raw.trim()
  if (!trimmed) return []

  const parsed = JSON.parse(trimmed)
  if (
    !Array.isArray(parsed) ||
    !parsed.every(item => typeof item === 'string')
  ) {
    throw new Error('Invalid personal sources array')
  }

  return normalizeStringList(parsed as string[])
}

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
    try {
      const normalizedServices = parseServiceList(
        settings.PAID_STREAMING_SERVICES
      )
      const invalidServices = normalizedServices.filter(
        service => !VALID_PAID_STREAMING_SERVICES.has(service)
      )

      if (invalidServices.length > 0) {
        errors.PAID_STREAMING_SERVICES = `Unknown services: ${invalidServices.join(
          ', '
        )}`
      } else {
        settings.PAID_STREAMING_SERVICES = JSON.stringify(normalizedServices)
      }
    } catch {
      errors.PAID_STREAMING_SERVICES =
        'Must be a JSON array of strings (example: ["netflix"]).'
    }
  }

  if (touchedKeys.has('PERSONAL_MEDIA_SOURCES')) {
    try {
      settings.PERSONAL_MEDIA_SOURCES = JSON.stringify(
        parsePersonalMediaSources(settings.PERSONAL_MEDIA_SOURCES)
      )
    } catch {
      errors.PERSONAL_MEDIA_SOURCES =
        'Must be valid JSON array of strings (example: ["plex"]).'
    }
  }

  if (Object.keys(errors).length > 0) {
    throw new SettingsValidationError(errors)
  }
}
