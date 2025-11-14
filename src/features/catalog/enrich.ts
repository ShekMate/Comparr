// src/features/catalog/enrich.ts
// Enriches Plex movies with ratings, plot, and metadata.
// Priority: 1) Local IMDb database, 2) OMDB API, 3) TMDb API
// The local IMDb database is sourced from daily IMDb dataset dumps.

import { getIMDbRating } from "./imdb-datasets.ts";

const OMDB = Deno.env.get("OMDB_API_KEY");
const TMDB = Deno.env.get("TMDB_API_KEY");
const PLEX_LIBRARY_NAME = Deno.env.get('PLEX_LIBRARY_NAME') || 'Plex';
const tmdbCache = new Map<string, any>()
const tmdbSearchCache = new Map<string, any>()
const redactUrl = (u: string) => u.replace(/(api_key|apikey|token|key)=([^&]+)/gi, '$1=***');
async function fetchJsonLogged(url: string, init?: RequestInit, label = 'fetch') {
  const t0 = Date.now();
  const safeUrl = redactUrl(url);
  try {
    const res = await fetch(url, init);
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch {}
    console.log(`[enrich] ${label} ${safeUrl} -> ${res.status} in ${Date.now() - t0}ms sample=${text.slice(0,300)}…`);
    if (!res.ok) {
      throw new Error(`${label} HTTP ${res.status}`);
    }
    return json ?? text;
  } catch (e) {
    console.error(`[enrich] ${label} FAILED ${safeUrl}: ${e?.message || e}`);
    throw e;
  }
}

// Replace the old "j" with a label-aware logger that redacts keys
async function j(url: string, label = "fetch") {
  const t0 = Date.now();
  const safe = url.replace(/(api_key|apikey|token|key)=([^&]+)/gi, "$1=***");
  let res: Response | null = null;
  let text = "";
  try {
    res = await fetch(url);
    text = await res.text();
    console.log(
      `[enrich] ${label} ${safe} -> ${res.status} in ${Date.now() - t0}ms sample=${text.slice(0, 240)}…`
    );
    if (!res.ok) {
      throw new Error(`${label} HTTP ${res.status}`);
    }
    try {
      return JSON.parse(text);
    } catch (e) {
      console.error(`[enrich] ${label} JSON parse failed: ${e?.message || e}`);
      throw e;
    }
  } catch (e) {
    console.error(`[enrich] ${label} FAILED ${safe}: ${e?.message || e}`);
    throw e;
  }
}

async function omdbById(id: string) {
  if (!OMDB || !id) {
    console.log(`[enrich] omdbById skip: api=${!!OMDB} id=${!!id}`);
    return null as any;
  }
  const url = `http://www.omdbapi.com/?apikey=${OMDB}&i=${id}&plot=short`;
  try {
    const d = await j(url, "omdbById");
    const ok = d && d.Response !== "False";
    console.log(
      `[enrich] omdbById result for ${id}: ${ok ? "OK" : "NO MATCH"} ${ok ? `imdb=${d.imdbRating}` : d?.Error || ""}`
    );
    return ok ? d : null;
  } catch (e) {
    console.error(`[enrich] omdbById error for ${id}: ${e?.message || e}`);
    return null;
  }
}

async function omdbByTitle(t: string, y?: number | null) {
  if (!OMDB || !t) {
    console.log(`[enrich] omdbByTitle skip: api=${!!OMDB} title=${!!t}`);
    return null as any;
  }
  const yq = y ? `&y=${y}` : "";
  const url = `http://www.omdbapi.com/?apikey=${OMDB}&t=${encodeURIComponent(t)}${yq}&plot=short`;
  try {
    const d = await j(url, "omdbByTitle");
    return d && d.Response !== "False" ? d : null;
  } catch (e) {
    console.error(`[enrich] omdbByTitle error: ${e?.message || e}`);
    return null;
  }
}

