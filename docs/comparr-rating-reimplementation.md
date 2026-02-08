# Comparr rating (average) reimplementation

This document captures the code required to restore the Comparr rating calculation that averages IMDb, Rotten Tomatoes, and TMDb ratings. The snippets below are intended to be pasted back into the respective files if the calculation is ever removed.

## Session rating recalculation helper

**File:** `src/features/session/session.ts`

Re-enable the Comparr average calculation inside `ensureComparrScore` (before the rating HTML rebuild).

```ts
// Calculate Comparr score if missing (requires at least 2 ratings)
const ratings = [];
if (hasImdb) ratings.push(movie.rating_imdb);
if (hasTmdb) ratings.push(movie.rating_tmdb);
if (hasRt) ratings.push(movie.rating_rt / 10);

if (ratings.length >= 2 && (movie.rating_comparr === null || movie.rating_comparr === undefined)) {
  const sum = ratings.reduce((acc, val) => acc + val, 0);
  movie.rating_comparr = Math.round((sum / ratings.length) * 10) / 10;
}
```

## Enrich flow (OMDb + TMDb success path)

**File:** `src/features/catalog/enrich.ts`

Re-enable the average rating calculation before the `return` inside the OMDb success path (after all rating sources are populated).

```ts
// Calculate Comparr score (average of available ratings, requires at least 2)
const ratings = [];
if (rating_imdb !== null) ratings.push(rating_imdb);
if (rating_tmdb !== null) ratings.push(rating_tmdb);
if (rating_rt !== null) ratings.push(rating_rt / 10); // Convert percentage to decimal

if (ratings.length >= 2) {
  const sum = ratings.reduce((acc, val) => acc + val, 0);
  rating_comparr = Math.round((sum / ratings.length) * 10) / 10; // Round to 1 decimal place
}
```

## Enrich flow (TMDb fallback path)

**File:** `src/features/catalog/enrich.ts`

Re-enable the average rating calculation before the final `return` in the TMDb fallback path.

```ts
// Calculate Comparr score (average of available ratings, requires at least 2)
const ratings = [];
if (rating_imdb !== null) ratings.push(rating_imdb);
if (rating_tmdb !== null) ratings.push(rating_tmdb);
if (rating_rt !== null) ratings.push(rating_rt / 10); // Convert percentage to decimal

if (ratings.length >= 2) {
  const sum = ratings.reduce((acc, val) => acc + val, 0);
  rating_comparr = Math.round((sum / ratings.length) * 10) / 10; // Round to 1 decimal place
}
```
