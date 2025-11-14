// Mock data and responses for TMDb API tests

export const mockTMDbMovie = {
  adult: false,
  backdrop_path: '/s3TBrRGB1iav7gFOCNx3H31MoES.jpg',
  genre_ids: [28, 878, 53],
  id: 27205,
  original_language: 'en',
  original_title: 'Inception',
  overview: 'Cobb, a skilled thief who commits corporate espionage by infiltrating the subconscious of his targets is offered a chance to regain his old life as payment for a task considered to be impossible: "inception", the implantation of another person\'s idea into a target\'s subconscious.',
  popularity: 89.326,
  poster_path: '/ljsZTbVsrQSqZgWeep2B1QiDKuh.jpg',
  release_date: '2010-07-16',
  title: 'Inception',
  video: false,
  vote_average: 8.367,
  vote_count: 35182,
}

export const mockTMDbMovieDetails = {
  ...mockTMDbMovie,
  belongs_to_collection: null,
  budget: 160000000,
  genres: [
    { id: 28, name: 'Action' },
    { id: 878, name: 'Science Fiction' },
    { id: 53, name: 'Thriller' },
  ],
  homepage: 'http://inceptionmovie.warnerbros.com/',
  imdb_id: 'tt1375666',
  production_companies: [
    {
      id: 923,
      logo_path: '/5UQsZrfbfG2dYJbx8DxfoTr2Bvu.png',
      name: 'Legendary Pictures',
      origin_country: 'US',
    },
    {
      id: 9996,
      logo_path: '/3tvBqYsBhxWeHlu62SIJ1el93O7.png',
      name: 'Syncopy',
      origin_country: 'GB',
    },
  ],
  production_countries: [
    { iso_3166_1: 'GB', name: 'United Kingdom' },
    { iso_3166_1: 'US', name: 'United States of America' },
  ],
  revenue: 825532764,
  runtime: 148,
  spoken_languages: [
    { english_name: 'English', iso_639_1: 'en', name: 'English' },
    { english_name: 'Japanese', iso_639_1: 'ja', name: '日本語' },
    { english_name: 'French', iso_639_1: 'fr', name: 'Français' },
  ],
  status: 'Released',
  tagline: 'Your mind is the scene of the crime.',
  'watch/providers': {
    results: {
      US: {
        link: 'https://www.themoviedb.org/movie/27205-inception/watch?locale=US',
        flatrate: [
          {
            logo_path: '/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg',
            provider_id: 8,
            provider_name: 'Netflix',
            display_priority: 0,
          },
        ],
        rent: [
          {
            logo_path: '/shq88b09gTBYC4hA7g1P7I7LQW1.jpg',
            provider_id: 3,
            provider_name: 'Google Play Movies',
            display_priority: 3,
          },
        ],
        buy: [
          {
            logo_path: '/shq88b09gTBYC4hA7g1P7I7LQW1.jpg',
            provider_id: 3,
            provider_name: 'Google Play Movies',
            display_priority: 3,
          },
        ],
      },
    },
  },
}

export const mockTMDbSearchResults = {
  page: 1,
  results: [mockTMDbMovie],
  total_pages: 1,
  total_results: 1,
}

export const mockTMDbDiscoverResults = {
  page: 1,
  results: [
    mockTMDbMovie,
    {
      ...mockTMDbMovie,
      id: 157336,
      title: 'Interstellar',
      original_title: 'Interstellar',
      release_date: '2014-11-07',
      vote_average: 8.442,
      vote_count: 33845,
    },
    {
      ...mockTMDbMovie,
      id: 603,
      title: 'The Matrix',
      original_title: 'The Matrix',
      release_date: '1999-03-31',
      vote_average: 8.218,
      vote_count: 24752,
    },
  ],
  total_pages: 100,
  total_results: 10000,
}

export function createMockTMDbMovie(overrides: Partial<typeof mockTMDbMovie> = {}) {
  return {
    ...mockTMDbMovie,
    ...overrides,
  }
}
