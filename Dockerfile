FROM denoland/deno:2.7.4

EXPOSE 8000
WORKDIR /app
USER root

# Install gosu (privilege drop) and libsqlite3 (used by @db/sqlite via FFI)
# Installing the system library avoids @denosaurs/plug downloading a native
# binary at runtime, which requires network access and writable env vars.
RUN apt-get update && apt-get install -y --no-install-recommends gosu libsqlite3-0 && rm -rf /var/lib/apt/lists/*

# Copy application files
ADD . .

# Pre-cache Deno deps to make container startup faster
RUN deno cache src/index.ts

# Add and mark the entrypoint script executable
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD deno run --allow-net --allow-env=HOST,PORT /app/healthcheck.ts

# Default entrypoint (this script sets up /data perms then runs Deno)
ENTRYPOINT ["/app/docker-entrypoint.sh"]
