# Comparr Repository Audit

**Generated**: 2026-03-23
**Repo**: `/home/user/Comparr_dev`
**Total Files**: ~161

---

## Root Configuration

| File | Ext | Purpose |
|------|-----|---------|
| `package.json` | JSON | NPM package config — defines dev dependencies (vitest, prettier, stylelint) and build/lint/test/format scripts |
| `package-lock.json` | JSON | NPM lock file — pins exact dependency versions for reproducible installs |
| `deno.json` | JSON | Deno runtime config — compiler options, lint rules, formatter settings, and test config for backend TS code |
| `vitest.config.js` | JS | Vitest config — sets test environment (happy-dom), coverage provider (v8), and test file locations |
| `test-setup.js` | JS | Global Vitest setup — provides mock WebSocket and mutes console methods during tests |
| `.env.example` | — | Environment variable template — documents all configurable options (Plex, API keys, ports, runtime flags) |
| `.gitignore` | — | Git ignore rules — excludes node_modules, .env, build artifacts, IDE configs, data dirs |
| `.dockerignore` | — | Docker build context exclusions — reduces image size by ignoring git, docs, node_modules, dev artifacts |

---

## Docker & Deployment

| File | Ext | Purpose |
|------|-----|---------|
| `Dockerfile` | Dockerfile | Multi-stage container definition — uses denoland/deno, installs libsqlite3, caches deps, configures health check |
| `docker-entrypoint.sh` | Shell | Container entrypoint — manages PUID/PGID user creation, sets up /data permissions, resolves SQLite3 path, launches Deno |
| `comparr.xml` | XML | Unraid container template — defines web UI port, data volume mapping, and env variable inputs for Unraid UI |
| `healthcheck.ts` | TS | Docker health check — performs HTTP GET to `/api/health` to verify container health |

---

## Documentation

| File | Location | Ext | Purpose |
|------|----------|-----|---------|
| `README.md` | `/` | MD | Main project docs — features, Docker/Unraid install, config guide, API integrations, troubleshooting, dev setup |
| `LICENSE` | `/` | — | Apache 2.0 license — covers Comparr and its derivation from MovieMatch |
| `HEALTH_CHECK.md` | `/` | MD | Repo health check log — records testing status, coverage results, and Deno dependency notes |
| `TESTING.md` | `/` | MD | Testing guide — documents Deno + Vitest infrastructure, coverage goals, how to write tests, CI/CD integration |
| `TEST_SUMMARY.md` | `/` | MD | Test coverage summary — lists all test files, coverage targets by module, CI/CD details, maintenance notes |
| `repo-architecture-roadmap.md` | `docs/` | MD | Architecture planning — incremental refactoring roadmap with target directory structure and rules |
| `docker-compose.md` | `docs/` | MD | Docker Compose guide — example compose config and env var setup |
| `reverse-proxy.md` | `docs/` | MD | Reverse proxy configuration docs |
| `security-review-claude-plan.md` | `docs/` | MD | Security review planning document |
| `security-fix-status.md` | `docs/` | MD | Status tracker for security fixes |
| `security-feedback-assessment.md` | `docs/` | MD | Assessment and feedback on security implementations |
| `merge-resolution-note.md` | `docs/` | MD | Notes on resolving merge conflicts |
| `desktop-drag-to-swipe-requirements.md` | `docs/` | MD | Desktop swipe gesture implementation requirements |
| `swipe-screen-sizing.md` | `docs/` | MD | Swipe screen sizing and responsive design notes |
| `swipe-discover-conflict-guide.md` | `docs/` | MD | Guide for resolving swipe vs. discover feature conflicts |
| `comparr-rating-reimplementation.md` | `docs/` | MD | Rating system reimplementation documentation |

---

## GitHub Configuration

| File | Location | Ext | Purpose |
|------|----------|-----|---------|
| `test.yml` | `.github/workflows/` | YAML | CI workflow — runs Deno + Vitest tests on push/PR, uploads coverage to Codecov, comments results on PRs |
| `docker.yml` | `.github/workflows/` | YAML | Docker workflow — builds multi-platform images and pushes to GHCR on push to main |
| `bug-report.md` | `.github/ISSUE_TEMPLATE/` | MD | Bug report issue template — structured format for reproduction steps, expected behavior, environment |
| `feature_request.md` | `.github/ISSUE_TEMPLATE/` | MD | Feature request issue template — structured format for proposals and alternatives |

---

## Internationalization (`i18n/`)

