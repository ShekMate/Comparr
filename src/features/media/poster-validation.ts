import * as log from 'https://deno.land/std@0.79.0/log/mod.ts'

// Cache for poster validation results to avoid repeated checks
const posterValidationCache = new Map<string, boolean>();
const MAX_POSTER_CACHE_SIZE = 5000; // Limit cache to 5000 entries (suitable for large libraries)

// Helper function to manage cache size
function addToPosterCache(key: string, value: boolean): void {
  // If cache is full, remove oldest entry (first entry in Map)
  if (posterValidationCache.size >= MAX_POSTER_CACHE_SIZE) {
    const firstKey = posterValidationCache.keys().next().value;
    if (firstKey !== undefined) {
      posterValidationCache.delete(firstKey);
      log.debug(`Poster cache full, removed oldest entry: ${firstKey}`);
    }
  }
  posterValidationCache.set(key, value);
}

/**
 * Check if a TMDb poster path actually exists
 */
export async function validateTMDbPoster(posterPath: string): Promise<boolean> {
  if (!posterPath) return false;
  
  // Check cache first
  if (posterValidationCache.has(posterPath)) {
    return posterValidationCache.get(posterPath)!;
  }
  
  try {
    // Try multiple image sizes to increase chances of finding a valid image
    const imageSizes = ['w342', 'w500', 'w780'];
    
    for (const size of imageSizes) {
      const imageUrl = `https://image.tmdb.org/t/p/${size}${posterPath}`;
      
      const response = await fetch(imageUrl, { 
        method: 'HEAD', // Just check if it exists, don't download
        signal: AbortSignal.timeout(3000) // 3 second timeout
      });
      
      if (response.ok) {
        log.debug(`Valid TMDb poster found: ${posterPath} (${size})`);
        addToPosterCache(posterPath, true);
        return true;
      }
    }
    
    log.debug(`No valid TMDb poster found: ${posterPath}`);
    addToPosterCache(posterPath, false);
    return false;
  } catch (error) {
    log.debug(`Poster validation failed for ${posterPath}: ${error.message}`);
    addToPosterCache(posterPath, false);
    return false;
  }
}

/**
 * Get the best available poster for a movie, or null if none exists
 */
export async function getBestPosterPath(movie: any, enrichmentData?: any): Promise<string | null> {
  // Try TMDb poster first if available
  if (enrichmentData?.tmdbPosterPath) {
    const isValid = await validateTMDbPoster(enrichmentData.tmdbPosterPath);
    if (isValid) {
      return `/tmdb-poster${enrichmentData.tmdbPosterPath}`;
    }
  }
  
  // Try direct TMDb poster from movie object
  if (movie.tmdbPosterPath || movie.poster_path) {
    const posterPath = movie.tmdbPosterPath || movie.poster_path;
    const isValid = await validateTMDbPoster(posterPath);
    if (isValid) {
      return `/tmdb-poster${posterPath}`;
    }
  }
  
  // Try existing thumb URL for TMDb movies
  if (movie.thumb && movie.thumb.startsWith('/tmdb-poster/')) {
    return movie.thumb;
  }
  
  // Use unified TMDB poster path only (legacy Plex fallback removed)
  return `/tmdb-poster/${posterPath}`;
  
  // No valid poster found
  return null;
}

/**
 * Enhanced movie validation - check both poster and essential data
 */
export function isMovieValid(movie: any, posterPath: string | null): boolean {
  // Must have a title
  if (!movie.title || movie.title.trim() === '') {
    log.debug(`Skipping movie: no title`);
    return false;
  }
  
  // Must have a valid poster (if you want to enforce this)
  if (!posterPath) {
    log.debug(`Skipping movie: ${movie.title} - no valid poster`);
    return false;
  }
  
  // Optional: Must have a year
  if (!movie.year || movie.year === 'N/A') {
    log.debug(`Movie ${movie.title} has no year, but allowing`);
  }
  
  return true;
}