async function tmdbSearchMovie(title: string, year?: number | null) {
  if (!TMDB || !title) {
    console.log(`[enrich] tmdbSearchMovie skip: api=${!!TMDB} title=${!!title}`);
    return null as any;
  }
  const cacheKey = `search-${title}-${year || "noyear"}`;
  if (tmdbSearchCache.has(cacheKey)) {
    return tmdbSearchCache.get(cacheKey);
  }
  const q = new URLSearchParams({ api_key: TMDB, query: title, include_adult: "false" });
  if (year) q.set("year", String(year));
  const url = `https://api.themoviedb.org/3/search/movie?${q.toString()}`;
  try {
    const data = await j(url, "tmdb.search");
    const result = data?.results?.[0] ?? null;
    if (!result) console.warn(`[enrich] tmdb.search no results for "${title}" y=${year ?? ""}`);
    if (result) tmdbSearchCache.set(cacheKey, result);
    return result;
  } catch (e) {
    console.error(`[enrich] tmdb.search error: ${e?.message || e}`);
    return null;
  }
}

async function tmdbMovieDetails(id: number) {
  if (!TMDB || !id) {
    console.log(`[enrich] tmdbMovieDetails skip: api=${!!TMDB} id=${!!id}`);
    return null as any;
  }
  const cacheKey = `details-${id}`;
  if (tmdbCache.has(cacheKey)) {
    return tmdbCache.get(cacheKey);
  }
  const url = `https://api.themoviedb.org/3/movie/${id}?api_key=${TMDB}&append_to_response=external_ids,watch/providers,credits`;
  try {
    const result = await j(url, "tmdb.details");
    if (!result) console.warn(`[enrich] tmdb.details empty for id=${id}`);
    if (result) tmdbCache.set(cacheKey, result);
    return result;
  } catch (e) {
    console.error(`[enrich] tmdb.details error id=${id}: ${e?.message || e}`);
    return null;
  }
}


const imdbFromGuid = (guid?: string | null) => {
  if (!guid) return null;
  const m = guid.match(/imdb:\/\/(tt\d{7,})/i);
  return m ? m[1] : null;
};

