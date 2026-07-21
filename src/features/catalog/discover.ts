import * as log from 'jsr:@std/log'

import { getTmdbApiKey } from '../../core/config.ts'
import { tmdbFetch } from '../../api/tmdb.ts'
import { resolveGenreIds } from './genres.ts'

const getTmdbKey = () => getTmdbApiKey()
const DEFAULT_DISCOVER_REGION = 'US'
const DEFAULT_DISCOVER_LANGUAGES = ['en']
const DEFAULT_DISCOVER_YEAR_MIN = 1970

// Type definitions
interface DiscoverFilters {
  yearMin?: number
  yearMax?: number
  genres?: string[]
  page?: number
  tmdbRating?: number
  tmdbRatingMax?: number
  languages?: string[]
  countries?: string[]
  runtimeMin?: number
  runtimeMax?: number
  voteCount?: number
  sortBy?: string
  contentRatings?: string[]
  // ISO 3166-1 country whose certification system contentRatings' values belong to (e.g. 'JP'
  // for Japan's G/PG12/R15+/R18+). TMDb's discover endpoint only accepts one
  // certification_country per request, so this is a single value, not a list — the client
  // picks it based on which single country (if any) is active in its own Country filter,
  // defaulting to 'US' otherwise. See mobile's lib/certifications.ts for the full per-country
  // rating value lists this must line up with.
  certificationCountry?: string
  streamingServices?: string[]
  includeFreeStreaming?: boolean
}

interface TMDbDiscoverResult {
  page: number
  results: Array<{
    id: number
    title: string
    poster_path: string | null
    release_date: string
    vote_average: number
  }>
  total_pages: number
  total_results: number
}

