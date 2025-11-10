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

# Default entrypoint (this script sets up /data perms then runs Deno)
ENTRYPOINT ["/app/docker-entrypoint.sh"]
