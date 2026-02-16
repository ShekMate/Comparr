# Docker Compose

```yaml
version: '3'
services:
  comparr:
   image: shekmate/comparr:latest
   container_name: comparr
   environment:
    PLEX_URL: "<Plex URL>"
    PLEX_TOKEN: "<Plex Token>"
   ports:
      - 8000:8000
```

If your Plex server is hosted at `https://plex.example.com`, and your token was `abc123` for example, your environment would look like this:

```yaml
environment:
  PLEX_URL: "https://plex.example.com"
  PLEX_TOKEN: "abc123"
```

If you want to use an [env file](https://github.com/ShekMate/comparr/blob/main/.env-template) instead of passing variables via environment, you can use that with docker-compose using the [`env_file`](https://docs.docker.com/compose/compose-file/compose-file-v3/#env_file) option.


After the initial setup, open Comparr's **Settings** page and save your configuration there. Comparr writes these values to `/data/settings.json`, so most app settings (Plex, metadata providers, request services, filtering, security, and sync options) can be removed from Docker container environment variables once they are saved in the UI.

Keep only container/runtime environment variables (for example `PUID`, `PGID`, and optionally `DATA_DIR`) in your container settings.
