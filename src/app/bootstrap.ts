import * as log from 'jsr:@std/log'
import { getPlexToken, getPlexUrl, getTmdbApiKey } from '../core/config.ts'
import { getSettings } from '../core/settings.ts'
import { initializeRadarrCache } from '../api/radarr.ts'
import {
  initIMDbDatabase,
  startBackgroundUpdateJob,
} from '../features/catalog/imdb-datasets.ts'
import { initUserDatabase } from '../features/auth/user-db.ts'
import { ensurePlexHydrationReady } from '../features/session/session.ts'
import { initPlexCache } from '../integrations/plex/cache.ts'
import { initEmbyCache } from '../integrations/emby/cache.ts'
import { initJellyfinCache } from '../integrations/jellyfin/cache.ts'
import { initPosterCache } from '../services/cache/poster-cache.ts'

export const bootstrapApplication = () => {
  // Initialize user database (for media-server auth)
  try {
    initUserDatabase()
    log.info('[startup] User database ready')
  } catch (err) {
    log.error(`[startup] User database init FAILED: ${err}`)
  }

  // Initialize Radarr cache in background
  initializeRadarrCache().catch(err =>
    log.error(`Failed to initialize Radarr cache: ${err}`)
  )

  // Initialize IMDb ratings database and start background update job
  log.info(`[startup] Initializing IMDb database (requires --allow-ffi)`)
  try {
    initIMDbDatabase()
    log.info(`[startup] IMDb database init complete`)
  } catch (err) {
    log.error(`[startup] IMDb database init FAILED: ${err}`)
  }

  const setupWizardCompleted =
    String(getSettings().SETUP_WIZARD_COMPLETED ?? '').toLowerCase() === 'true'
  if (setupWizardCompleted) {
    startBackgroundUpdateJob()
  } else {
    log.info(
      '[startup] Setup wizard incomplete; deferring IMDb background download job'
    )
  }

  // Initialize Plex availability cache
  const plexCacheReady = initPlexCache()
  plexCacheReady.catch(err =>
    log.error(`Failed to initialize Plex cache: ${err}`)
  )
  initEmbyCache().catch(err =>
    log.error(`Failed to initialize Emby cache: ${err}`)
  )
  initJellyfinCache().catch(err =>
    log.error(`Failed to initialize Jellyfin cache: ${err}`)
  )
  ensurePlexHydrationReady().catch(err =>
    log.error(`Failed to hydrate persisted watch list: ${err?.message || err}`)
  )

  // Initialize poster cache
  initPosterCache().catch(err =>
    log.error(`Failed to initialize poster cache: ${err}`)
  )

  // Startup configuration check
  log.info(`🔍 Config check:`)
  log.info(`  TMDB_API_KEY: ${getTmdbApiKey() ? '✅ Set' : '❌ Missing'}`)
  log.info(`  PLEX_URL: ${getPlexUrl() ? '✅ Set' : '❌ Missing'}`)
  log.info(`  PLEX_TOKEN: ${getPlexToken() ? '✅ Set' : '❌ Missing'}`)
}
