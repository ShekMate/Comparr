<div align="center">
  <img src="public/assets/logos/comparrlogo.png" alt="Comparr Logo" width="200"/>

# Comparr

**A Modern Tinder-Style Movie Matcher for Plex**

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/docker-ready-brightgreen.svg)](https://www.docker.com/)
[![Deno](https://img.shields.io/badge/deno-1.38.5-blue.svg)](https://deno.land/)

Help you and your friends decide what to watch from your Plex library with an intuitive swipe-based interface.

[Features](#features) • [Quick Start](#quick-start) • [Installation](#installation) • [Configuration](#configuration) • [Usage](#usage)

</div>

---

## Table of Contents

- [Features](#features)
- [Screenshots](#screenshots)
- [Quick Start](#quick-start)
- [Installation](#installation)
  - [Docker Run](#docker-run)
  - [Docker Compose](#docker-compose)
  - [Unraid](#unraid)
- [Configuration](#configuration)
  - [Required Variables](#required-variables)
  - [Optional Variables](#optional-variables)
  - [Getting Your Plex Token](#getting-your-plex-token)
- [Data Persistence](#data-persistence)
- [Usage](#usage)
- [Integrations](#integrations)
- [Building from Source](#building-from-source)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)
- [Acknowledgments](#acknowledgments)

---

## Features

🎬 **Tinder-Style Matching** - Swipe right on movies you want to watch, left on ones you don't

👥 **Multi-User Sessions** - Create rooms where friends and family can vote together

🎯 **Smart Matching** - Automatically shows you what everyone agrees on

📊 **Rich Metadata** - Displays ratings from IMDb, Rotten Tomatoes, TMDb, and OMDb

📝 **Personal Lists** - Track your Watch, Pass, and Seen lists with the ability to move movies between them

↩️ **Undo Support** - Made a mistake? Undo your last rating with one click

🌍 **Multi-Language UI** - Core interface translated into 11 languages (English, Spanish, French, German, Italian, Japanese, Korean, Dutch, Portuguese, Russian, Chinese)

🔐 **Access Control** - Optional password protection for your instance

🎥 **Library Filtering** - Filter by specific Plex libraries or collections

📱 **Mobile Friendly** - Responsive design works great on phones and tablets

🔗 **Media Request Integration** - Works with Radarr, Jellyseerr, and Overseerr for requesting unavailable content

🐳 **Docker Native** - Runs entirely in a lightweight Docker container

---

## Screenshots

_Swipe through your Plex library with beautiful movie posters and comprehensive ratings_

> **Note:** Screenshots coming soon! The interface features a modern card-based design with movie posters, ratings from multiple sources, and an intuitive swipe interface.

---

## Quick Start

```bash
docker compose up -d
```

Then open http://localhost:8000 and the setup wizard will walk you through connecting your Plex server.

---

## Installation

### Docker Compose (recommended)

Download the `docker-compose.yml` from this repo, then:

```bash
docker compose up -d
```

That's it. Open http://localhost:8000 and follow the setup wizard.

By default data is stored in a `./data` folder next to the compose file. To use a different location, edit the volume in `docker-compose.yml`:

```yaml
volumes:
  - /path/to/your/data:/data
```

### Docker Run

```bash
docker run -d \
  --name comparr \
  --restart unless-stopped \
  -p 8000:8000 \
  -e PUID=1000 \
  -e PGID=1000 \
  -v /path/to/comparr/data:/data \
  ghcr.io/shekmit/comparr:latest
```

### Unraid

1. Go to the **Docker** tab in Unraid
2. Click **Add Container**
3. Configure the following:
   - **Repository**: `ghcr.io/shekmit/comparr:latest`
   - **Port**: `8000` → `8000`
   - **Path**: `/data` → `/mnt/user/appdata/comparr`
   - **PUID** / **PGID**: set to match your Unraid user (run `id` in terminal)
4. Start the container and open the web UI to complete setup

### Image Tags

- `ghcr.io/shekmit/comparr:latest` → latest stable release
- `ghcr.io/shekmit/comparr:<version>` → pinned immutable release tag

---

## Configuration

All application settings (Plex connection, API keys, passwords, etc.) are configured through the **web UI** and persisted in `/data/settings.json` on your mounted volume. No environment variables needed for app settings.

The setup wizard runs automatically on first boot.

### Container Variables

These are the only environment variables Comparr uses — they control how the container runs, not the app itself:

| Variable   | Description                        | Default |
| ---------- | ---------------------------------- | ------- |
| `PUID`     | User ID to run the container as    | `1000`  |
| `PGID`     | Group ID to run the container as   | `1000`  |
| `PORT`     | Port the server listens on         | `8000`  |
| `DATA_DIR` | Path inside the container for data | `/data` |

### Advanced / Reverse Proxy Variables

| Variable          | Description                                            | Default   |
| ----------------- | ------------------------------------------------------ | --------- |
| `TRUST_PROXY`     | Set `true` if behind a trusted reverse proxy           | `false`   |
| `ALLOWED_ORIGINS` | Comma-separated allowed origins for Host/Origin checks | _(all)_   |
| `MAX_BODY_SIZE`   | Max HTTP request body in bytes                         | `1048576` |
| `FRAME_ANCESTORS` | CSP `frame-ancestors` value                            | `'none'`  |

### Getting Your Plex Token

Your Plex token is required for Comparr to access your Plex server. Here's how to find it:

1. **Open Plex Web App** in your browser
2. **Play any media item** and open the player
3. Click the **⚙️ Settings icon** (or three dots menu)
4. Select **"Get Info"** or **"View XML"**
5. Look in the URL bar - you'll see `X-Plex-Token=XXXXXXXXXXXXX`
6. Copy everything after `X-Plex-Token=`

**Alternative Method:**

- Open your browser's Developer Tools (F12)
- Go to the Network tab
- Refresh Plex
- Look for any request and find the `X-Plex-Token` header

> ⚠️ **Keep your token secure!** Don't share it publicly or commit it to version control.

---

## Data Persistence

Comparr stores session data and ratings in `/data` inside the container. To preserve this data across container updates:

```bash
-v /path/to/comparr/data:/data
```

**What's stored:**

- User voting sessions
- Match results
- User preferences
- Cached metadata

**Backup Recommendation:** Periodically back up the `/data` directory to prevent loss of session history.

---

## Usage

### Creating a Session

1. Navigate to `http://your-server:8000`
2. Click **"Create New Session"**
3. Choose your Plex library
4. Share the session link with friends

### Joining a Session

1. Open the session link shared by a friend
2. Start rating movies with three options:
   - **👍 Watch** - Want to watch this
   - **👎 Pass** - Not interested
   - **👁️ Seen** - Already watched this
3. **Undo** - Made a mistake? Click the undo button in the top-left

### Viewing Matches

1. Click **"View Matches"** in the session
2. See all movies that everyone voted yes on
3. Click a movie to open it in Plex or request it via Radarr/Jellyseerr/Overseerr

### Managing Your Lists

1. Access the dropdown menu to view:
   - **Watch List** - Movies you want to watch
   - **Pass List** - Movies you're not interested in
   - **Seen List** - Movies you've already watched
2. Move movies between lists using the action buttons on each card
3. Your lists persist across sessions

---

## Integrations

### TMDb & OMDb

Enhance your movie cards with additional metadata and ratings:

- **TMDb**: Provides comprehensive movie information, posters, and ratings
- **OMDb**: Adds IMDb and Rotten Tomatoes ratings

Both are optional but highly recommended for the best experience.

### Radarr

Integrate with Radarr to request movies not in your library. Add your Radarr URL and API key in the **Settings → Integrations** page of the web UI.

### Jellyseerr / Overseerr

Alternative media request managers. Add your Jellyseerr or Overseerr URL and API key in **Settings → Integrations**.

---

## Building from Source

### Prerequisites

- [Deno](https://deno.land/) 1.38.5 or later
- [Docker](https://www.docker.com/) (for containerization)
- [Node.js](https://nodejs.org/) (for frontend tooling)

### Clone and Build

```bash
# Clone the repository
git clone https://github.com/ShekMate/Comparr.git
cd Comparr

# Run locally with Deno
deno run --allow-net --allow-read --allow-env --allow-write src/index.ts

# Or build Docker image
docker build -t comparr:latest .
```

### Environment Setup

No `.env` file is needed. Start the server and configure everything through the web UI at http://localhost:8000.

---

## Development

For an incremental refactor plan, see [Repository Architecture Roadmap](docs/repo-architecture-roadmap.md).

### Running Tests

```bash
# Backend tests (Deno)
deno task test

# Frontend tests (Vitest)
npm run test:frontend

# Run all tests
npm test
```

### Code Coverage

```bash
npm run coverage
```

### Linting & Formatting

```bash
# Lint all code
npm run lint

# Format code
npm run format
```

---

## Troubleshooting

### Container Won't Start

**Problem:** Container exits immediately after starting

**Solutions:**

- Check logs: `docker logs comparr`
- Check file permissions on `/data` mount
- Verify `PUID`/`PGID` are set correctly

### Can't Connect to Plex

**Problem:** "Failed to connect to Plex server"

**Solutions:**

- Verify Plex server is running
- In Settings, check that the Plex URL uses `http://` (not `https://` unless configured)
- Ensure Plex server allows connections from the Docker network
- Try using the server's IP address instead of hostname

### Movies Not Loading

**Problem:** Session created but no movies appear

**Solutions:**

- Verify your Plex library contains movies
- Check the Library Filter setting in the web UI isn't excluding your library
- Review logs for API errors: `docker logs comparr`
- Ensure TMDb/OMDb API keys are valid if configured in Settings

### Permission Errors on `/data`

**Problem:** "Permission denied" errors in logs

**Solutions:**

- Set `PUID` and `PGID` in your compose file to match your host user (`id` command)
- Ensure the host `/data` mount point has correct permissions
- Try: `chown -R 1000:1000 /path/to/comparr/data`

### High Memory Usage

**Problem:** Container using excessive memory

**Solutions:**

- Reduce the Movie Batch Size setting in the web UI (e.g., `10`)
- Check if you have large libraries (thousands of movies)
- Monitor logs for errors that might cause memory leaks

---

## Contributing

Contributions are welcome! Here's how you can help:

1. **Fork the repository**
2. **Create a feature branch**: `git checkout -b feature/amazing-feature`
3. **Commit your changes**: `git commit -m 'Add amazing feature'`
4. **Push to the branch**: `git push origin feature/amazing-feature`
5. **Open a Pull Request**

### Development Guidelines

- Follow the existing code style
- Run tests before submitting: `npm test`
- Update documentation for new features
- Keep commits atomic and well-described

---

## License

Licensed under the **Apache License 2.0**. See [LICENSE](LICENSE) for details.

---

## Acknowledgments

Originally derived from [MovieMatch](https://github.com/LukeChannings/moviematch) by Luke Channings.

Heavily rewritten and rebranded as **Comparr** by [ShekMate](https://github.com/ShekMate).

### Special Thanks

- **Luke Channings** - Original MovieMatch creator
- **Plex** - For the amazing media server platform
- **TMDb** - For comprehensive movie metadata
- **OMDb** - For additional rating data
- All contributors and users of Comparr

---

<div align="center">

**Made with ❤️ for the Plex and Unraid community**

If you find Comparr useful, please consider starring the repository!

[Report Bug](https://github.com/ShekMate/Comparr/issues) • [Request Feature](https://github.com/ShekMate/Comparr/issues)

</div>
