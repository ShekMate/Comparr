import {
  getJellyseerrApiKey,
  getJellyseerrUrl,
  getOverseerrApiKey,
  getOverseerrUrl,
  getSeerrApiKey,
  getSeerrUrl,
} from '../core/config.ts'
import * as log from 'jsr:@std/log'
import { fetchWithTimeout } from '../infra/http/fetch-with-timeout.ts'

interface RequestResponse {
  success: boolean
  message?: string
  mediaId?: number
  requestId?: number
}

interface MediaStatus {
  available: boolean
  pending: boolean
  processing: boolean
}

// Validate configuration on startup
const validateConfiguration = () => {
  const seerrConfigured = !!(getSeerrUrl() && getSeerrApiKey())
  const jellyseerrConfigured = !!(getJellyseerrUrl() && getJellyseerrApiKey())
  const overseerrConfigured = !!(getOverseerrUrl() && getOverseerrApiKey())
  const configuredServices = [
    seerrConfigured ? 'Seerr' : '',
    jellyseerrConfigured ? 'Jellyseerr' : '',
    overseerrConfigured ? 'Overseerr' : '',
  ].filter(Boolean)

  if (configuredServices.length > 1) {
    log.warn(
      `⚠️  Multiple request services configured (${configuredServices.join(
        ', '
      )}). Only one should be set.`
    )
    log.warn(
      '⚠️  Seerr is preferred, then Jellyseerr, then Overseerr. Remove extra configuration keys.'
    )
  }

  if (seerrConfigured) {
    log.info('✅ Seerr request service configured')
  } else if (jellyseerrConfigured) {
    log.info('✅ Jellyseerr request service configured')
  } else if (overseerrConfigured) {
    log.info('✅ Overseerr request service configured')
  } else {
    log.info('ℹ️  No request service configured (Seerr/Jellyseerr/Overseerr)')
  }
}

// Determine which service is configured
const getServiceConfig = () => {
  const seerrUrl = getSeerrUrl()
  const seerrApiKey = getSeerrApiKey()
  const jellyseerrUrl = getJellyseerrUrl()
  const jellyseerrApiKey = getJellyseerrApiKey()
  const overseerrUrl = getOverseerrUrl()
  const overseerrApiKey = getOverseerrApiKey()
  const seerrConfigured = !!(seerrUrl && seerrApiKey)
  const jellyseerrConfigured = !!(jellyseerrUrl && jellyseerrApiKey)
  const overseerrConfigured = !!(overseerrUrl && overseerrApiKey)

  // Prioritize Seerr, then Jellyseerr, then Overseerr
  if (seerrConfigured && (jellyseerrConfigured || overseerrConfigured)) {
    log.warn('Multiple request services configured - using Seerr')
  } else if (jellyseerrConfigured && overseerrConfigured) {
    log.warn('Multiple request services configured - using Jellyseerr')
  }

  if (seerrConfigured) {
    return {
      url: seerrUrl!,
      apiKey: seerrApiKey!,
      service: 'seerr',
    }
  }

  if (jellyseerrConfigured) {
    return {
      url: jellyseerrUrl!,
      apiKey: jellyseerrApiKey!,
      service: 'jellyseerr',
    }
  }

  if (overseerrConfigured) {
    return {
      url: overseerrUrl!,
      apiKey: overseerrApiKey!,
      service: 'overseerr',
    }
  }

  return null
}

// Run validation on module load
validateConfiguration()

export async function requestMovie(tmdbId: number): Promise<RequestResponse> {
  const config = getServiceConfig()

  if (!config) {
    log.warn('No Seerr, Jellyseerr, or Overseerr configured')
    return { success: false, message: 'Request service not configured' }
  }

  try {
    log.info(`Requesting movie via ${config.service}: TMDb ID ${tmdbId}`)

    const response = await fetchWithTimeout(`${config.url}/api/v1/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': config.apiKey,
      },
      body: JSON.stringify({
        mediaType: 'movie',
        mediaId: tmdbId,
        is4k: false,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      log.error(
        `${config.service} API error: ${response.status} - ${errorText}`
      )

      // Try to parse the actual error message from Jellyseerr/Overseerr
      let errorMessage = response.statusText
      try {
        const errorData: { message?: string } = JSON.parse(errorText)
        errorMessage = errorData.message || errorMessage
      } catch {
        // If not JSON, use the raw text or status text
        errorMessage = errorText || errorMessage
      }

      return { success: false, message: `Request failed: ${errorMessage}` } // ✅ CORRECT
    }

    const data = await response.json()
    log.info(`Movie request successful: ${JSON.stringify(data)}`)

    return {
      success: true,
      message: 'Movie requested successfully',
      mediaId: data.media?.id,
      requestId: data.id,
    }
  } catch (error) {
    log.error(`Failed to request movie: ${error}`)
    return { success: false, message: `Error: ${error.message}` }
  }
}

export async function getMediaStatus(
  tmdbId: number
): Promise<MediaStatus | null> {
  const config = getServiceConfig()

  if (!config) {
    return null
  }

  try {
    const response = await fetchWithTimeout(
      `${config.url}/api/v1/movie/${tmdbId}`,
      {
        headers: {
          'X-Api-Key': config.apiKey,
        },
      }
    )

    if (!response.ok) {
      return null
    }

    const data = await response.json()

    return {
      available: data.mediaInfo?.status === 5, // Status 5 = Available
      pending: data.mediaInfo?.status === 2 || data.mediaInfo?.status === 3, // Pending or Processing
      processing: data.mediaInfo?.status === 3,
    }
  } catch (error) {
    log.error(`Failed to get media status: ${error}`)
    return null
  }
}

export function isRequestServiceConfigured(): boolean {
  return getServiceConfig() !== null
}
