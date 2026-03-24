// integrations/emby/cache.ts - Fast Emby availability checking
import { getEmbyApiKey, getEmbyUrl } from '../../core/config.ts'
import { createMediaServerCache } from '../shared/media-server-cache.ts'

const {
  buildCache,
  initCache,
  isMovieIn,
  getAllMovies,
} = createMediaServerCache('Emby', getEmbyUrl, getEmbyApiKey)

export const buildEmbyCache = buildCache
export const initEmbyCache = initCache
export const refreshEmbyCache = buildCache
export const isMovieInEmby = isMovieIn
export const getAllEmbyMovies = getAllMovies
