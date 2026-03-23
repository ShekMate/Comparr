// integrations/jellyfin/cache.ts - Fast Jellyfin availability checking
import { getJellyfinApiKey, getJellyfinUrl } from '../../core/config.ts'
import { createMediaServerCache } from '../shared/media-server-cache.ts'

const {
  buildCache,
  initCache,
  isMovieIn,
  getAllMovies,
} = createMediaServerCache('Jellyfin', getJellyfinUrl, getJellyfinApiKey)

export const buildJellyfinCache = buildCache
export const initJellyfinCache = initCache
export const refreshJellyfinCache = buildCache
export const isMovieInJellyfin = isMovieIn
export const getAllJellyfinMovies = getAllMovies
