import { JELLYSEERR_URL, JELLYSEERR_API_KEY, OVERSEERR_URL, OVERSEERR_API_KEY } from '../core/config.ts'
import * as log from 'https://deno.land/std@0.79.0/log/mod.ts'

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
  const jellyseerrConfigured = !!(JELLYSEERR_URL && JELLYSEERR_API_KEY)
  const overseerrConfigured = !!(OVERSEERR_URL && OVERSEERR_API_KEY)
  
  if (jellyseerrConfigured && overseerrConfigured) {
    log.warning('⚠️  Both Jellyseerr and Overseerr are configured! Only one should be set.')
    log.warning('⚠️  Jellyseerr will be used. Please remove Overseerr configuration from your .env file.')
  }
  
  if (jellyseerrConfigured) {
    log.info('✅ Jellyseerr request service configured')
  } else if (overseerrConfigured) {
    log.info('✅ Overseerr request service configured')
  } else {
    log.info('ℹ️  No request service configured (Jellyseerr/Overseerr)')
  }
}

// Determine which service is configured
const getServiceConfig = () => {
  const jellyseerrConfigured = !!(JELLYSEERR_URL && JELLYSEERR_API_KEY)
  const overseerrConfigured = !!(OVERSEERR_URL && OVERSEERR_API_KEY)
  
  // Prioritize Jellyseerr if both are configured
  if (jellyseerrConfigured && overseerrConfigured) {
    log.warning('Both services configured - using Jellyseerr')
  }
  
  if (jellyseerrConfigured) {
    return { url: JELLYSEERR_URL, apiKey: JELLYSEERR_API_KEY, service: 'jellyseerr' }
  } else if (overseerrConfigured) {
    return { url: OVERSEERR_URL, apiKey: OVERSEERR_API_KEY, service: 'overseerr' }
  }
  return null
}

// Run validation on module load
validateConfiguration()

export async function requestMovie(tmdbId: number): Promise<RequestResponse> {
  const config = getServiceConfig()
  
  if (!config) {
    log.warning('No Jellyseerr or Overseerr configured')
    return { success: false, message: 'Request service not configured' }
  }

  try {
    log.info(`Requesting movie via ${config.service}: TMDb ID ${tmdbId}`)
    
    const response = await fetch(`${config.url}/api/v1/request`, {
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
	  log.error(`${config.service} API error: ${response.status} - ${errorText}`)
	  
	  // Try to parse the actual error message from Jellyseerr/Overseerr
	  let errorMessage = response.statusText
	  try {
		const errorData = JSON.parse(errorText)
		errorMessage = errorData.message || errorMessage
	  } catch {
		// If not JSON, use the raw text or status text
		errorMessage = errorText || errorMessage
	  }
	  
	  return { success: false, message: `Request failed: ${errorMessage}` }  // ✅ CORRECT
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

export async function getMediaStatus(tmdbId: number): Promise<MediaStatus | null> {
  const config = getServiceConfig()
  
  if (!config) {
    return null
  }

  try {
    const response = await fetch(`${config.url}/api/v1/movie/${tmdbId}`, {
      headers: {
        'X-Api-Key': config.apiKey,
      },
    })

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