export async function enrich({
  title,
  year,
  plexGuid,
  imdbId: providedImdbId,
}: {
  title: string;
  year?: number | null;
  plexGuid?: string | null;
  imdbId?: string | null;
}) {
  let plot: string | null = null;
  let imdbId: string | null = providedImdbId || imdbFromGuid(plexGuid);
  let rating_imdb: number | null = null;
  let rating_rt: number | null = null;
  let rating_tmdb: number | null = null;
  let genres: string[] = [];
  let streamingServices: { subscription: any[], free: any[] } = { subscription: [], free: [] };
  let contentRating: string | null = null;
  let cast: string[] = [];
  let writers: string[] = [];
  let director: string | null = null;
  let runtime: number | null = null;
  let streamingLink: string | null = null;
  let voteCount: number | null = null;

  // 1) Try local IMDb database first for ratings (if we have an IMDb ID)
  if (imdbId) {
    const localRating = getIMDbRating(imdbId);
    if (localRating !== null) {
      rating_imdb = localRating;
    }
  }

  // 2) OMDb (prefer provided IMDb ID, then plex guid IMDb id, else title+year)
  // Always query OMDB to get plot, RT ratings, and fallback IMDb rating
  let om = imdbId ? await omdbById(imdbId) : null;
  if (!om) om = await omdbByTitle(title, year ?? undefined);

   if (om) {
    plot = om.Plot || null;
    imdbId = om.imdbID || imdbId || null;

    // Only use OMDB rating if we don't have one from local database
    if (rating_imdb === null) {
      rating_imdb = om.imdbRating && om.imdbRating !== "N/A" ? Number(om.imdbRating) : null;
    }

    const rtRow = (om.Ratings || []).find((r: any) => r.Source === "Rotten Tomatoes");
    rating_rt = rtRow ? parseInt(String(rtRow.Value).replace("%", ""), 10) : null;
    contentRating = om.Rated && om.Rated !== "N/A" ? om.Rated : null;
  
    // ALWAYS get TMDb data even when OMDb succeeds
    const hit = await tmdbSearchMovie(title, year ?? undefined);
    let tmdbPosterPath = hit?.poster_path || null;
  
    if (hit) {
      const det = await tmdbMovieDetails(hit.id);
      rating_tmdb = typeof det?.vote_average === "number" ? Number(det.vote_average.toFixed(1)) : (hit?.vote_average ?? null);
    
      if (det) {
        genres = (det.genres || []).map((g: any) => g.name);
        runtime = det.runtime || null;
		voteCount = det.vote_count || null;
        
        const providers = det["watch/providers"]?.results?.US;
        if (providers) {
          // Import the normalization function
          const { normalizeProviderName } = await import('../../infra/constants/streamingProvidersMapping.ts');
          
          // Extract JustWatch link
          streamingLink = providers.link || null;
          
          // Process subscription services (flatrate)
          const subscriptionMap = new Map();
          (providers.flatrate || []).forEach((p: any) => {
            const normalizedName = normalizeProviderName(p.provider_name);
            if (!subscriptionMap.has(normalizedName)) {
              subscriptionMap.set(normalizedName, {
                id: p.provider_id,
                name: normalizedName,
                logo_path: p.logo_path || null,
                type: 'subscription'
              });
            }
          });
          
          // Process free services (free + ads)
          const freeMap = new Map();
          [...(providers.free || []), ...(providers.ads || [])].forEach((p: any) => {
            const normalizedName = normalizeProviderName(p.provider_name);
            if (!freeMap.has(normalizedName)) {
              freeMap.set(normalizedName, {
                id: p.provider_id,
                name: normalizedName,
                logo_path: p.logo_path || null,
                type: 'free'
              });
            }
          });
          
          // Store as structured object
          streamingServices = {
            subscription: Array.from(subscriptionMap.values()),
            free: Array.from(freeMap.values())
          };
        }
        
        // Extract credits (cast, crew)
        const credits = det.credits;
        if (credits) {
          if (credits.cast) {
            cast = credits.cast
              .slice(0, 5)
              .map((c: any) => c.name)
              .filter((name: string) => name);
          }
          
          if (credits.crew) {
            const directorData = credits.crew.find((c: any) => c.job === 'Director');
            if (directorData?.name) {
              director = directorData.name;
            }
            
            writers = credits.crew
              .filter((c: any) => c.job === 'Writer' || c.job === 'Screenplay' || c.job === 'Story')
              .map((c: any) => c.name)
              .filter((name: string) => name)
              .slice(0, 3);
          }
        }
      }
    }
  
    // Check if movie is in Plex and add to streamingServices
    try {
      const { isMovieInPlex } = await import('../../integrations/plex/cache.ts');
      
      // Try to get TMDb ID from the movie details we already fetched
      const tmdbId = det?.id || hit?.id;
      const imdbFromTmdb = det?.external_ids?.imdb_id;
      
      const inPlex = isMovieInPlex({
        tmdbId,
        imdbId: imdbFromTmdb || imdbId || undefined,
        title,
        year
      });
      
      if (inPlex && !streamingServices.subscription.some(s => s.name === PLEX_LIBRARY_NAME)) {
        streamingServices.subscription.unshift({
          id: 0,
          name: PLEX_LIBRARY_NAME,
          logo_path: '/assets/logos/allvids.svg',
          type: 'subscription'
        });
      }
    } catch (err) {
      console.log(`[enrich] Failed to check Plex status: ${err?.message || err}`);
    }
  
    return { plot, imdbId, rating_imdb, rating_rt, rating_tmdb, genres, streamingServices, contentRating, tmdbPosterPath: hit?.poster_path || null, cast, writers, director, runtime, streamingLink, voteCount, tmdbId: hit?.id || null };
  }

  // 2) TMDb fallback (overview & vote_average); bounce back to OMDb if we get an IMDb id
  const hit = await tmdbSearchMovie(title, year ?? undefined);
  if (hit) {
    const det = await tmdbMovieDetails(hit.id);
    plot = det?.overview || hit.overview || null;
    rating_tmdb = typeof det?.vote_average === "number" ? Number(det.vote_average.toFixed(1)) : (hit?.vote_average ?? null);

    // Extract additional TMDb data
    if (det) {
      genres = (det.genres || []).map((g: any) => g.name);
      runtime = det.runtime || null;
	  voteCount = det.vote_count || null;
      
      const providers = det["watch/providers"]?.results?.US;
      if (providers) {
        // Import the normalization function
        const { normalizeProviderName } = await import('../../infra/constants/streamingProvidersMapping.ts');
        
        // Extract JustWatch link
        streamingLink = providers.link || null;
        
        // Process subscription services (flatrate)
        const subscriptionMap = new Map();
        (providers.flatrate || []).forEach((p: any) => {
          const normalizedName = normalizeProviderName(p.provider_name);
          if (!subscriptionMap.has(normalizedName)) {
            subscriptionMap.set(normalizedName, {
              id: p.provider_id,
              name: normalizedName,
              logo_path: p.logo_path || null,
              type: 'subscription'
            });
          }
        });
        
        // Process free services (free + ads)
        const freeMap = new Map();
        [...(providers.free || []), ...(providers.ads || [])].forEach((p: any) => {
          const normalizedName = normalizeProviderName(p.provider_name);
          if (!freeMap.has(normalizedName)) {
            freeMap.set(normalizedName, {
              id: p.provider_id,
              name: normalizedName,
              logo_path: p.logo_path || null,
              type: 'free'
            });
          }
        });
        
        // Store as structured object
        streamingServices = {
          subscription: Array.from(subscriptionMap.values()),
          free: Array.from(freeMap.values())
        };
      }
      
      // Extract credits (cast, crew)
      const credits = det.credits;
      if (credits) {
        if (credits.cast) {
          cast = credits.cast
            .slice(0, 5)
            .map((c: any) => c.name)
            .filter((name: string) => name);
        }
        
        if (credits.crew) {
          const directorData = credits.crew.find((c: any) => c.job === 'Director');
          if (directorData?.name) {
            director = directorData.name;
          }
          
          writers = credits.crew
            .filter((c: any) => c.job === 'Writer' || c.job === 'Screenplay' || c.job === 'Story')
            .map((c: any) => c.name)
            .filter((name: string) => name)
            .slice(0, 3);
        }
      }
    }

    const imdbFromTmdb = det?.external_ids?.imdb_id;
    if (OMDB && imdbFromTmdb) {
      const om2 = await omdbById(imdbFromTmdb);
      if (om2) {
        plot = om2.Plot || plot;
        imdbId = om2.imdbID || imdbFromTmdb;
        rating_imdb = om2.imdbRating && om2.imdbRating !== "N/A" ? Number(om2.imdbRating) : null;
        const rtRow2 = (om2.Ratings || []).find((r: any) => r.Source === "Rotten Tomatoes");
        rating_rt = rtRow2 ? parseInt(String(rtRow2.Value).replace("%", ""), 10) : null;
      } else {
        imdbId = imdbFromTmdb;
      }
    }
  }

  // Check if movie is in Plex and add to streamingServices
  try {
    const { isMovieInPlex } = await import('../../integrations/plex/cache.ts');
    
    // Try to get TMDb ID from the movie details we already fetched
    const tmdbId = det?.id || hit?.id;
    const imdbFromTmdb = det?.external_ids?.imdb_id;
    
    const inPlex = isMovieInPlex({
      tmdbId,
      imdbId: imdbFromTmdb || imdbId || undefined,
      title,
      year
    });
    
    if (inPlex && !streamingServices.subscription.some(s => s.name === PLEX_LIBRARY_NAME)) {
      streamingServices.subscription.unshift({
        id: 0,
        name: PLEX_LIBRARY_NAME,
        logo_path: '/assets/logos/allvids.svg',
        type: 'subscription'
      });
    }
  } catch (err) {
    console.log(`[enrich] Failed to check Plex status: ${err?.message || err}`);
  }

  return { plot, imdbId, rating_imdb, rating_rt, rating_tmdb, genres, streamingServices, contentRating, tmdbPosterPath: hit?.poster_path || null, cast, writers, director, runtime, streamingLink, voteCount };
}