async function j(path: string, token: string, params: URLSearchParams) {
  const r = await tmdbFetch(path, token, Object.fromEntries(params.entries()))
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${path}`)
  return r.json()
}

// Map UI streaming service names to TMDb provider IDs (US region, verified against the live
// /watch/providers/movie endpoint — several services only exist on TMDb as channel add-ons
// (e.g. bundled through an Amazon/Apple Channel) rather than a single standalone entry, hence
// the multiple IDs for those). Two naming schemes are both supported here: the legacy lowercase
// hyphenated slugs (still used by the instance-wide admin PAID_STREAMING_SERVICES setting) and
// the human-readable names shown in the mobile app's per-user subscription picker
// (lib/streaming-services.ts's PAID_STREAMING_SERVICE_OPTIONS) — both resolve to the same IDs.
// BET+ has no matching entry in TMDb's movie watch-provider list at all (checked live), so it's
// deliberately omitted rather than guessed.
const STREAMING_PROVIDER_MAP: Record<string, number[]> = {
  // Legacy admin slugs (core/streamingProfileSettings.ts's VALID_PAID_STREAMING_SERVICES)
  netflix: [8],
  'amazon-prime': [9],
  'disney-plus': [337],
  'hbo-max': [1899],
  hulu: [15],
  'paramount-plus': [2303, 2616], // TMDb split this into Premium/Essential tiers
  peacock: [386, 387], // Premium (with ads) / Premium Plus (ad-free)
  'apple-tv-plus': [350],

  // Mobile per-user picker names (lib/streaming-services.ts)
  'A&E Crime Central': [2033], // channel-only on TMDb (Apple), no standalone entry
  'Acorn TV': [87],
  ALLBLK: [251],
  'Amazon Prime': [9],
  'AMC+': [526],
  'Apple TV+': [350],
  BritBox: [151],
  BroadwayHD: [554],
  'Carnegie Hall+': [2042, 2071], // channel-only on TMDb (Apple/Amazon), no standalone entry
  Cinemax: [289, 2061], // channel-only on TMDb (Amazon/Apple), no standalone entry
  Crunchyroll: [283],
  CuriosityStream: [190, 603, 2060],
  'Discovery+': [520, 584],
  'Disney+': [337],
  'Film Movement Plus': [579],
  Hallmark: [290, 1746, 2058], // channel-only on TMDb, no standalone entry
  'Hi-YAH': [503, 2403], // verified primarily-paid via web search — TMDb catalog data alone was ambiguous
  'HISTORY Vault': [268],
  Hulu: [15],
  'Lifetime Movie Club': [284],
  Max: [1899],
  'MGM+': [34],
  'MovieSphere+': [2445], // channel-only on TMDb (Amazon), no standalone entry
  Netflix: [8],
  'Paramount+': [2303, 2616],
  Peacock: [386, 387],
  Shudder: [99],
  Starz: [43],
  Tastemade: [2047, 2068], // channel-only on TMDb (Apple/Amazon), no standalone entry
  'UP Faith & Family': [2045, 2066], // channel-only on TMDb, no standalone entry
}

export async function discoverMovies(
  filters: DiscoverFilters
): Promise<TMDbDiscoverResult> {
  const TMDB = getTmdbKey()
  if (!TMDB) return { results: [], page: 1, total_pages: 0, total_results: 0 }

  const params = new URLSearchParams({
    sort_by: filters.sortBy || 'popularity.desc',
    include_adult: 'false',
    page: String(filters.page || 1),
    watch_region: DEFAULT_DISCOVER_REGION, // Required for streaming providers
    region: DEFAULT_DISCOVER_REGION,
  })

  const yearMin = filters.yearMin ?? DEFAULT_DISCOVER_YEAR_MIN
  params.set('primary_release_date.gte', `${yearMin}-01-01`)
  if (filters.yearMax)
    params.set('primary_release_date.lte', `${filters.yearMax}-12-31`)
  if (filters.genres?.length) {
    const genreIds = resolveGenreIds(filters.genres)
    if (genreIds.length) params.set('with_genres', genreIds.join('|'))
  }
  if (filters.tmdbRating)
    params.set('vote_average.gte', filters.tmdbRating.toString())
  if (filters.tmdbRatingMax)
    params.set('vote_average.lte', filters.tmdbRatingMax.toString())

  // CRITICAL FIX: Pass vote count to TMDb API to avoid fetching low-vote movies
  if (filters.voteCount && filters.voteCount > 0) {
    params.set('vote_count.gte', filters.voteCount.toString())
    log.debug(`🎯 Filtering by vote count >= ${filters.voteCount} at API level`)
  }

  if (Array.isArray(filters.languages) && filters.languages.length) {
    params.set('with_original_language', filters.languages.join('|'))
  } else if (filters.languages === undefined) {
    params.set('with_original_language', DEFAULT_DISCOVER_LANGUAGES.join('|'))
  }
  if (filters.countries?.length)
    params.set('with_origin_country', filters.countries.join('|'))

  if (filters.runtimeMin && filters.runtimeMin > 0)
    params.set('with_runtime.gte', filters.runtimeMin.toString())
  if (filters.runtimeMax && filters.runtimeMax > 0)
    params.set('with_runtime.lte', filters.runtimeMax.toString())

  // Map streaming services to TMDb provider IDs
  const providerIds = (filters.streamingServices ?? [])
    .filter(service => service !== 'my-plex-library') // Exclude Plex
    .flatMap(service => STREAMING_PROVIDER_MAP[service] ?? [])
  const uniqueProviderIds = [...new Set(providerIds)]

  if (uniqueProviderIds.length > 0) {
    params.set('with_watch_providers', uniqueProviderIds.join('|'))
    log.debug(`🎬 Using TMDb streaming providers: ${uniqueProviderIds.join(', ')}`)
  }

  // with_watch_providers and with_watch_monetization_types AND together (not OR) — so with a
  // provider list set, restricting to flatrate/free/ads here scopes to "available on one of my
  // selected services in a way that doesn't cost extra" (excludes rent/buy-only listings on
  // those same providers). With no provider list (just the free/ad-supported toggle on its
  // own), this matches free/ad-supported content across every provider, not just specific ones.
  const monetizationTypes: string[] = []
  if (uniqueProviderIds.length > 0) monetizationTypes.push('flatrate')
  if (filters.includeFreeStreaming) monetizationTypes.push('free', 'ads')
  if (monetizationTypes.length > 0) {
    params.set('with_watch_monetization_types', monetizationTypes.join('|'))
  }

  if (filters.contentRatings?.length) {
    params.set('certification_country', filters.certificationCountry || 'US')
    params.set('certification', filters.contentRatings.join('|'))
  }

  const url = `/discover/movie?${params}`

  log.debug('🔍 TMDb API Call:', {
    url,
    params: Object.fromEntries(params.entries()),
  })

  const data = await j('/discover/movie', TMDB, params)

  log.info(
    `📊 TMDb Results: ${data.total_results} total, ${
      data.results?.length || 0
    } on page`
  )
  if (data.results?.length === 0) {
    log.warn('⚠️ TMDb returned no results for current filters')
  }

  return data
}
