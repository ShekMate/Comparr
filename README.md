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

*Swipe through your Plex library with beautiful movie posters and comprehensive ratings*

> **Note:** Screenshots coming soon! The interface features a modern card-based design with movie posters, ratings from multiple sources, and an intuitive swipe interface.

---

## Quick Start

Get Comparr running in seconds:

```bash
docker run -d \
  --name comparr \
  -p 8000:8000 \
  -e PLEX_URL=http://YOUR_PLEX_SERVER:32400 \
  -e PLEX_TOKEN=YOUR_PLEX_TOKEN \
  -v /path/to/data:/data \
  comparr:latest
```

Then open http://localhost:8000 in your browser!

---

## Installation

### Docker Run

The simplest way to run Comparr:

```bash
docker run -d \
  --name comparr \
  --restart unless-stopped \
  -p 8000:8000 \
  -e PLEX_URL=http://192.168.1.100:32400 \
  -e PLEX_TOKEN=your_plex_token_here \
  -e PUID=1000 \
  -e PGID=1000 \
  -v /path/to/comparr/data:/data \
  comparr:latest
```

### Docker Compose

Create a `docker-compose.yml` file:

```yaml
version: '3.8'

services:
  comparr:
    image: comparr:latest
    container_name: comparr
    restart: unless-stopped
    ports:
      - "8000:8000"
    environment:
      # Required
      - PLEX_URL=http://192.168.1.100:32400
      - PLEX_TOKEN=your_plex_token_here

      # Optional - User/Group
      - PUID=1000
      - PGID=1000

      # Optional - Customization
      - PLEX_LIBRARY_NAME=Movies
      - PORT=8000
      - ACCESS_PASSWORD=

      # Optional - External APIs (for enhanced metadata)
      - TMDB_API_KEY=
      - OMDB_API_KEY=

      # Optional - Media Request Services
      - RADARR_URL=
      - RADARR_API_KEY=
      - JELLYSEERR_URL=
      - JELLYSEERR_API_KEY=
      - OVERSEERR_URL=
      - OVERSEERR_API_KEY=

      # Optional - Advanced
      - LOG_LEVEL=INFO
      - MOVIE_BATCH_SIZE=20
      - LIBRARY_FILTER=
      - COLLECTION_FILTER=

    volumes:
      - /path/to/comparr/data:/data
```

Then run:

```bash
docker-compose up -d
```

### Unraid

1. Go to the **Docker** tab in Unraid
2. Click **Add Container**
3. Configure the following:
   - **Repository**: `comparr:latest`
   - **Port**: `8000` → `8000`
   - **Path**: `/data` → `/mnt/user/appdata/comparr`
   - Add environment variables from the [Configuration](#configuration) section

---

## Configuration

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `PLEX_URL` | Your Plex server URL | `http://192.168.1.100:32400` |
| `PLEX_TOKEN` | Your Plex authentication token | See [Getting Your Plex Token](#getting-your-plex-token) |

### Optional Variables

#### User & Permissions

| Variable | Description | Default |
|----------|-------------|---------|
| `PUID` | User ID to run the container as | `1000` |
| `PGID` | Group ID to run the container as | `1000` |

#### Application Settings

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Internal web server port | `8000` |
| `PLEX_LIBRARY_NAME` | Display name for your Plex library | `My Plex Library` |
| `ACCESS_PASSWORD` | Password to access the app (leave empty for no password) | *(none)* |
| `LOG_LEVEL` | Logging verbosity: `DEBUG`, `INFO`, `WARNING`, `ERROR` | `INFO` |
| `MOVIE_BATCH_SIZE` | Number of movies to load at once | `20` |
| `ROOT_PATH` | Base path if running behind a reverse proxy | *(none)* |

#### Library Filtering

| Variable | Description | Default |
|----------|-------------|---------|
| `DEFAULT_SECTION_TYPE_FILTER` | Filter by media type: `movie` or `show` | `movie` |
| `LIBRARY_FILTER` | Comma-separated list of library names to include | *(all)* |
| `COLLECTION_FILTER` | Comma-separated list of collection names to filter | *(none)* |

#### External API Integrations

| Variable | Description | Required | Get API Key |
|----------|-------------|----------|-------------|
| `TMDB_API_KEY` | The Movie Database API key for metadata | No | [Get TMDb Key](https://www.themoviedb.org/settings/api) |
| `OMDB_API_KEY` | OMDb API key for additional ratings | No | [Get OMDb Key](http://www.omdbapi.com/apikey.aspx) |

#### Media Request Services

| Variable | Description |
|----------|-------------|
| `RADARR_URL` | Radarr server URL (e.g., `http://192.168.1.100:7878`) |
| `RADARR_API_KEY` | Radarr API key |
| `JELLYSEERR_URL` | Jellyseerr server URL |
| `JELLYSEERR_API_KEY` | Jellyseerr API key |
| `OVERSEERR_URL` | Overseerr server URL |
| `OVERSEERR_API_KEY` | Overseerr API key |

#### Advanced Options

| Variable | Description | Default |
|----------|-------------|---------|
| `LINK_TYPE` | Link type for media items | `app` |

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

Integrate with Radarr to request movies not in your library:

```bash
-e RADARR_URL=http://your-radarr:7878
-e RADARR_API_KEY=your_api_key
```

### Jellyseerr / Overseerr

Alternative media request managers:

```bash
# Jellyseerr
-e JELLYSEERR_URL=http://your-jellyseerr:5055
-e JELLYSEERR_API_KEY=your_api_key

# OR Overseerr
-e OVERSEERR_URL=http://your-overseerr:5055
-e OVERSEERR_API_KEY=your_api_key
```

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

Create a `.env` file based on `.env.example`:

```bash
cp .env.example .env
# Edit .env with your configuration
```

---

## Development

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
- Verify `PLEX_URL` is accessible from the container
- Ensure `PLEX_TOKEN` is valid
- Check file permissions on `/data` mount

### Can't Connect to Plex

**Problem:** "Failed to connect to Plex server"

**Solutions:**
- Verify Plex server is running
- Check if `PLEX_URL` uses `http://` (not `https://` unless configured)
- Ensure Plex server allows connections from the Docker network
- Try using the server's IP address instead of hostname

### Movies Not Loading

**Problem:** Session created but no movies appear

**Solutions:**
- Verify your Plex library contains movies
- Check `LIBRARY_FILTER` isn't excluding your library
- Review logs for API errors: `docker logs comparr`
- Ensure TMDb/OMDb API keys are valid (if configured)

### Permission Errors on `/data`

**Problem:** "Permission denied" errors in logs

**Solutions:**
- Set `PUID` and `PGID` to match your host user: `id` command
- Ensure the host `/data` mount point has correct permissions
- Try: `chown -R 1000:1000 /path/to/comparr/data`

### High Memory Usage

**Problem:** Container using excessive memory

**Solutions:**
- Reduce `MOVIE_BATCH_SIZE` to a lower value (e.g., `10`)
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

  **Made with ❤️ for the Plex community**

  If you find Comparr useful, please consider starring the repository!

  [Report Bug](https://github.com/ShekMate/Comparr/issues) • [Request Feature](https://github.com/ShekMate/Comparr/issues)

</div>
