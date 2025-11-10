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
