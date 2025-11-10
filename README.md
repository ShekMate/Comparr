Copyright 2025 ShekMate
Originally derived from MovieMatch by Luke Channings

# Comparr

Comparr helps you and your friends decide what to watch from your Plex library.
It’s a lightweight Deno app that runs entirely in Docker.

---

## Quick Start

```bash
docker run -d --name comparr \
  -p 8000:8000 \
  -e PLEX_URL=http://YOUR_PLEX_SERVER:32400 \
  -e PLEX_TOKEN=YOUR_PLEX_TOKEN \
  comparr:latest
The container will start automatically using its built-in entrypoint.

Ratings and session data are stored in /data inside the container (mount it if you want persistence).

| Variable | Description | Required | Default |
|-----------|--------------|-----------|----------|
| PLEX_URL | Plex server URL | ✅ | — |
| PLEX_TOKEN | Plex authentication token | ✅ | — |
| PUID | User ID to run as | Optional | 1000 |
| PGID | Group ID to run as | Optional | 1000 |
| PORT | Internal web port | Optional | 8000 |


All other variables (TMDb, OMDb, Radarr, etc.) can also be added in your Unraid Docker template if you use those integrations.

License
Licensed under the Apache License 2.0
Originally derived from MovieMatch by Luke Channings, heavily rewritten and rebranded as Comparr by ShekMate.