| File | Ext | Purpose |
|------|-----|---------|
| `en.json` | JSON | English UI translation strings |
| `es.json` | JSON | Spanish UI translation strings |
| `fr.json` | JSON | French UI translation strings |
| `de.json` | JSON | German UI translation strings |
| `it.json` | JSON | Italian UI translation strings |
| `ja.json` | JSON | Japanese UI translation strings |
| `ko.json` | JSON | Korean UI translation strings |
| `nl.json` | JSON | Dutch UI translation strings |
| `pt-BR.json` | JSON | Brazilian Portuguese UI translation strings |
| `ru.json` | JSON | Russian UI translation strings |
| `zh-CN.json` | JSON | Simplified Chinese UI translation strings |

---

## Backend Source (`src/`)

### Entry Point

| File | Location | Ext | Purpose |
|------|----------|-----|---------|
| `index.ts` | `src/` | TS | App entry point — initializes error handlers, sets up HTTP/WebSocket server, routes, sessions, startup/shutdown |

### Core Module (`src/core/`)

| File | Ext | Purpose |
|------|-----|---------|
| `config.ts` | TS | Config management — reads/normalizes env vars for Plex/Emby/Jellyfin URLs, API keys, ports, library names |
| `env.ts` | TS | Env utilities — data directory config and path resolution for persistent storage |
| `settings.ts` | TS | Settings management — loads, saves, resets app settings persisted to `/data/settings.json` via SQLite |
| `persistence.ts` | TS | Persistence layer — SQLite operations for session state and other persistent data |
| `security.ts` | TS | Security utilities — timing-safe password verification and cryptographic helpers |
| `assert.ts` | TS | Assertion utilities — runtime validation with detailed error messages |
| `i18n.ts` | TS | i18n module — loads and provides translation strings for multiple languages |
| `rate-limiter.ts` | TS | Rate limiter — controls login attempts and other rate-controlled operations |
| `state.ts` | TS | Global state management |
| `streamingProfileSettings.ts` | TS | Streaming profile settings — availability filtering based on user's streaming services |

### Core Tests (`src/core/__tests__/`)

| File | Ext | Purpose |
|------|-----|---------|
| `config.test.ts` | TS | Tests for config module — validation and URL normalization |
| `settings.test.ts` | TS | Tests for settings persistence and retrieval |

### API Module (`src/api/`)

| File | Ext | Purpose |
|------|-----|---------|
| `plex.ts` | TS | Plex API client — library fetching, movie retrieval, filtering, error handling |
| `plex.types.ts` | TS | Plex API type definitions |
| `tmdb.ts` | TS | TMDb API client — movie metadata, ratings, and genre info |
| `radarr.ts` | TS | Radarr API client — movie availability checks and requests; includes caching |
| `jellyseerr.ts` | TS | Jellyseerr API client — media requests for Jellyfin/Emby environments |

### API Tests (`src/api/__tests__/`)

| File | Ext | Purpose |
|------|-----|---------|
| `plex.test.ts` | TS | Tests for Plex API client — library fetching, filtering, error handling, random selection |

### Test Utilities & Mocks (`src/__tests__/`)

| File | Location | Ext | Purpose |
|------|----------|-----|---------|
| `test-helpers.ts` | `utils/` | TS | Testing helpers — mock fetch, env vars, and WebSocket |
| `plex-mocks.ts` | `mocks/` | TS | Mock Plex API response data |
| `tmdb-mocks.ts` | `mocks/` | TS | Mock TMDb API response data |
| `omdb-mocks.ts` | `mocks/` | TS | Mock OMDb API response data |

### Features Module (`src/features/`)

| File | Location | Ext | Purpose |
|------|----------|-----|---------|
| `discover.ts` | `catalog/` | TS | Movie discovery — batch fetching and filtering from media servers |
| `enrich.ts` | `catalog/` | TS | Enrichment pipeline — merges metadata from Plex, TMDb, OMDb; aggregates IMDb, RT, TMDb ratings |
| `imdb-datasets.ts` | `catalog/` | TS | IMDb dataset management — initializes and updates IMDb data for ratings/metadata |
| `enrich.test.ts` | `catalog/__tests__/` | TS | Tests for enrichment pipeline — rating aggregation, fallback handling, error cases |
| `session.ts` | `session/` | TS | Session management — multi-user session creation, login, user management, WebSocket comms |
| `imdb-import.ts` | `session/` | TS | IMDb watchlist import — allows users to import IMDb ratings into sessions |
| `session-matching.test.ts` | `session/__tests__/` | TS | Tests for matching algorithm — 2-user, N-user, and complex voting logic |
| `imdb-import.test.ts` | `session/__tests__/` | TS | Tests for IMDb import functionality |
| `streaming-update.ts` | `streaming/` | TS | Streaming availability updates — shows where movies can be watched |
| `poster-validation.ts` | `media/` | TS | Poster validation and processing for movie cards |

