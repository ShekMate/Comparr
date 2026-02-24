// Tests for Plex API integration
import {
  assertEquals,
  assertExists,
  assertRejects,
  createMockFetch,
  createMockResponse,
  mockEnv,
} from '../../__tests__/utils/test-helpers.ts'
import {
  mockPlexSections,
  mockPlexMovies,
} from '../../__tests__/mocks/plex-mocks.ts'

// Mock the global fetch before importing the module
const originalFetch = globalThis.fetch
let mockFetch: typeof fetch

// Setup environment variables for tests
const cleanup = mockEnv({
  PLEX_URL: 'http://localhost:32400',
  PLEX_TOKEN: 'test-token-123',
  LIBRARY_FILTER: '',
  COLLECTION_FILTER: '',
})

Deno.test({
  name: 'Plex API - getSections - successful response',
  async fn() {
    // Setup mock fetch
    globalThis.fetch = createMockFetch(
      new Map([['library/sections', { status: 200, body: mockPlexSections }]])
    )

    // Dynamically import to get fresh module with mocked env
    const { getSections } = await import('../plex.ts')
    const sections = await getSections()

    assertEquals(sections.MediaContainer.size, 3)
    assertEquals(sections.MediaContainer.Directory.length, 3)
    assertEquals(sections.MediaContainer.Directory[0].title, 'Movies')

    // Cleanup
    globalThis.fetch = originalFetch
  },
  sanitizeResources: false,
  sanitizeOps: false,
})

Deno.test({
  name: 'Plex API - getSections - 401 authentication error',
  async fn() {
    globalThis.fetch = createMockFetch(
      new Map([['library/sections', { status: 401, body: 'Unauthorized' }]])
    )

    const { getSections } = await import('../plex.ts')

    await assertRejects(
      async () => await getSections(),
      Error,
      'Authentication error'
    )

    globalThis.fetch = originalFetch
  },
  sanitizeResources: false,
  sanitizeOps: false,
})

Deno.test({
  name: 'Plex API - getSections - 500 server error',
  async fn() {
    globalThis.fetch = createMockFetch(
      new Map([
        ['library/sections', { status: 500, body: 'Internal Server Error' }],
      ])
    )

    const { getSections } = await import('../plex.ts')

    await assertRejects(async () => await getSections(), Error)

    globalThis.fetch = originalFetch
  },
  sanitizeResources: false,
  sanitizeOps: false,
})

Deno.test({
  name: 'Plex API - getAllMovies - loads movies from selected library',
  async fn() {
    // Create a comprehensive mock that handles both requests
    globalThis.fetch = async (url: string | URL | Request) => {
      const urlString = typeof url === 'string' ? url : url.toString()

      if (
        urlString.includes('library/sections') &&
        !urlString.includes('/all')
      ) {
        return createMockResponse({ status: 200, body: mockPlexSections })
      }

      if (urlString.includes('/all')) {
        return createMockResponse({ status: 200, body: mockPlexMovies })
      }

      return createMockResponse({ status: 404, body: 'Not Found' })
    }

    // Clear module cache and reimport
    const { getAllMovies } = await import('../plex.ts')
    const movies = await getAllMovies()

    assertExists(movies)
    assertEquals(movies.length, 3)
    assertEquals(movies[0].title, 'Inception')
    assertEquals(movies[1].title, 'Interstellar')
    assertEquals(movies[2].title, 'The Matrix')

    globalThis.fetch = originalFetch
  },
  sanitizeResources: false,
  sanitizeOps: false,
})

Deno.test({
  name: 'Plex API - getRandomMovie - returns unique movies',
  async fn() {
    // Setup mock
    globalThis.fetch = async (url: string | URL | Request) => {
      const urlString = typeof url === 'string' ? url : url.toString()

      if (
        urlString.includes('library/sections') &&
        !urlString.includes('/all')
      ) {
        return createMockResponse({ status: 200, body: mockPlexSections })
      }

      if (urlString.includes('/all')) {
        return createMockResponse({ status: 200, body: mockPlexMovies })
      }

      return createMockResponse({ status: 404, body: 'Not Found' })
    }

    const { getRandomMovie, getAllMovies, NoMoreMoviesError } = await import(
      '../plex.ts'
    )
    const movies = await getAllMovies()

    // Get random movies - should not repeat
    const drawnMovies = new Set()
    const movie1 = await getRandomMovie(movies)
    drawnMovies.add(movie1.guid)
    assertExists(movie1)

    const movie2 = await getRandomMovie(movies)
    drawnMovies.add(movie2.guid)
    assertExists(movie2)

    const movie3 = await getRandomMovie(movies)
    drawnMovies.add(movie3.guid)
    assertExists(movie3)

    // All three movies should be different
    assertEquals(drawnMovies.size, 3)

    // Fourth call should throw NoMoreMoviesError since we only have 3 movies
    await assertRejects(
      async () => await getRandomMovie(movies),
      NoMoreMoviesError
    )

    globalThis.fetch = originalFetch
  },
  sanitizeResources: false,
  sanitizeOps: false,
})

Deno.test({
  name: 'Plex API - library filtering by name',
  async fn() {
    // Set library filter to only include "Animation"
    const cleanupFilter = mockEnv({
      PLEX_URL: 'http://localhost:32400',
      PLEX_TOKEN: 'test-token-123',
      LIBRARY_FILTER: 'Animation',
      COLLECTION_FILTER: '',
    })

    globalThis.fetch = async (url: string | URL | Request) => {
      const urlString = typeof url === 'string' ? url : url.toString()

      if (
        urlString.includes('library/sections') &&
        !urlString.includes('/all')
      ) {
        return createMockResponse({ status: 200, body: mockPlexSections })
      }

      // Only return movies for Animation library (key = '3')
      if (urlString.includes('/sections/3/all')) {
        return createMockResponse({ status: 200, body: mockPlexMovies })
      }

      return createMockResponse({ status: 404, body: 'Not Found' })
    }

    const { getAllMovies } = await import('../plex.ts')
    const movies = await getAllMovies()

    assertExists(movies)
    // Should only load from Animation library
    assertEquals(movies.length, 3)

    cleanupFilter()
    globalThis.fetch = originalFetch
  },
  sanitizeResources: false,
  sanitizeOps: false,
})

Deno.test({
  name: 'Plex API - handles network timeout gracefully',
  async fn() {
    globalThis.fetch = async () => {
      await new Promise(resolve => setTimeout(resolve, 100))
      throw new Error('Network timeout')
    }

    const { getSections } = await import('../plex.ts')

    await assertRejects(
      async () => await getSections(),
      Error,
      'Network timeout'
    )

    globalThis.fetch = originalFetch
  },
  sanitizeResources: false,
  sanitizeOps: false,
})

// Cleanup environment after all tests
cleanup()
