FROM denoland/deno:2.7.4@sha256:e580f32dd8aab60dd5b53f679129f6e3e80f1037ba7a7e31493425365a4cdfb0

LABEL org.opencontainers.image.title="Comparr" \
      org.opencontainers.image.description="Tinder-style movie matcher for Plex" \
      org.opencontainers.image.licenses="Apache-2.0"

EXPOSE 8000
WORKDIR /app

# Install gosu (privilege drop) and libsqlite3 (used by @db/sqlite via FFI)
# Installing the system library avoids @denosaurs/plug downloading a native
# binary at runtime, which requires network access and writable env vars.
RUN apt-get update && apt-get install -y --no-install-recommends gosu libsqlite3-0 && rm -rf /var/lib/apt/lists/*

# Copy entrypoint first (changes rarely, keep in its own layer)
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# Copy application files
COPY . .

# Pre-cache Deno deps to make container startup faster; own the cache as root
# (entrypoint will re-own to PUID:PGID at runtime only if needed)
RUN deno cache src/index.ts && chown -R root:root /deno-dir

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD deno run --allow-net --allow-env=HOST,PORT /app/healthcheck.ts

# Default entrypoint (this script sets up /data perms then runs Deno)
ENTRYPOINT ["/app/docker-entrypoint.sh"]
