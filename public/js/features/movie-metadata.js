export function getGenreNames(genreIds) {
  const genreMap = {
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
    878: 'Sci-Fi',
    10770: 'TV Movie',
    53: 'Thriller',
    10752: 'War',
    37: 'Western',
  }
  return (genreIds || []).map(id => genreMap[id]).filter(Boolean)
}

export function formatRuntime(minutes) {
  if (!minutes) return null
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hours > 0) {
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
  }
  return `${mins}m`
}

function parseNumericRating(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number.parseFloat(String(value).replace(/[^\d.]/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

export function buildRatingHtml(movie, basePath) {
  const comparr = parseNumericRating(movie?.rating_comparr)
  const imdb = parseNumericRating(movie?.rating_imdb)
  const tmdb = parseNumericRating(movie?.rating_tmdb)

  const parts = []
  if (comparr != null) {
    parts.push(
      `<img src="${basePath}/assets/logos/comparr.svg" alt="Comparr" class="rating-logo"> <span class="rating-value">${comparr.toFixed(
        1
      )}</span>`
    )
  }
  if (imdb != null) {
    parts.push(
      `<img src="${basePath}/assets/logos/imdb.svg" alt="IMDb" class="rating-logo"> <span class="rating-value">${imdb.toFixed(
        1
      )}</span>`
    )
  }
  if (tmdb != null) {
    parts.push(
      `<img src="${basePath}/assets/logos/tmdb.svg" alt="TMDb" class="rating-logo"> <span class="rating-value">${tmdb.toFixed(
        1
      )}</span>`
    )
  }

  if (parts.length > 0) {
    return parts.join(' <span class="rating-separator">&bull;</span> ')
  }

  const raw = String(movie?.rating || '').trim()
  if (!raw) return ''
  if (raw.includes('<img')) return raw

  const parsedFromText = {
    comparr: parseNumericRating(
      raw.match(/comparr\s*[:\-]?\s*([\d.]+)/i)?.[1] || null
    ),
    imdb: parseNumericRating(raw.match(/imdb\s*[:\-]?\s*([\d.]+)/i)?.[1]),
    tmdb: parseNumericRating(raw.match(/tmdb\s*[:\-]?\s*([\d.]+)/i)?.[1]),
  }

  return buildRatingHtml(
    {
      rating_comparr: parsedFromText.comparr,
      rating_imdb: parsedFromText.imdb,
      rating_tmdb: parsedFromText.tmdb,
    },
    basePath
  )
}
