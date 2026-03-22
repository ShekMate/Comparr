FROM denoland/deno:2.7.4

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
  CMD deno eval --allow-net --allow-env=HOST,PORT 'const host = (Deno.env.get("HOST") ?? "0.0.0.0").trim() || "0.0.0.0"; const probeHost = host === "0.0.0.0" ? "127.0.0.1" : host; const port = (Deno.env.get("PORT") ?? "8000").trim() || "8000"; const r = await fetch(`http://${probeHost}:${port}/api/health`); if (!r.ok) Deno.exit(1);'

# Default entrypoint (this script sets up /data perms then runs Deno)
ENTRYPOINT ["/app/docker-entrypoint.sh"]
