import { ServerRequest } from 'https://deno.land/std@0.79.0/http/server.ts'
import { assert } from 'https://deno.land/std@0.79.0/_util/assert.ts'
import * as log from 'https://deno.land/std@0.79.0/log/mod.ts'
import {
  getCollectionFilter,
  getDefaultSectionTypeFilter,
  getLibraryFilter,
  getPlexToken,
  getPlexUrl,
} from '../core/config.ts'
import {
  PlexDirectory,
  PlexMediaContainer,
  PlexMediaProviders,
  PlexVideo,
} from './plex.types.ts'

const getPlexConfig = () => {
  const plexUrl = getPlexUrl()
  const plexToken = getPlexToken()

  assert(typeof plexUrl === 'string' && plexUrl !== '', 'A PLEX_URL is required')
  assert(typeof plexToken === 'string' && plexToken !== '', 'A PLEX_TOKEN is required')
  assert(
    !plexToken.startsWith('claim-'),
    'Your PLEX_TOKEN does not look right. Please see: https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/'
  )

  return { plexUrl, plexToken }
}

// thrown when the plex token is invalid
class PlexTokenError extends Error {}

export const getSections = async (): Promise<
  PlexMediaContainer<PlexDirectory>
> => {
  const { plexUrl, plexToken } = getPlexConfig()
  log.debug(`getSections: ${plexUrl}/library/sections`)

  const req = await fetch(
    `${plexUrl}/library/sections?X-Plex-Token=${plexToken}`,
    {
      headers: { accept: 'application/json' },
    }
  )

  if (req.ok) {
    return await req.json()
  } else if (req.status === 401) {
    throw new PlexTokenError(`Authentication error: ${req.url}`)
  } else {
    throw new Error(await req.text())
  }
}

const getSelectedLibraryTitles = (
  sections: PlexMediaContainer<PlexDirectory>
) => {
  const availableLibraryNames = sections.MediaContainer.Directory.map(
    _ => _.title
  )
  log.debug(`Available libraries: ${availableLibraryNames.join(', ')}`)

  const defaultLibraryName = sections.MediaContainer.Directory.find(
    ({ hidden, type }) => hidden !== 1 && type === getDefaultSectionTypeFilter()
  )?.title

  const libraryTitles =
    (getLibraryFilter() === '' ? defaultLibraryName : getLibraryFilter())
      ?.split(',')
      .filter(title => availableLibraryNames.includes(title)) ?? []

  assert(
    libraryTitles.length !== 0,
    `${getLibraryFilter()} did not match any available library names: ${availableLibraryNames.join(
      ', '
    )}`
  )

  return libraryTitles
}

const loadAllMovies = async () => {
  const sections = await getSections()

  const selectedLibraryTitles = getSelectedLibraryTitles(sections)

  log.debug(`selected library titles - ${selectedLibraryTitles.join(', ')}`)

  const movieSections = sections.MediaContainer.Directory.filter(
    ({ title, hidden }) => hidden !== 1 && selectedLibraryTitles.includes(title)
  )

  assert(movieSections.length !== 0, `Couldn't find a movies section in Plex!`)

  const movies: PlexVideo['Metadata'] = []

  for (const movieSection of movieSections) {
    const { plexUrl, plexToken } = getPlexConfig()
    log.debug(`Loading movies from ${movieSection.title} library`)

    const req = await fetch(
      `${plexUrl}/library/sections/${movieSection.key}/all?X-Plex-Token=${plexToken}`,
      {
        headers: { accept: 'application/json' },
      }
    )

    log.debug(`Loaded ${req.url}: ${req.status} ${req.statusText}`)

    assert(req.ok, `Error loading ${movieSection.title} library`)

    if (!req.ok) {
      if (req.status === 401) {
        throw new PlexTokenError(`Authentication error: ${req.url}`)
      } else {
        throw new Error(
          `${req.url} returned ${req.status}: ${await req.text()}`
        )
      }
    }

    const libraryData: PlexMediaContainer<PlexVideo> = await req.json()
    let metadata = libraryData.MediaContainer.Metadata

    if (getCollectionFilter() !== '') {
      const collectionFilter = getCollectionFilter().split(',')
      metadata = metadata.filter(metadataItem => {
        return metadataItem.Collection?.find(collection =>
          collectionFilter.find(
            filter => filter.toLowerCase() === collection.tag.toLowerCase()
          )
        )
      })
    }

    if (!metadata) {
      log.info(
        `${libraryData.MediaContainer.librarySectionTitle} does not have any items. Skipping.`
      )
      log.debug(JSON.stringify(libraryData, null, 2))
      continue
    }

    assert(
      metadata?.length,
      `${movieSection.title} doesn't appear to have any movies`
    )

    log.debug(`Loaded ${metadata?.length} items from ${movieSection.title}`)

    movies.push(...metadata)
  }

  return movies
}

