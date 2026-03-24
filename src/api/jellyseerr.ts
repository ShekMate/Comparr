import { getSeerrApiKey, getSeerrUrl } from '../core/config.ts'
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

const getServiceConfig = () => {
  const url = getSeerrUrl()
  const apiKey = getSeerrApiKey()

  if (url && apiKey) {
    return { url, apiKey }
  }

  return null
}

// Log configured state on module load
if (getServiceConfig()) {
  log.info('✅ Seerr request service configured')
} else {
  log.info('ℹ️  No Seerr request service configured')
}

export async function requestMovie(tmdbId: number): Promise<RequestResponse> {
  const config = getServiceConfig()

  if (!config) {
    log.warn('No Seerr configured')
    return { success: false, message: 'Request service not configured' }
  }

  try {
    log.info(`Requesting movie via Seerr: TMDb ID ${tmdbId}`)

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
      log.error(`Seerr API error: ${response.status} - ${errorText}`)

      let errorMessage = response.statusText
      try {
        const errorData: { message?: string } = JSON.parse(errorText)
        errorMessage = errorData.message || errorMessage
      } catch {
        errorMessage = errorText || errorMessage
      }

      return { success: false, message: `Request failed: ${errorMessage}` }
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

  if (!config) return null

  try {
    const response = await fetchWithTimeout(
      `${config.url}/api/v1/movie/${tmdbId}`,
      {
        headers: {
          'X-Api-Key': config.apiKey,
        },
      }
    )

    if (!response.ok) return null

    const data = await response.json()

    return {
      available: data.mediaInfo?.status === 5,
      pending: data.mediaInfo?.status === 2 || data.mediaInfo?.status === 3,
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