### Infrastructure Module (`src/infra/`)

| File | Location | Ext | Purpose |
|------|----------|-----|---------|
| `router.ts` | `http/` | TS | HTTP request router — main dispatcher for all API endpoints |
| `compat-request.ts` | `http/` | TS | Request compatibility utilities — normalizes different request types |
| `staticFileServer.ts` | `http/` | TS | Static file server — serves frontend HTML, CSS, JS assets |
| `fetch-with-timeout.ts` | `http/` | TS | Fetch wrapper with configurable timeouts for external API calls |
| `security-headers.ts` | `http/` | TS | HTTP security headers — CSP, X-Frame-Options, etc. |
| `ip-rate-limiter.ts` | `http/` | TS | IP-based rate limiting for API endpoints |
| `network-access.ts` | `http/` | TS | Network access control — origin/host validation |
| `audit.ts` | `http/` | TS | Audit logging for sensitive operations |
| `network-access.test.ts` | `http/` | TS | Tests for network access control |
| `config.ts` | `http/routes/` | TS | Debug config endpoint — displays current configuration |
| `matches.ts` | `http/routes/` | TS | Endpoint for retrieving matched movies from a session |
| `rooms.ts` | `http/routes/` | TS | Endpoints for room management (list, delete) |
| `settings.ts` | `http/routes/` | TS | Endpoints for application settings management |
| `streaming.ts` | `http/routes/` | TS | Endpoints for streaming availability info |
| `movie-refresh.ts` | `http/routes/` | TS | Endpoint for refreshing movie cache data |
| `request-service.ts` | `http/routes/` | TS | Endpoints for media request services (Radarr, Jellyseerr, Overseerr) |
| `request-movie.ts` | `http/routes/` | TS | Endpoint for requesting a specific movie via request services |
| `imdb-import.ts` | `http/routes/` | TS | Endpoint for IMDb watchlist import |
| `websocketServer.ts` | `ws/` | TS | WebSocket server — real-time comms for rating, matching, and session updates |
| `streamingProvidersMapping.ts` | `constants/` | TS | Streaming provider codes → display names and logos mapping |

### Integrations (`src/integrations/`)

| File | Location | Ext | Purpose |
|------|----------|-----|---------|
| `media-server-cache.ts` | `shared/` | TS | Base cache shared by Plex, Emby, and Jellyfin integrations |
| `cache.ts` | `plex/` | TS | Plex-specific media server cache |
| `cache.ts` | `emby/` | TS | Emby-specific media server cache |
| `cache.ts` | `jellyfin/` | TS | Jellyfin-specific media server cache |

### Services (`src/services/`)

| File | Location | Ext | Purpose |
|------|----------|-----|---------|
| `poster-cache.ts` | `cache/` | TS | Poster image caching service with size limits |

---

## Frontend Source (`public/`)

### HTML & CSS

| File | Location | Ext | Purpose |
|------|----------|-----|---------|
| `index.html` | `public/` | HTML | SPA entry point — meta tags, mobile viewport, favicon links, root mount div |
| `style.css` | `public/` | CSS | Main stylesheet aggregator — imports mobile, tablet, desktop responsive sheets |
| `main.css` | `public/styles/` | CSS | Core styles — base variables and common component styles |
| `mobile.css` | `public/styles/` | CSS | Mobile responsive styles (≤768px) |
| `tablet.css` | `public/styles/` | CSS | Tablet responsive styles (769–1024px) |
| `desktop.css` | `public/styles/` | CSS | Desktop responsive styles (>1024px) |

### JavaScript

| File | Location | Ext | Purpose |
|------|----------|-----|---------|
| `main.js` | `public/js/` | JS | App entry — initializes CardView and MatchesView, manages CSRF token, coordinates app flow |
| `ComparrAPI.js` | `public/js/` | JS | WebSocket client — handles login, batch requests, rating submissions, and event handling |
| `CardView.js` | `public/js/` | JS | Movie card component — renders posters with ratings, handles swipe gestures and card interactions |
| `MatchesView.js` | `public/js/` | JS | Matches component — displays mutually liked movies, provides movie request functionality |
| `utils.js` | `public/js/` | JS | Shared UI and data utility functions |
| `room-code-fallback.js` | `public/js/` | JS | Fallback mechanism for room code retrieval |

### JavaScript Tests

| File | Location | Ext | Purpose |
|------|----------|-----|---------|
| `ComparrAPI.test.js` | `public/js/__tests__/` | JS | Tests for WebSocket client — login, message handling, event emission |

### Assets — Icons (`public/assets/icons/`)

