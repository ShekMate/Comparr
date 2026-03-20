FROM denoland/deno:1.38.5

EXPOSE 8000
WORKDIR /app
USER root

# Install gosu (used to drop privileges to PUID/PGID)
RUN apt-get update && apt-get install -y --no-install-recommends gosu && rm -rf /var/lib/apt/lists/*

# Copy application files
ADD . .

# Pre-cache Deno deps to make container startup faster
RUN deno cache src/index.ts

# Add and mark the entrypoint script executable
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD deno eval "const r = await fetch('http://127.0.0.1:8000/api/health'); if (!r.ok) Deno.exit(1);"

# Default entrypoint (this script sets up /data perms then runs Deno)
ENTRYPOINT ["/app/docker-entrypoint.sh"]
