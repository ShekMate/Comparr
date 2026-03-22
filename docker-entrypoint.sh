#!/bin/sh
set -e

# Allow users to choose the UID/GID that should own /data
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

# Ensure the runtime user/group exist to match PUID/PGID
if ! getent group "${PGID}" >/dev/null 2>&1; then
  groupadd -g "${PGID}" appgroup || true
fi

if ! id -u "${PUID}" >/dev/null 2>&1; then
  useradd -u "${PUID}" -g "${PGID}" -M -s /usr/sbin/nologin appuser || true
fi

# Make sure /data exists and is owned correctly
mkdir -p /data
chown -R "${PUID}:${PGID}" /data || true

ALLOWED_ENV_VARS="DATA_DIR,TRUST_PROXY,MAX_BODY_SIZE,ALLOWED_ORIGINS,ALLOW_REMOTE_BOOTSTRAP,ENRICH_CACHE_TTL_MS,ENRICH_CACHE_MAX_ENTRIES,DISCOVER_CACHE_DEFAULT_PAGES,DISCOVER_CACHE_FILTERED_PAGES,SEND_BATCH_SOFT_TIMEOUT_MS,SEND_BATCH_HARD_TIMEOUT_MS,INITIAL_BATCH_HARD_TIMEOUT_MS,LOGIN_PREFETCH_SOFT_TIMEOUT_MS,ENRICHMENT_TIMEOUT_MS,DISCOVER_ENRICH_PREWARM_COUNT,DISCOVER_ENRICH_PREWARM_CONCURRENCY,PLEX_URL,PLEX_TOKEN,PLEX_LIBRARY_NAME,EMBY_URL,EMBY_API_KEY,EMBY_LIBRARY_NAME,JELLYFIN_URL,JELLYFIN_API_KEY,JELLYFIN_LIBRARY_NAME,PORT,HOST,ACCESS_PASSWORD,ADMIN_PASSWORD,TMDB_API_KEY,RADARR_URL,RADARR_API_KEY,JELLYSEERR_URL,JELLYSEERR_API_KEY,OVERSEERR_URL,OVERSEERR_API_KEY,SEERR_URL,SEERR_API_KEY,LOG_LEVEL,MOVIE_BATCH_SIZE,LIBRARY_FILTER,COLLECTION_FILTER,ROOT_PATH,FRAME_ANCESTORS,LINK_TYPE,IMDB_SYNC_URL,IMDB_SYNC_INTERVAL_MINUTES,STREAMING_PROFILE_MODE,PAID_STREAMING_SERVICES,PERSONAL_MEDIA_SOURCES,SETUP_WIZARD_COMPLETED"
ALLOWED_NET_HOSTS="0.0.0.0,127.0.0.1,localhost,api.themoviedb.org,image.tmdb.org,datasets.imdbws.com"
URL_ENV_VARS="PLEX_URL EMBY_URL JELLYFIN_URL RADARR_URL JELLYSEERR_URL OVERSEERR_URL SEERR_URL IMDB_SYNC_URL"

extract_host() {
  value="$1"
  if [ -z "$value" ]; then
    return 0
  fi
  host=$(printf '%s' "$value" | sed -E 's#^[a-zA-Z]+://##; s#/.*##')
  if [ -n "$host" ]; then
    ALLOWED_NET_HOSTS="${ALLOWED_NET_HOSTS},${host}"
  fi
}

for var_name in $URL_ENV_VARS; do
  eval "var_value=\${$var_name}"
  extract_host "$var_value"
done

if [ -n "${HOST:-}" ]; then
  ALLOWED_NET_HOSTS="${ALLOWED_NET_HOSTS},${HOST}"
fi

if [ -f /data/settings.json ]; then
  settings_hosts=$(deno eval --allow-read=/data "try { const raw = await Deno.readTextFile('/data/settings.json'); const settings = JSON.parse(raw); const keys = ['PLEX_URL','EMBY_URL','JELLYFIN_URL','RADARR_URL','JELLYSEERR_URL','OVERSEERR_URL','SEERR_URL','IMDB_SYNC_URL']; const hosts = []; for (const key of keys) { const value = String(settings?.[key] ?? '').trim(); if (!value) continue; try { hosts.push(new URL(value).host); } catch {} } console.log(hosts.join(',')); } catch { console.log(''); }")
  if [ -n "$settings_hosts" ]; then
    ALLOWED_NET_HOSTS="${ALLOWED_NET_HOSTS},${settings_hosts}"
  fi
fi

# de-duplicate host list
ALLOWED_NET_HOSTS=$(printf '%s' "$ALLOWED_NET_HOSTS" | tr ',' '\n' | sed '/^$/d' | awk '!seen[$0]++' | paste -sd ',' -)

# Run the server as the requested user
exec gosu "${PUID}:${PGID}" deno run \
  --allow-net="${ALLOWED_NET_HOSTS}" \
  --allow-read=/data,/app \
  --allow-write=/data \
  --allow-env="${ALLOWED_ENV_VARS}" \
  src/index.ts
