// src/features/session/imdb-import.ts
// Handles parsing IMDb CSV exports and looking up movies via TMDb API.
import * as log from 'https://deno.land/std@0.79.0/log/mod.ts'

export interface ImdbCsvRow {
  imdbId: string
  title: string
  year: number | null
  titleType: string
}

export interface ImdbImportTarget {
  exportUrl: string
  pageUrl: string
  sourceType: 'list' | 'ratings' | 'watchlist'
  normalizedInput: string
}

/**
 * Resolve user-provided IMDb sync input into an export CSV URL.
 * Supports full URLs as well as bare IDs (e.g. ls123456789, ur12345678).
 */
export function resolveImdbImportTarget(
  input: string
): ImdbImportTarget | null {
  const value = String(input || '').trim()
  if (!value) return null

  const listIdMatch = value.match(/\b(ls\d+)\b/i)
  if (listIdMatch) {
    const listId = listIdMatch[1].toLowerCase()
    return {
      exportUrl: `https://www.imdb.com/list/${listId}/export`,
      pageUrl: `https://www.imdb.com/list/${listId}`,
      sourceType: 'list',
      normalizedInput: listId,
    }
  }

  const userIdMatch = value.match(/\b(ur\d+)\b/i)
  if (!userIdMatch) return null

  const userId = userIdMatch[1].toLowerCase()
  const lowerValue = value.toLowerCase()

  if (lowerValue.includes('/watchlist')) {
    return {
      exportUrl: `https://www.imdb.com/user/${userId}/watchlist/export`,
      pageUrl: `https://www.imdb.com/user/${userId}/watchlist`,
      sourceType: 'watchlist',
      normalizedInput: userId,
    }
  }

  return {
    exportUrl: `https://www.imdb.com/user/${userId}/ratings/export`,
    pageUrl: `https://www.imdb.com/user/${userId}/ratings`,
    sourceType: 'ratings',
    normalizedInput: userId,
  }
}

/**
 * Attempt to discover an IMDb CSV export URL from a ratings/watchlist/list HTML page.
 */
export function extractImdbExportUrlFromHtml(html: string): string | null {
  const text = String(html || '')

  const patterns: RegExp[] = [
    // Relative paths typically found in href attributes.
    /\/(?:list\/[a-z0-9]+|user\/ur\d+\/(?:ratings|watchlist))\/export\/?(?:\?[^"'\s<>]*)?/i,
    // Absolute URLs embedded directly in markup or scripts.
    /https:\/\/www\.imdb\.com\/(?:list\/[a-z0-9]+|user\/ur\d+\/(?:ratings|watchlist))\/export\/?(?:\?[^"'\s<>]*)?/i,
    // Escaped absolute URLs embedded in JSON/script payloads.
    new RegExp(
      String.raw`https:\\\/\\\/www\\.imdb\\.com\\\/(?:list\\\/[a-z0-9]+|user\\\/ur\\d+\\\/(?:ratings|watchlist))\\\/export\\\/?(?:\?[^"'\\]*)?`,
      'i'
    ),
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    const rawValue = match?.[0]
    if (!rawValue) continue

    const unescaped = rawValue.replace(/\\\//g, '/')

    if (unescaped.startsWith('http')) {
      return unescaped
    }

    if (unescaped.startsWith('/')) {
      return `https://www.imdb.com${unescaped}`
    }
  }

  return null
}

/**
 * Parse an IMDb CSV export (ratings or watchlist) and extract movie entries.
 * Handles both the "Your Ratings" and "Watchlist" export formats.
 */
export function parseImdbCsv(csvText: string): ImdbCsvRow[] {
  // Strip BOM if present
  const cleaned = csvText.startsWith('\uFEFF') ? csvText.slice(1) : csvText
  const lines = cleaned.split('\n')
  if (lines.length < 2) return []

  // Parse header to find column indices
  const header = parseCsvLine(lines[0])
  const constIdx = header.findIndex(h => h.toLowerCase() === 'const')
  const titleIdx = header.findIndex(h => h.toLowerCase() === 'title')
  const yearIdx = header.findIndex(h => h.toLowerCase() === 'year')
  const typeIdx = header.findIndex(h => h.toLowerCase() === 'title type')

  if (constIdx < 0) {
    log.warning('IMDb CSV: "Const" column not found in header')
    return []
  }

  const rows: ImdbCsvRow[] = []

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    const cols = parseCsvLine(line)
    const imdbId = cols[constIdx]?.trim()
    if (!imdbId || !imdbId.startsWith('tt')) continue

    const titleType = typeIdx >= 0 ? cols[typeIdx]?.trim().toLowerCase() : ''

    // Only import movies (skip TV series, episodes, etc.)
    if (
      titleType &&
      titleType !== 'movie' &&
      titleType !== 'feature' &&
      titleType !== 'tvmovie' &&
      titleType !== 'tv movie' &&
      titleType !== 'video'
    ) {
      continue
    }

    const title = titleIdx >= 0 ? cols[titleIdx]?.trim() : ''
    const yearStr = yearIdx >= 0 ? cols[yearIdx]?.trim() : ''
    const year = yearStr ? parseInt(yearStr, 10) : null

    rows.push({
      imdbId,
      title: title || '',
      year: year && Number.isFinite(year) ? year : null,
      titleType: titleType || 'movie',
    })
  }

  return rows
}

/**
 * Parse a single CSV line handling quoted fields with commas and escaped quotes.
 */
function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"'
          i++ // skip escaped quote
        } else {
          inQuotes = false
        }
      } else {
        current += char
      }
    } else {
      if (char === '"') {
        inQuotes = true
      } else if (char === ',') {
        result.push(current)
        current = ''
      } else {
        current += char
      }
    }
  }
  result.push(current)
  return result
}