let allMoviesPromise: Promise<PlexVideo['Metadata']> | null = null

export const getAllMovies = async (): Promise<PlexVideo['Metadata']> => {
  if (!allMoviesPromise) {
    allMoviesPromise = loadAllMovies()
  }
  return allMoviesPromise
}

export const clearAllMoviesCache = () => {
  allMoviesPromise = null
}

export class NoMoreMoviesError extends Error {}

// Genre ID to name mapping (TMDb genre IDs) - same as in session.ts
const GENRE_MAP: Record<number, string> = {
  28: 'Action',
  12: 'Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  14: 'Fantasy',
  36: 'History',
  27: 'Horror',
  10402: 'Music',
  9648: 'Mystery',
  10749: 'Romance',
  878: 'Science Fiction',
  10770: 'TV Movie',
  53: 'Thriller',
  10752: 'War',
  37: 'Western'
};

function genreIdsToNames(genreIds: (number | string)[]): string[] {
  return genreIds.map(id => {
    if (typeof id === 'string') return id;
    return GENRE_MAP[id] || String(id);
  });
}

export const getRandomMovie = (() => {
  const drawnGuids: Set<string> = new Set()

  const getRandom = (
    movies: PlexVideo['Metadata']
  ): PlexVideo['Metadata'][number] => {
    assert(movies.length !== 0, 'allMovies was empty')
    if (drawnGuids.size === movies.length) {
      throw new NoMoreMoviesError()
    }

    const randomIndex = Math.floor(Math.random() * movies.length)
    const movie = movies[randomIndex]

    assert(
      !!movie,
      `Failed to pick a movie. There are ${movies.length} movies and the random index is ${randomIndex}`
    )

    if (drawnGuids.has(movie.guid)) {
      return getRandom(movies)
    } else {
      drawnGuids.add(movie.guid)
      return movie
    }
  }

  return async () => getRandom(await getAllMovies())
})()

// New function to get a random movie with filters applied
export const getFilteredRandomMovie = (() => {
  const drawnGuids: Set<string> = new Set()

  const getRandom = (
    movies: PlexVideo['Metadata'],
    filters?: {
      yearMin?: number;
      yearMax?: number;
      genres?: string[];
    }
  ): PlexVideo['Metadata'][number] => {
    // First, filter the movie list based on criteria we can check without enrichment
    let filteredMovies = movies;

    // Apply year filter
    if (filters?.yearMin || filters?.yearMax) {
      filteredMovies = filteredMovies.filter(movie => {
        const movieYear = typeof movie.year === 'number' ? movie.year : Number(movie.year);
        if (filters.yearMin && movieYear < filters.yearMin) return false;
        if (filters.yearMax && movieYear > filters.yearMax) return false;
        return true;
      });
    }

    // Apply genre filter using Plex's Genre tags
    if (filters?.genres && filters.genres.length > 0) {
      const filterGenreNames = genreIdsToNames(filters.genres).map(g => g.toLowerCase());
      filteredMovies = filteredMovies.filter(movie => {
        if (!movie.Genre || movie.Genre.length === 0) return false;
        const movieGenres = movie.Genre.map(g => g.tag.toLowerCase());
        return filterGenreNames.some(filterGenre => movieGenres.includes(filterGenre));
      });
    }

    assert(filteredMovies.length !== 0, `No movies match the current filters in your Plex library`)
    
    if (drawnGuids.size === filteredMovies.length) {
      log.info(`All ${filteredMovies.length} matching Plex movies have been shown`);
      throw new NoMoreMoviesError()
    }

    // Pick a random movie from the filtered list that hasn't been drawn yet
    let attempts = 0;
    const maxAttempts = filteredMovies.length * 2; // Reasonable limit
    
    while (attempts < maxAttempts) {
      const randomIndex = Math.floor(Math.random() * filteredMovies.length)
      const movie = filteredMovies[randomIndex]

      assert(
        !!movie,
        `Failed to pick a movie. There are ${filteredMovies.length} filtered movies and the random index is ${randomIndex}`
      )

      if (!drawnGuids.has(movie.guid)) {
        drawnGuids.add(movie.guid)
        log.debug(`✅ Selected movie ${movie.title} from ${filteredMovies.length} filtered Plex movies`)
        return movie
      }
      
      attempts++;
    }
    
    // If we get here, all filtered movies have been drawn
    throw new NoMoreMoviesError()
  }

  return async (filters?: {
    yearMin?: number;
    yearMax?: number;
    genres?: string[];
  }) => getRandom(await getAllMovies(), filters)
})()

