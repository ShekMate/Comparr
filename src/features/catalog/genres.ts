// Canonical TMDb movie genre ID map. discoverMovies() needs this to translate the genre
// *names* the mobile client's filter chips send (e.g. "Action") into the numeric IDs TMDb's
// /discover/movie endpoint actually requires for `with_genres` — sending a name straight
// through silently returns zero results for the whole query, not just an ignored filter.
const TMDB_GENRE_MAP: Record<number, string> = {
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
  37: 'Western',
}

const TMDB_GENRE_NAME_TO_ID: Record<string, number> = Object.fromEntries(
  Object.entries(TMDB_GENRE_MAP).map(([id, name]) => [name, Number(id)])
)

// Accepts a mix of genre names and/or already-numeric TMDb genre IDs (defensive — in case a
// future client sends IDs directly) and returns numeric ID strings for `with_genres`.
// Unrecognized entries are dropped rather than passed through unresolved.
export function resolveGenreIds(genres: string[]): string[] {
  return genres
    .map(genre => {
      if (/^\d+$/.test(genre)) return genre
      const id = TMDB_GENRE_NAME_TO_ID[genre]
      return id != null ? String(id) : null
    })
    .filter((id): id is string => id != null)
}
