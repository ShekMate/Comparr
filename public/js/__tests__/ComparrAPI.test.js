// Tests for ComparrAPI WebSocket wrapper
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ComparrAPI } from '../ComparrAPI.js'

// Mock location
global.location = {
  protocol: 'http:',
  host: 'localhost:8000',
  pathname: '/comparr/',
}

describe('ComparrAPI', () => {
  let api
  let mockWebSocket

  beforeEach(() => {
    // Clear any existing instances
    if (api) {
      api.socket?.close()
    }

    // Create a new API instance
    api = new ComparrAPI()
    mockWebSocket = api.socket

    // Wait for socket to be ready
    return new Promise(resolve => {
      if (mockWebSocket.readyState === WebSocket.OPEN) {
        resolve()
      } else {
        mockWebSocket.addEventListener('open', resolve, { once: true })
      }
    })
  })

  describe('Constructor', () => {
    it('should create a WebSocket connection', () => {
      expect(api.socket).toBeDefined()
      expect(api.socket.url).toContain('/comparr/ws')
    })

    it('should use wss:// for https connections', () => {
      global.location.protocol = 'https:'
      const httpsApi = new ComparrAPI()
      expect(httpsApi.socket.url).toMatch(/^wss:/)
      global.location.protocol = 'http:' // reset
    })

    it('should initialize empty movie list', () => {
      expect(api._movieList).toEqual([])
    })
  })

  describe('login', () => {
    it('should send login message and resolve on success', async () => {
      const loginPromise = api.login('Alice', 'ROOM123', 'password')

      // Wait for async operations to complete before simulating response
      await new Promise(resolve => setTimeout(resolve, 0))

      // Simulate server response
      mockWebSocket.simulateMessage({
        type: 'loginResponse',
        payload: {
          success: true,
          userName: 'Alice',
          roomCode: 'ROOM123',
          movies: [],
        },
      })

      const result = await loginPromise
      expect(result.success).toBe(true)
      expect(result.userName).toBe('Alice')
    })

    it('should reject on login failure', async () => {
      const loginPromise = api.login('Alice', 'ROOM123', 'wrong-password')

      // Wait for async operations to complete before simulating response
      await new Promise(resolve => setTimeout(resolve, 0))

      // Simulate server response
      mockWebSocket.simulateMessage({
        type: 'loginResponse',
        payload: {
          success: false,
          error: 'Invalid password',
        },
      })

      await expect(loginPromise).rejects.toThrow('Alice is already logged in')
    })

    it('should send correct login payload', async () => {
      api.login('Bob', 'ROOM456', 'secret')

      // Wait for message to be sent
      await new Promise(resolve => setTimeout(resolve, 0))

      // Check sent message
      const sentMessage = JSON.parse(mockWebSocket.sentMessages[0])
      expect(sentMessage.type).toBe('login')
      expect(sentMessage.payload).toEqual({
        name: 'Bob',
        roomCode: 'ROOM456',
        accessPassword: 'secret',
      })
    })
  })

  describe('handleMessage', () => {
    it('should handle batch messages', () => {
      const batchListener = vi.fn()
      api.addEventListener('batch', batchListener)

      const movies = [
        { guid: 'movie1', title: 'Inception' },
        { guid: 'movie2', title: 'Interstellar' },
      ]

      mockWebSocket.simulateMessage({
        type: 'batch',
        payload: movies,
      })

      expect(batchListener).toHaveBeenCalled()
      expect(api._movieList).toEqual(movies)
    })

    it('should handle match messages', () => {
      const matchListener = vi.fn()
      api.addEventListener('match', matchListener)

      mockWebSocket.simulateMessage({
        type: 'match',
        payload: {
          movie: { guid: 'movie1', title: 'Inception' },
          users: ['Alice', 'Bob'],
        },
      })

      expect(matchListener).toHaveBeenCalled()
      const event = matchListener.mock.calls[0][0]
      expect(event.data.users).toEqual(['Alice', 'Bob'])
    })

    it('should handle loginResponse and populate movie list', () => {
      const movies = [
        { guid: 'movie1', title: 'Inception' },
        { guid: 'movie2', title: 'Interstellar' },
      ]

      mockWebSocket.simulateMessage({
        type: 'loginResponse',
        payload: {
          success: true,
          movies,
        },
      })

      expect(api._movieList).toEqual(movies)
    })

    it('should handle error messages', () => {
      const errorListener = vi.fn()
      api.addEventListener('error', errorListener)

      mockWebSocket.simulateMessage({
        type: 'error',
        payload: {
          message: 'Something went wrong',
        },
      })

      expect(errorListener).toHaveBeenCalled()
    })
  })

  describe('respond', () => {
    it('should send response with correct payload', async () => {
      await api.respond({ guid: 'movie1', wantsToWatch: true })

      const sentMessage = JSON.parse(mockWebSocket.sentMessages[0])
      expect(sentMessage.type).toBe('response')
      expect(sentMessage.payload).toEqual({
        guid: 'movie1',
        wantsToWatch: true,
      })
    })

    it('should handle dislike response', async () => {
      await api.respond({ guid: 'movie2', wantsToWatch: false })

      const sentMessage = JSON.parse(mockWebSocket.sentMessages[0])
      expect(sentMessage.payload.wantsToWatch).toBe(false)
    })

    it('should handle seen response (null)', async () => {
      await api.respond({ guid: 'movie3', wantsToWatch: null })

      const sentMessage = JSON.parse(mockWebSocket.sentMessages[0])
      expect(sentMessage.payload.wantsToWatch).toBe(null)
    })
  })

  describe('requestNextBatch', () => {
    it('should send nextBatch message and return batch data', async () => {
      const batchPromise = api.requestNextBatch()

      // Wait for async operations to complete before simulating response
      await new Promise(resolve => setTimeout(resolve, 0))

      // Simulate server response
      const movies = [{ guid: 'movie3', title: 'The Matrix' }]
      mockWebSocket.simulateMessage({
        type: 'batch',
        payload: movies,
      })

      const result = await batchPromise
      expect(result).toEqual(movies)
    })

    it('should send correct message type', async () => {
      api.requestNextBatch()

      // Wait for message to be sent
      await new Promise(resolve => setTimeout(resolve, 0))

      const sentMessage = JSON.parse(mockWebSocket.sentMessages[0])
      expect(sentMessage.type).toBe('nextBatch')
    })
  })

  describe('requestNextBatchWithFilters', () => {
    it('should send filters in nextBatch message', async () => {
      const filters = {
        yearRange: { min: 2000, max: 2020 },
        genres: ['Action', 'Sci-Fi'],
        showPlexOnly: false,
        contentRatings: ['PG-13', 'R'],
        tmdbRating: 7.0,
        languages: ['en'],
        countries: ['US'],
        runtimeRange: { min: 90, max: 180 },
        voteCount: 100,
        sortBy: 'popularity.desc',
      }

      api.requestNextBatchWithFilters(filters)

      // Wait for message to be sent
      await new Promise(resolve => setTimeout(resolve, 0))

      const sentMessage = JSON.parse(mockWebSocket.sentMessages[0])
      expect(sentMessage.type).toBe('nextBatch')
      expect(sentMessage.payload.yearMin).toBe(2000)
      expect(sentMessage.payload.yearMax).toBe(2020)
      expect(sentMessage.payload.genres).toEqual(['Action', 'Sci-Fi'])
      expect(sentMessage.payload.tmdbRating).toBe(7.0)
      expect(sentMessage.payload.runtimeMin).toBe(90)
      expect(sentMessage.payload.runtimeMax).toBe(180)
    })

    it('should return batch data with filters applied', async () => {
      const filters = {
        yearRange: { min: 2010, max: 2015 },
        genres: ['Action'],
        showPlexOnly: false,
        contentRatings: [],
        tmdbRating: 8.0,
        languages: [],
        countries: [],
        runtimeRange: { min: 0, max: 300 },
        voteCount: 1000,
        sortBy: 'vote_average.desc',
      }

      const batchPromise = api.requestNextBatchWithFilters(filters)

      // Wait for async operations to complete before simulating response
      await new Promise(resolve => setTimeout(resolve, 0))

      const movies = [{ guid: 'movie4', title: 'Inception', year: 2010 }]
      mockWebSocket.simulateMessage({
        type: 'batch',
        payload: movies,
      })

      const result = await batchPromise
      expect(result).toEqual(movies)
    })
  })

  describe('getMovie', () => {
    it('should return movie by guid', () => {
      api._movieList = [
        { guid: 'movie1', title: 'Inception' },
        { guid: 'movie2', title: 'Interstellar' },
      ]

      const movie = api.getMovie('movie2')
      expect(movie).toEqual({ guid: 'movie2', title: 'Interstellar' })
    })

    it('should return undefined for non-existent guid', () => {
      api._movieList = [{ guid: 'movie1', title: 'Inception' }]

      const movie = api.getMovie('nonexistent')
      expect(movie).toBeUndefined()
    })
  })

  describe('getUserDecisions', () => {
    it('should fetch user decisions from API', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          rated: [
            { guid: 'movie1', wantsToWatch: true },
            { guid: 'movie2', wantsToWatch: false },
          ],
        }),
      })

      const decisions = await api.getUserDecisions('ROOM123', 'Alice')
      expect(decisions.rated).toHaveLength(2)
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/session-state')
      )
    })

    it('should return empty rated array on 404', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 404,
        ok: false,
      })

      const decisions = await api.getUserDecisions('ROOM123', 'Alice')
      expect(decisions.rated).toEqual([])
    })

    it('should throw on other errors', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 500,
        ok: false,
      })

      await expect(api.getUserDecisions('ROOM123', 'Alice')).rejects.toThrow()
    })
  })

  describe('getMovieSummary', () => {
    it('should return movie summary', async () => {
      api._movieList = [
        {
          guid: 'movie1',
          title: 'Inception',
          year: '2010',
          art: '/art/inception.jpg',
          rating: '8.8',
        },
      ]

      const summary = await api.getMovieSummary('movie1')
      expect(summary).toEqual({
        guid: 'movie1',
        title: 'Inception',
        year: '2010',
        art: '/art/inception.jpg',
      })
    })

    it('should return null for non-existent movie', async () => {
      const summary = await api.getMovieSummary('nonexistent')
      expect(summary).toBeNull()
    })
  })

  describe('WebSocket reconnection', () => {
    it('should reconnect when socket is closed', async () => {
      // Close the socket
      mockWebSocket.close()

      // Try to send a message - should trigger reconnection
      await api.respond({ guid: 'movie1', wantsToWatch: true })

      // Socket should be recreated
      expect(api.socket.readyState).toBe(WebSocket.OPEN)
    })
  })

  describe('Event handling', () => {
    it('should emit events for different message types', () => {
      const events = []

      api.addEventListener('batch', e => events.push({ type: 'batch', data: e.data }))
      api.addEventListener('match', e => events.push({ type: 'match', data: e.data }))
      api.addEventListener('error', e => events.push({ type: 'error', data: e.data }))

      // Send different message types
      mockWebSocket.simulateMessage({
        type: 'batch',
        payload: [{ guid: 'movie1' }],
      })

      mockWebSocket.simulateMessage({
        type: 'match',
        payload: { movie: {}, users: [] },
      })

      mockWebSocket.simulateMessage({
        type: 'error',
        payload: { message: 'Test error' },
      })

      expect(events).toHaveLength(3)
      expect(events[0].type).toBe('batch')
      expect(events[1].type).toBe('match')
      expect(events[2].type).toBe('error')
    })
  })
})
