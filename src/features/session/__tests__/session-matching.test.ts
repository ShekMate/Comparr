// Tests for session matching logic
import { assertEquals, assertExists, MockWebSocket, waitFor } from '../../../__tests__/utils/test-helpers.ts'

// Mock movie data for testing
const mockMovie1 = {
  guid: 'plex://movie/1',
  title: 'Inception',
  summary: 'A thief who steals corporate secrets...',
  year: '2010',
  art: '/art/inception.jpg',
  rating: '8.8',
  key: '/library/metadata/1',
  type: 'movie' as const,
  tmdbId: 27205,
}

const mockMovie2 = {
  guid: 'plex://movie/2',
  title: 'Interstellar',
  summary: 'A team of explorers travel through a wormhole...',
  year: '2014',
  art: '/art/interstellar.jpg',
  rating: '8.6',
  key: '/library/metadata/2',
  type: 'movie' as const,
  tmdbId: 157336,
}

const mockMovie3 = {
  guid: 'plex://movie/3',
  title: 'The Matrix',
  summary: 'A computer hacker learns about reality...',
  year: '1999',
  art: '/art/matrix.jpg',
  rating: '8.7',
  key: '/library/metadata/3',
  type: 'movie' as const,
  tmdbId: 603,
}

interface User {
  name: string
  responses: Array<{
    guid: string
    wantsToWatch: boolean | null
    tmdbId?: number | null
  }>
}

interface LikedMovies extends Map<any, User[]> {}

/**
 * Simulates the core matching logic from session.ts
 * This tests the algorithm without requiring the full Session class
 */
class MatchingSimulator {
  likedMovies: LikedMovies = new Map()
  matches: Array<{ movie: any; users: string[] }> = []
  websockets: Map<User, MockWebSocket> = new Map()

  addUser(user: User): MockWebSocket {
    const ws = new MockWebSocket()
    this.websockets.set(user, ws)
    return ws
  }

  handleResponse(user: User, movie: any, wantsToWatch: boolean | null) {
    const existingUsers = this.likedMovies.get(movie) || []

    if (wantsToWatch === true) {
      // User likes this movie - add them if not already in the list
      if (!existingUsers.includes(user)) {
        const nextUsers = [...existingUsers, user]
        this.likedMovies.set(movie, nextUsers)

        // If multiple users like it, broadcast a match
        if (nextUsers.length > 1) {
          this.handleMatch(movie, nextUsers)
        }
      }
    } else {
      // User doesn't like this movie (pass or seen) - remove them if they were in the list
      if (existingUsers.includes(user)) {
        const nextUsers = existingUsers.filter(u => u !== user)
        if (nextUsers.length > 0) {
          this.likedMovies.set(movie, nextUsers)
        } else {
          this.likedMovies.delete(movie)
        }
      }
    }
  }

  handleMatch(movie: any, users: User[]) {
    const matchData = {
      movie,
      users: users.map(u => u.name),
    }

    // Add to matches array if not already there
    const existingMatch = this.matches.find(m => m.movie === movie)
    if (!existingMatch) {
      this.matches.push(matchData)
    }

    // Broadcast to all websockets
    for (const ws of this.websockets.values()) {
      ws.send(
        JSON.stringify({
          type: 'match',
          payload: matchData,
        })
      )
    }
  }

  getExistingMatches(user: User) {
    return [...this.likedMovies.entries()]
      .filter(([, users]) => users.includes(user) && users.length > 1)
      .map(([movie, users]) => ({ movie, users: users.map(u => u.name) }))
  }
}

Deno.test({
  name: 'Session Matching - two users match on same movie',
  fn() {
    const simulator = new MatchingSimulator()

    const user1: User = { name: 'Alice', responses: [] }
    const user2: User = { name: 'Bob', responses: [] }

    const ws1 = simulator.addUser(user1)
    const ws2 = simulator.addUser(user2)

    // User1 likes Inception
    simulator.handleResponse(user1, mockMovie1, true)
    assertEquals(simulator.matches.length, 0) // No match yet

    // User2 also likes Inception - should create a match!
    simulator.handleResponse(user2, mockMovie1, true)
    assertEquals(simulator.matches.length, 1)
    assertEquals(simulator.matches[0].movie, mockMovie1)
    assertEquals(simulator.matches[0].users, ['Alice', 'Bob'])

    // Both websockets should have received the match message
    assertEquals(ws1.sentMessages.length, 1)
    assertEquals(ws2.sentMessages.length, 1)
    assertEquals(ws1.sentMessages[0].type, 'match')
    assertEquals(ws1.sentMessages[0].payload.users, ['Alice', 'Bob'])
  },
})