export const getServerId = (() => {
  let serverId: string

  return async () => {
    if (serverId) return serverId
    const { plexUrl, plexToken } = getPlexConfig()

    const req = await fetch(
      `${plexUrl}/media/providers?X-Plex-Token=${plexToken}`,
      {
        headers: { accept: 'application/json' },
      }
    )

    if (!req.ok) {
      if (req.status === 401) {
        throw new PlexTokenError(`Authentication error: ${req.url}`)
      } else {
        throw new Error(
          `${req.url} returned ${req.status}: ${await req.text()}`
        )
      }
    }

    const providers: PlexMediaProviders = await req.json()
    serverId = providers.MediaContainer.machineIdentifier
    return serverId
  }
})()

export const proxyPoster = async (req: ServerRequest, key: string) => {
  const [, search] = req.url.split('?')
  const searchParams = new URLSearchParams(search)

  const width = searchParams.has('w') ? Number(searchParams.get('w')) : 500

  if (Number.isNaN(width)) {
    return req.respond({ status: 404 })
  }

  const height = width * 1.5

  const posterUrl = encodeURIComponent(`/library/metadata/${key}`)
  const { plexUrl, plexToken } = getPlexConfig()
  const url = `${plexUrl}/photo/:/transcode?X-Plex-Token=${plexToken}&width=${width}&height=${height}&minSize=1&upscale=1&url=${posterUrl}`
  try {
    const posterReq = await fetch(url)

    if (!posterReq.ok) {
      if (posterReq.status === 401) {
        throw new PlexTokenError(`Authentication error: ${posterReq.url}`)
      } else {
        throw new Error(
          `${posterReq.url} returned ${
            posterReq.status
          }: ${await posterReq.text()}`
        )
      }
    }

    const imageData = new Uint8Array(await posterReq.arrayBuffer())
    
    // Cache the downloaded poster
    const { cachePoster } = await import('../services/cache/poster-cache.ts')
    cachePoster(key, 'plex', url).catch(err => 
      log.error(`Failed to cache Plex poster: ${err}`)
    )

    await req.respond({
      status: 200,
      body: imageData,
      headers: new Headers({
        'content-type': 'image/jpeg',
        'cache-control': 'public, max-age=604800, immutable', // Cache for 7 days
      }),
    })
  } catch (err) {
    log.error(`Failed to load ${url}. ${err}`)
  }
}

/**
 * Check if a movie exists in the Plex library by title and year
 * This now uses the fast cache instead of scanning the entire library
 */
export async function isMovieInPlex(title: string, year?: number | null): Promise<boolean> {
  try {
    const { isMovieInPlex: cachedCheck } = await import('../integrations/plex/cache.ts')
    return cachedCheck({ title, year })
  } catch (err) {
    log.error(`Failed to check if movie is in Plex: ${err}`)
    return false
  }
}
