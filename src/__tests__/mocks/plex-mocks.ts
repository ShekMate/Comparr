// Mock data and responses for Plex API tests

export const mockPlexSections = {
  MediaContainer: {
    size: 3,
    Directory: [
      {
        key: '1',
        title: 'Movies',
        type: 'movie',
        hidden: 0,
        agent: 'com.plexapp.agents.imdb',
      },
      {
        key: '2',
        title: 'TV Shows',
        type: 'show',
        hidden: 0,
        agent: 'com.plexapp.agents.thetvdb',
      },
      {
        key: '3',
        title: 'Animation',
        type: 'movie',
        hidden: 0,
        agent: 'com.plexapp.agents.imdb',
      },
    ],
  },
}

export const mockPlexMovies = {
  MediaContainer: {
    size: 3,
    Metadata: [
      {
        ratingKey: '1001',
        key: '/library/metadata/1001',
        guid: 'plex://movie/5d776825880197001ec967c1',
        studio: 'Warner Bros.',
        type: 'movie',
        title: 'Inception',
        contentRating: 'PG-13',
        summary: 'A thief who steals corporate secrets through dream-sharing technology...',
        rating: 8.8,
        year: 2010,
        tagline: 'Your mind is the scene of the crime',
        thumb: '/library/metadata/1001/thumb/1234567890',
        art: '/library/metadata/1001/art/1234567890',
        duration: 8880000,
        originallyAvailableAt: '2010-07-16',
        addedAt: 1234567890,
        updatedAt: 1234567890,
        Genre: [
          { tag: 'Action' },
          { tag: 'Science Fiction' },
          { tag: 'Thriller' },
        ],
        Director: [{ tag: 'Christopher Nolan' }],
        Writer: [{ tag: 'Christopher Nolan' }],
        Role: [
          { tag: 'Leonardo DiCaprio' },
          { tag: 'Joseph Gordon-Levitt' },
          { tag: 'Elliot Page' },
        ],
        Guid: [
          { id: 'imdb://tt1375666' },
          { id: 'tmdb://27205' },
        ],
      },
      {
        ratingKey: '1002',
        key: '/library/metadata/1002',
        guid: 'plex://movie/5d7768269c94b9001f3a23a5',
        studio: 'Paramount Pictures',
        type: 'movie',
        title: 'Interstellar',
        contentRating: 'PG-13',
        summary: 'A team of explorers travel through a wormhole in space...',
        rating: 8.6,
        year: 2014,
        thumb: '/library/metadata/1002/thumb/1234567890',
        art: '/library/metadata/1002/art/1234567890',
        duration: 10080000,
        originallyAvailableAt: '2014-11-07',
        addedAt: 1234567891,
        updatedAt: 1234567891,
        Genre: [
          { tag: 'Adventure' },
          { tag: 'Drama' },
          { tag: 'Science Fiction' },
        ],
        Director: [{ tag: 'Christopher Nolan' }],
        Writer: [
          { tag: 'Jonathan Nolan' },
          { tag: 'Christopher Nolan' },
        ],
        Role: [
          { tag: 'Matthew McConaughey' },
          { tag: 'Anne Hathaway' },
          { tag: 'Jessica Chastain' },
        ],
        Guid: [
          { id: 'imdb://tt0816692' },
          { id: 'tmdb://157336' },
        ],
      },
      {
        ratingKey: '1003',
        key: '/library/metadata/1003',
        guid: 'plex://movie/5d776827d5348a002004e803',
        studio: 'Warner Bros.',
        type: 'movie',
        title: 'The Matrix',
        contentRating: 'R',
        summary: 'A computer hacker learns about the true nature of reality...',
        rating: 8.7,
        year: 1999,
        thumb: '/library/metadata/1003/thumb/1234567890',
        art: '/library/metadata/1003/art/1234567890',
        duration: 8160000,
        originallyAvailableAt: '1999-03-31',
        addedAt: 1234567892,
        updatedAt: 1234567892,
        Genre: [
          { tag: 'Action' },
          { tag: 'Science Fiction' },
        ],
        Director: [
          { tag: 'Lana Wachowski' },
          { tag: 'Lilly Wachowski' },
        ],
        Writer: [
          { tag: 'Lana Wachowski' },
          { tag: 'Lilly Wachowski' },
        ],
        Role: [
          { tag: 'Keanu Reeves' },
          { tag: 'Laurence Fishburne' },
          { tag: 'Carrie-Anne Moss' },
        ],
        Guid: [
          { id: 'imdb://tt0133093' },
          { id: 'tmdb://603' },
        ],
      },
    ],
  },
}

export const mockPlexMovie = mockPlexMovies.MediaContainer.Metadata[0]

export function createMockPlexMovie(overrides: Partial<typeof mockPlexMovie> = {}) {
  return {
    ...mockPlexMovie,
    ...overrides,
  }
}
