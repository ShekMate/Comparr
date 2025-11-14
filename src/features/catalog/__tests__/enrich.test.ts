// Tests for movie enrichment pipeline
import { assertEquals, assertExists, mockEnv } from '../../../__tests__/utils/test-helpers.ts'
import { mockOMDbMovie, mockOMDbNotFound } from '../../../__tests__/mocks/omdb-mocks.ts'
import { mockTMDbMovieDetails, mockTMDbSearchResults } from '../../../__tests__/mocks/tmdb-mocks.ts'

// Setup environment variables for tests
const cleanup = mockEnv({
  OMDB_API_KEY: 'test-omdb-key',
  TMDB_API_KEY: 'test-tmdb-key',
  PLEX_LIBRARY_NAME: 'Plex',
})

const originalFetch = globalThis.fetch

Deno.test({
  name: 'Enrich - successfully enriches movie with OMDb and TMDb data',
  async fn() {
    globalThis.fetch = async (url: string | URL | Request) => {
      const urlString = typeof url === 'string' ? url : url.toString()

      // Mock OMDb API
      if (urlString.includes('omdbapi.com')) {
        return new Response(JSON.stringify(mockOMDbMovie), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // Mock TMDb search API
      if (urlString.includes('themoviedb.org/3/search/movie')) {
        return new Response(JSON.stringify(mockTMDbSearchResults), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // Mock TMDb movie details API
      if (urlString.includes('themoviedb.org/3/movie/')) {
        return new Response(JSON.stringify(mockTMDbMovieDetails), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return new Response('Not Found', { status: 404 })
    }

    const { enrich } = await import('../enrich.ts')

    const result = await enrich({
      title: 'Inception',
      year: 2010,
      imdbId: 'tt1375666',
    })

    assertExists(result)
    assertEquals(result.imdbId, 'tt1375666')
    assertEquals(result.rating_imdb, 8.8)
    assertEquals(result.rating_rt, 87)
    assertExists(result.rating_tmdb)
    assertExists(result.plot)
    assertEquals(result.plot, mockOMDbMovie.Plot)

    globalThis.fetch = originalFetch
  },
  sanitizeResources: false,
  sanitizeOps: false,
})

Deno.test({
  name: 'Enrich - falls back to TMDb when OMDb fails',
  async fn() {
    globalThis.fetch = async (url: string | URL | Request) => {
      const urlString = typeof url === 'string' ? url : url.toString()

      // Mock OMDb API - return not found
      if (urlString.includes('omdbapi.com')) {
        return new Response(JSON.stringify(mockOMDbNotFound), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // Mock TMDb search API
      if (urlString.includes('themoviedb.org/3/search/movie')) {
        return new Response(JSON.stringify(mockTMDbSearchResults), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // Mock TMDb movie details API
      if (urlString.includes('themoviedb.org/3/movie/')) {
        return new Response(JSON.stringify(mockTMDbMovieDetails), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return new Response('Not Found', { status: 404 })
    }

    const { enrich } = await import('../enrich.ts')

    const result = await enrich({
      title: 'Inception',
      year: 2010,
    })

    assertExists(result)
    // Should have TMDb data
    assertExists(result.rating_tmdb)
    assertEquals(result.rating_tmdb, 8.4) // rounded from 8.367
    assertExists(result.plot)
    // Should have extracted genres from TMDb
    assertExists(result.genres)
    assertEquals(result.genres.length, 3)

    globalThis.fetch = originalFetch
  },
  sanitizeResources: false,
  sanitizeOps: false,
})

Deno.test({
  name: 'Enrich - handles OMDb by title when no IMDb ID provided',
  async fn() {
    globalThis.fetch = async (url: string | URL | Request) => {
      const urlString = typeof url === 'string' ? url : url.toString()

      // Mock OMDb API - title search
      if (urlString.includes('omdbapi.com') && urlString.includes('&t=')) {
        return new Response(JSON.stringify(mockOMDbMovie), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // Mock TMDb search API
      if (urlString.includes('themoviedb.org/3/search/movie')) {
        return new Response(JSON.stringify(mockTMDbSearchResults), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // Mock TMDb movie details API
      if (urlString.includes('themoviedb.org/3/movie/')) {
        return new Response(JSON.stringify(mockTMDbMovieDetails), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return new Response('Not Found', { status: 404 })
    }

    const { enrich } = await import('../enrich.ts')

    const result = await enrich({
      title: 'Inception',
      year: 2010,
    })

    assertExists(result)
    assertEquals(result.imdbId, 'tt1375666')
    assertExists(result.plot)

    globalThis.fetch = originalFetch
  },
  sanitizeResources: false,
  sanitizeOps: false,
})

Deno.test({
  name: 'Enrich - extracts Rotten Tomatoes rating from OMDb',
  async fn() {
    globalThis.fetch = async (url: string | URL | Request) => {
      const urlString = typeof url === 'string' ? url : url.toString()

      if (urlString.includes('omdbapi.com')) {
        return new Response(JSON.stringify(mockOMDbMovie), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (urlString.includes('themoviedb.org/3/search/movie')) {
        return new Response(JSON.stringify(mockTMDbSearchResults), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (urlString.includes('themoviedb.org/3/movie/')) {
        return new Response(JSON.stringify(mockTMDbMovieDetails), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return new Response('Not Found', { status: 404 })
    }

    const { enrich } = await import('../enrich.ts')

    const result = await enrich({
      title: 'Inception',
      year: 2010,
      imdbId: 'tt1375666',
    })

    assertExists(result)
    // Should extract RT rating from OMDb ratings array
    assertEquals(result.rating_rt, 87)

    globalThis.fetch = originalFetch
  },
  sanitizeResources: false,
  sanitizeOps: false,
})

Deno.test({
  name: 'Enrich - extracts genres from TMDb',
  async fn() {
    globalThis.fetch = async (url: string | URL | Request) => {
      const urlString = typeof url === 'string' ? url : url.toString()

      if (urlString.includes('omdbapi.com')) {
        return new Response(JSON.stringify(mockOMDbNotFound), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (urlString.includes('themoviedb.org/3/search/movie')) {
        return new Response(JSON.stringify(mockTMDbSearchResults), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (urlString.includes('themoviedb.org/3/movie/')) {
        return new Response(JSON.stringify(mockTMDbMovieDetails), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return new Response('Not Found', { status: 404 })
    }

    const { enrich } = await import('../enrich.ts')

    const result = await enrich({
      title: 'Inception',
      year: 2010,
    })

    assertExists(result)
    assertExists(result.genres)
    assertEquals(result.genres.length, 3)
    assertEquals(result.genres, ['Action', 'Science Fiction', 'Thriller'])

    globalThis.fetch = originalFetch
  },
  sanitizeResources: false,
  sanitizeOps: false,
})

Deno.test({
  name: 'Enrich - handles API errors gracefully',
  async fn() {
    let omdbCallCount = 0
    let tmdbCallCount = 0

    globalThis.fetch = async (url: string | URL | Request) => {
      const urlString = typeof url === 'string' ? url : url.toString()

      if (urlString.includes('omdbapi.com')) {
        omdbCallCount++
        throw new Error('Network error')
      }

      if (urlString.includes('themoviedb.org/3/search/movie')) {
        tmdbCallCount++
        return new Response(JSON.stringify(mockTMDbSearchResults), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (urlString.includes('themoviedb.org/3/movie/')) {
        return new Response(JSON.stringify(mockTMDbMovieDetails), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return new Response('Not Found', { status: 404 })
    }

    const { enrich } = await import('../enrich.ts')

    // Should not throw even if OMDb fails
    const result = await enrich({
      title: 'Inception',
      year: 2010,
      imdbId: 'tt1375666',
    })

    assertExists(result)
    // Should have TMDb data as fallback
    assertExists(result.rating_tmdb)
    assertEquals(tmdbCallCount >= 1, true)

    globalThis.fetch = originalFetch
  },
  sanitizeResources: false,
  sanitizeOps: false,
})

Deno.test({
  name: 'Enrich - extracts streaming services from TMDb',
  async fn() {
    globalThis.fetch = async (url: string | URL | Request) => {
      const urlString = typeof url === 'string' ? url : url.toString()

      if (urlString.includes('omdbapi.com')) {
        return new Response(JSON.stringify(mockOMDbNotFound), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (urlString.includes('themoviedb.org/3/search/movie')) {
        return new Response(JSON.stringify(mockTMDbSearchResults), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (urlString.includes('themoviedb.org/3/movie/')) {
        return new Response(JSON.stringify(mockTMDbMovieDetails), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return new Response('Not Found', { status: 404 })
    }

    const { enrich } = await import('../enrich.ts')

    const result = await enrich({
      title: 'Inception',
      year: 2010,
    })

    assertExists(result)
    assertExists(result.streamingServices)
    assertExists(result.streamingServices.subscription)
    assertExists(result.streamingServices.free)
    // Should have Netflix in subscription
    assertEquals(result.streamingServices.subscription.length >= 1, true)

    globalThis.fetch = originalFetch
  },
  sanitizeResources: false,
  sanitizeOps: false,
})

Deno.test({
  name: 'Enrich - returns null values when all APIs fail',
  async fn() {
    globalThis.fetch = async () => {
      throw new Error('Network error')
    }

    const { enrich } = await import('../enrich.ts')

    const result = await enrich({
      title: 'NonexistentMovie',
      year: 2025,
    })

    assertExists(result)
    // Should return object with null values
    assertEquals(result.plot, null)
    assertEquals(result.rating_imdb, null)
    assertEquals(result.rating_tmdb, null)
    assertEquals(result.rating_rt, null)

    globalThis.fetch = originalFetch
  },
  sanitizeResources: false,
  sanitizeOps: false,
})

// Cleanup environment after all tests
cleanup()