| File | Ext | Purpose |
|------|-----|---------|
| `favicon.ico` | ICO | Browser tab favicon |
| `favicon-16x16.png` | PNG | 16px favicon |
| `favicon-32x32.png` | PNG | 32px favicon |
| `favicon-96x96.png` | PNG | 96px favicon |
| `favicon-512x512.png` | PNG | 512px favicon / PWA icon |
| `apple-icon.png` | PNG | Default Apple touch icon |
| `apple-icon-precomposed.png` | PNG | Apple touch icon (no rounding) |
| `apple-icon-57x57.png` | PNG | Apple icon 57px |
| `apple-icon-60x60.png` | PNG | Apple icon 60px |
| `apple-icon-72x72.png` | PNG | Apple icon 72px |
| `apple-icon-76x76.png` | PNG | Apple icon 76px |
| `apple-icon-114x114.png` | PNG | Apple icon 114px |
| `apple-icon-120x120.png` | PNG | Apple icon 120px |
| `apple-icon-144x144.png` | PNG | Apple icon 144px |
| `apple-icon-152x152.png` | PNG | Apple icon 152px |
| `apple-icon-180x180.png` | PNG | Apple icon 180px |
| `android-icon-36x36.png` | PNG | Android icon 36px |
| `android-icon-48x48.png` | PNG | Android icon 48px |
| `android-icon-72x72.png` | PNG | Android icon 72px |
| `android-icon-96x96.png` | PNG | Android icon 96px |
| `android-icon-144x144.png` | PNG | Android icon 144px |
| `android-icon-192x192.png` | PNG | Android icon 192px |
| `ms-icon-70x70.png` | PNG | Microsoft tile icon 70px |
| `ms-icon-144x144.png` | PNG | Microsoft tile icon 144px |
| `ms-icon-150x150.png` | PNG | Microsoft tile icon 150px |
| `ms-icon-310x310.png` | PNG | Microsoft tile icon 310px |

### Assets — Logos (`public/assets/logos/`)

| File | Ext | Purpose |
|------|-----|---------|
| `comparr.svg` | SVG | Comparr main logo (vector) |
| `comparrlogo.png` | PNG | Comparr main logo (raster) |
| `netflix.svg` | SVG | Netflix streaming service logo |
| `disney.svg` | SVG | Disney+ streaming service logo |
| `hulu.svg` | SVG | Hulu streaming service logo |
| `appletv.svg` | SVG | Apple TV+ streaming service logo |
| `max.svg` | SVG | Max (HBO) streaming service logo |
| `paramount.svg` | SVG | Paramount+ streaming service logo |
| `peacock.svg` | SVG | Peacock streaming service logo |
| `prime.svg` | SVG | Prime Video streaming service logo |
| `allvids.svg` | SVG | AllVids streaming service logo |
| `tmdb.svg` | SVG | TMDb (The Movie Database) logo |
| `imdb.svg` | SVG | IMDb logo |
| `justwatch.svg` | SVG | JustWatch logo |
| `rottentomatoes.svg` | SVG | Rotten Tomatoes logo |

### Assets — Misc (`public/assets/`)

| File | Ext | Purpose |
|------|-----|---------|
| `troll_bridge_keeper.png` | PNG | Easter egg / theme image asset |

---

## Build Scripts (`scripts/`)

| File | Ext | Purpose |
|------|-----|---------|
| `run-deno-lint.js` | JS | Node.js wrapper for Deno linter — runs deno lint as part of npm lint pipeline with graceful fallback |

---

## Testing Images (`testing/`)

| File | Ext | Purpose |
|------|-----|---------|
| `watchscreen.png` | PNG | UI screenshot for visual testing reference |
| `watchscreen2.png` | PNG | Additional UI screenshot for visual testing reference |
| `loadingmessage1.png` | PNG | Screenshot of loading state for visual testing reference |

---

## Architecture Summary

**Stack**:
- Backend: Deno + TypeScript
- Frontend: Vanilla JavaScript (no framework)
- Database: SQLite (via Deno FFI)
- Testing: Deno Test (backend) + Vitest (frontend)
- Container: Docker (multi-stage, multi-platform)
- CI/CD: GitHub Actions

**Integrations**:
- Media servers: Plex, Emby, Jellyfin
- Metadata: TMDb, OMDb, IMDb datasets
- Request services: Radarr, Jellyseerr, Overseerr
- Streaming availability: JustWatch (via TMDb)

**What it does**: Comparr is a Tinder-style movie matching app for home media servers. Multiple users join a room, each swipes yes/no on movies from their Plex/Emby/Jellyfin library, and when all users agree the movie is surfaced as a match. Supports real-time multiplayer via WebSocket, enriched metadata from external APIs, and movie request services.