Deno.test({
  name: 'Session Matching - three users all match on same movie',
  fn() {
    const simulator = new MatchingSimulator()

    const user1: User = { name: 'Alice', responses: [] }
    const user2: User = { name: 'Bob', responses: [] }
    const user3: User = { name: 'Charlie', responses: [] }

    const ws1 = simulator.addUser(user1)
    const ws2 = simulator.addUser(user2)
    const ws3 = simulator.addUser(user3)

    // All three users like Inception
    simulator.handleResponse(user1, mockMovie1, true)
    simulator.handleResponse(user2, mockMovie1, true)
    assertEquals(simulator.matches.length, 1)

    simulator.handleResponse(user3, mockMovie1, true)
    // Should still be 1 match but with 3 users
    const likedUsers = simulator.likedMovies.get(mockMovie1)
    assertExists(likedUsers)
    assertEquals(likedUsers.length, 3)
    assertEquals(likedUsers.map(u => u.name), ['Alice', 'Bob', 'Charlie'])
  },
})

Deno.test({
  name: 'Session Matching - users match on multiple different movies',
  fn() {
    const simulator = new MatchingSimulator()

    const user1: User = { name: 'Alice', responses: [] }
    const user2: User = { name: 'Bob', responses: [] }

    simulator.addUser(user1)
    simulator.addUser(user2)

    // Both like Inception
    simulator.handleResponse(user1, mockMovie1, true)
    simulator.handleResponse(user2, mockMovie1, true)
    assertEquals(simulator.matches.length, 1)

    // Both also like Interstellar
    simulator.handleResponse(user1, mockMovie2, true)
    simulator.handleResponse(user2, mockMovie2, true)
    assertEquals(simulator.matches.length, 2)

    // Verify both matches exist
    const matches = simulator.matches
    assertEquals(matches[0].movie, mockMovie1)
    assertEquals(matches[1].movie, mockMovie2)
  },
})

Deno.test({
  name: 'Session Matching - user passes on movie (wantsToWatch = false)',
  fn() {
    const simulator = new MatchingSimulator()

    const user1: User = { name: 'Alice', responses: [] }
    const user2: User = { name: 'Bob', responses: [] }

    simulator.addUser(user1)
    simulator.addUser(user2)

    // User1 likes Inception
    simulator.handleResponse(user1, mockMovie1, true)

    // User2 passes on Inception
    simulator.handleResponse(user2, mockMovie1, false)

    // Should be no match
    assertEquals(simulator.matches.length, 0)
    const likedUsers = simulator.likedMovies.get(mockMovie1)
    assertExists(likedUsers)
    assertEquals(likedUsers.length, 1) // Only Alice
  },
})

Deno.test({
  name: 'Session Matching - user marks movie as seen (wantsToWatch = null)',
  fn() {
    const simulator = new MatchingSimulator()

    const user1: User = { name: 'Alice', responses: [] }
    const user2: User = { name: 'Bob', responses: [] }

    simulator.addUser(user1)
    simulator.addUser(user2)

    // User1 likes Inception
    simulator.handleResponse(user1, mockMovie1, true)

    // User2 marks as seen (null)
    simulator.handleResponse(user2, mockMovie1, null)

    // Should be no match
    assertEquals(simulator.matches.length, 0)
    const likedUsers = simulator.likedMovies.get(mockMovie1)
    assertExists(likedUsers)
    assertEquals(likedUsers.length, 1) // Only Alice
  },
})

Deno.test({
  name: 'Session Matching - user changes mind after initially liking',
  fn() {
    const simulator = new MatchingSimulator()

    const user1: User = { name: 'Alice', responses: [] }
    const user2: User = { name: 'Bob', responses: [] }

    const ws1 = simulator.addUser(user1)
    const ws2 = simulator.addUser(user2)

    // Both initially like Inception - creates a match
    simulator.handleResponse(user1, mockMovie1, true)
    simulator.handleResponse(user2, mockMovie1, true)
    assertEquals(simulator.matches.length, 1)

    // User2 changes mind and dislikes it
    simulator.handleResponse(user2, mockMovie1, false)

    // Match still exists in history, but likedMovies should only have Alice
    const likedUsers = simulator.likedMovies.get(mockMovie1)
    assertExists(likedUsers)
    assertEquals(likedUsers.length, 1)
    assertEquals(likedUsers[0].name, 'Alice')
  },
})

