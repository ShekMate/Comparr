import * as log from 'https://deno.land/std@0.79.0/log/mod.ts'

const TMDB = Deno.env.get("TMDB_API_KEY");
const DEFAULT_DISCOVER_REGION = 'US';
const DEFAULT_DISCOVER_LANGUAGES = ['en'];
const DEFAULT_DISCOVER_YEAR_MIN = 1970;

// Type definitions
interface DiscoverFilters {
  yearMin?: number
  yearMax?: number
  genres?: string[]
  page?: number
  tmdbRating?: number
  languages?: string[]
  countries?: string[]
  runtimeMin?: number
  runtimeMax?: number
  voteCount?: number
  sortBy?: string
  contentRatings?: string[]
  streamingServices?: string[]
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

async function j(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.json();
}

// Map UI streaming service names to TMDb provider IDs (US region)
const STREAMING_PROVIDER_MAP: Record<string, number> = {
  'netflix': 8,
  'amazon-prime': 9,
  'disney-plus': 337,
  'hbo-max': 1899,
  'hulu': 15,
  'paramount-plus': 531,
  'peacock': 387,
  'apple-tv-plus': 350
};

// Map UI sort options to valid TMDb sort parameters
// TMDb doesn't support sorting by IMDb rating directly, so we map it to vote_average
function mapSortOption(sortBy?: string): string {
  if (!sortBy) return 'popularity.desc';

  // Map IMDb rating to TMDb's vote_average (closest equivalent)
  if (sortBy === 'imdb_rating.desc') return 'vote_average.desc';
  if (sortBy === 'imdb_rating.asc') return 'vote_average.asc';

  // Map Rotten Tomatoes rating to vote_average (no direct RT support in TMDb)
  if (sortBy === 'rt_rating.desc') return 'vote_average.desc';
  if (sortBy === 'rt_rating.asc') return 'vote_average.asc';

  // Return the original value if it's already a valid TMDb sort option
  return sortBy;
}

export async function discoverMovies(filters: DiscoverFilters): Promise<TMDbDiscoverResult> {
  if (!TMDB) return { results: [] };

  const params = new URLSearchParams({
    api_key: TMDB,
    sort_by: mapSortOption(filters.sortBy),
    include_adult: 'false',
    page: String(filters.page || 1),
    watch_region: DEFAULT_DISCOVER_REGION,  // Required for streaming providers
    region: DEFAULT_DISCOVER_REGION
  });

  const yearMin = filters.yearMin ?? DEFAULT_DISCOVER_YEAR_MIN;
  params.set('primary_release_date.gte', `${yearMin}-01-01`);
  if (filters.yearMax) params.set('primary_release_date.lte', `${filters.yearMax}-12-31`);
  if (filters.genres?.length) params.set('with_genres', filters.genres.join('|'));
  if (filters.tmdbRating) params.set('vote_average.gte', filters.tmdbRating.toString());

  // CRITICAL FIX: Pass vote count to TMDb API to avoid fetching low-vote movies
  if (filters.voteCount && filters.voteCount > 0) {
    params.set('vote_count.gte', filters.voteCount.toString());
    log.debug(`🎯 Filtering by vote count >= ${filters.voteCount} at API level`);
  }

  if (Array.isArray(filters.languages) && filters.languages.length) {
    params.set('with_original_language', filters.languages.join('|'));
  } else if (filters.languages === undefined) {
    params.set('with_original_language', DEFAULT_DISCOVER_LANGUAGES.join('|'));
  }
  if (filters.countries?.length) params.set('with_origin_country', filters.countries.join('|'));

  if (filters.runtimeMin && filters.runtimeMin > 0) params.set('with_runtime.gte', filters.runtimeMin.toString());
  if (filters.runtimeMax && filters.runtimeMax > 0) params.set('with_runtime.lte', filters.runtimeMax.toString());
  
  // NEW: Map streaming services to TMDb provider IDs
  if (filters.streamingServices?.length) {
    const providerIds = filters.streamingServices
      .filter(service => service !== 'my-plex-library')  // Exclude Plex
      .map(service => STREAMING_PROVIDER_MAP[service])
      .filter(id => id !== undefined);
    
    if (providerIds.length > 0) {
      params.set('with_watch_providers', providerIds.join('|'));
      log.debug(`🎬 Using TMDb streaming providers: ${providerIds.join(', ')}`);
    }
  }
  
  if (filters.contentRatings?.length) {
    params.set('certification_country', 'US');
    params.set('certification', filters.contentRatings.join('|'));
  }
  
  const url = `https://api.themoviedb.org/3/discover/movie?${params}`;
  
  log.debug('🔍 TMDb API Call:', {
    url,
    params: Object.fromEntries(params.entries())
  });
  
  const data = await j(url);
  
  log.info(`📊 TMDb Results: ${data.total_results} total, ${data.results?.length || 0} on page`);
  if (data.results?.length === 0) {
    log.warning('⚠️ TMDb returned no results for current filters');
  }
  
  return data;
}