export interface TmdbMovieResult {
  tmdbId: number
  imdbId: string
  title: string
  year: string
  summary: string
  posterPath: string | null
  guid: string
  genres: string[]
  genreIds: number[]
  runtime: number | null
  contentRating: string | null
  voteCount: number
  originalLanguage: string | null
}

/**
 * Look up a movie by IMDb ID using the TMDb API.
 * Returns null if the movie can't be found.
 */
export async function lookupMovieByImdbId(
  imdbId: string,
  tmdbApiKey: string
): Promise<TmdbMovieResult | null> {
  try {
    const response = await fetch(
      `https://api.themoviedb.org/3/find/${imdbId}?api_key=${tmdbApiKey}&external_source=imdb_id`
    )

    if (!response.ok) {
      log.warning(`TMDb find failed for ${imdbId}: HTTP ${response.status}`)
      return null
    }

    const data = await response.json()
    const movie = data.movie_results?.[0]

    if (!movie) {
      log.debug(`TMDb: No movie result for IMDb ID ${imdbId}`)
      return null
    }

    // Get additional details (content rating, runtime)
    let runtime: number | null = null
    let contentRating: string | null = null
    try {
      const detailsResp = await fetch(
        `https://api.themoviedb.org/3/movie/${movie.id}?api_key=${tmdbApiKey}&append_to_response=release_dates`
      )
      if (detailsResp.ok) {
        const details = await detailsResp.json()
        runtime = details.runtime || null

        // Get US content rating
        const usRelease = details.release_dates?.results?.find(
          (r: any) => r.iso_3166_1 === 'US'
        )
        if (usRelease?.release_dates?.length > 0) {
          contentRating = usRelease.release_dates[0].certification || null
        }
      }
    } catch {
      // Non-critical, continue without details
    }

    // Genre mapping
    const genreMap: Record<number, string> = {
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

    const genres = (movie.genre_ids || [])
      .map((id: number) => genreMap[id])
      .filter(Boolean) as string[]

    return {
      tmdbId: movie.id,
      imdbId,
      title: movie.title,
      year: movie.release_date
        ? String(new Date(movie.release_date).getFullYear())
        : '',
      summary: movie.overview || '',
      posterPath: movie.poster_path || null,
      guid: `tmdb://${movie.id}`,
      genres,
      genreIds: movie.genre_ids || [],
      runtime,
      contentRating,
      voteCount: movie.vote_count || 0,
      originalLanguage: movie.original_language || null,
    }
  } catch (err) {
    log.error(`TMDb lookup failed for ${imdbId}: ${err?.message || err}`)
    return null
  }
}