Deno.test({
  name: 'Session Matching - getExistingMatches returns only matches involving the user',
  fn() {
    const simulator = new MatchingSimulator()

    const user1: User = { name: 'Alice', responses: [] }
    const user2: User = { name: 'Bob', responses: [] }
    const user3: User = { name: 'Charlie', responses: [] }

    simulator.addUser(user1)
    simulator.addUser(user2)
    simulator.addUser(user3)

    // Alice and Bob match on Inception
    simulator.handleResponse(user1, mockMovie1, true)
    simulator.handleResponse(user2, mockMovie1, true)

    // Bob and Charlie match on Interstellar (not Alice)
    simulator.handleResponse(user2, mockMovie2, true)
    simulator.handleResponse(user3, mockMovie2, true)

    // Alice's matches should only include Inception
    const aliceMatches = simulator.getExistingMatches(user1)
    assertEquals(aliceMatches.length, 1)
    assertEquals(aliceMatches[0].movie, mockMovie1)

    // Bob's matches should include both movies
    const bobMatches = simulator.getExistingMatches(user2)
    assertEquals(bobMatches.length, 2)

    // Charlie's matches should only include Interstellar
    const charlieMatches = simulator.getExistingMatches(user3)
    assertEquals(charlieMatches.length, 1)
    assertEquals(charlieMatches[0].movie, mockMovie2)
  },
})

Deno.test({
  name: 'Session Matching - no duplicate users in match',
  fn() {
    const simulator = new MatchingSimulator()

    const user1: User = { name: 'Alice', responses: [] }
    const user2: User = { name: 'Bob', responses: [] }

    simulator.addUser(user1)
    simulator.addUser(user2)

    // User1 likes movie multiple times (shouldn't happen in practice, but test defensive code)
    simulator.handleResponse(user1, mockMovie1, true)
    simulator.handleResponse(user1, mockMovie1, true)
    simulator.handleResponse(user1, mockMovie1, true)

    // User2 likes it
    simulator.handleResponse(user2, mockMovie1, true)

    // Should still only have 2 unique users
    const likedUsers = simulator.likedMovies.get(mockMovie1)
    assertExists(likedUsers)
    assertEquals(likedUsers.length, 2)
  },
})

Deno.test({
  name: 'Session Matching - complex scenario with multiple users and movies',
  fn() {
    const simulator = new MatchingSimulator()

    const alice: User = { name: 'Alice', responses: [] }
    const bob: User = { name: 'Bob', responses: [] }
    const charlie: User = { name: 'Charlie', responses: [] }
    const diana: User = { name: 'Diana', responses: [] }

    simulator.addUser(alice)
    simulator.addUser(bob)
    simulator.addUser(charlie)
    simulator.addUser(diana)

    // Inception: Liked by Alice, Bob, Charlie (3-way match)
    simulator.handleResponse(alice, mockMovie1, true)
    simulator.handleResponse(bob, mockMovie1, true)
    simulator.handleResponse(charlie, mockMovie1, true)
    simulator.handleResponse(diana, mockMovie1, false) // Diana passes

    // Interstellar: Liked by Alice and Diana (2-way match)
    simulator.handleResponse(alice, mockMovie2, true)
    simulator.handleResponse(diana, mockMovie2, true)
    simulator.handleResponse(bob, mockMovie2, false)
    simulator.handleResponse(charlie, mockMovie2, null) // seen

    // The Matrix: Liked only by Bob (no match)
    simulator.handleResponse(bob, mockMovie3, true)
    simulator.handleResponse(alice, mockMovie3, false)
    simulator.handleResponse(charlie, mockMovie3, false)
    simulator.handleResponse(diana, mockMovie3, false)

    // Verify match count
    assertEquals(simulator.matches.length, 2) // Inception and Interstellar

    // Verify Alice's matches (2 movies)
    const aliceMatches = simulator.getExistingMatches(alice)
    assertEquals(aliceMatches.length, 2)

    // Verify Bob's matches (1 movie - Inception)
    const bobMatches = simulator.getExistingMatches(bob)
    assertEquals(bobMatches.length, 1)
    assertEquals(bobMatches[0].movie, mockMovie1)

    // Verify Charlie's matches (1 movie - Inception)
    const charlieMatches = simulator.getExistingMatches(charlie)
    assertEquals(charlieMatches.length, 1)

    // Verify Diana's matches (1 movie - Interstellar)
    const dianaMatches = simulator.getExistingMatches(diana)
    assertEquals(dianaMatches.length, 1)
    assertEquals(dianaMatches[0].movie, mockMovie2)

    // Verify The Matrix has no match
    const matrixUsers = simulator.likedMovies.get(mockMovie3)
    assertExists(matrixUsers)
    assertEquals(matrixUsers.length, 1) // Only Bob
  },
})
