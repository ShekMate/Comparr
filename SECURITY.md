# Security & Privacy

## Your Data is Private

**Comparr runs entirely locally on your server. We have no access to your API keys, tokens, or any other data.**

### How Your Data Stays Secure

1. **Local-Only Execution**: Comparr runs in a Docker container on your own hardware
2. **No Telemetry**: No analytics, tracking, or "phone home" functionality
3. **No External Data Collection**: Your credentials never leave your network
4. **Environment Variables**: All API keys and tokens are stored only in your local container environment
5. **Open Source**: Every line of code is public and auditable on GitHub

### Network Traffic

Comparr ONLY makes requests to:

| Destination | Purpose | Your Data Used |
|------------|---------|----------------|
| Your Plex Server | Fetch your movie library | Plex token (stays local) |
| Your Radarr Server (optional) | Check movie availability | Radarr API key (stays local) |
| Your Jellyseerr/Overseerr (optional) | Submit requests | API key (stays local) |
| api.themoviedb.org | Get movie metadata & posters | Your TMDb API key |
| www.omdbapi.com | Get IMDb ratings | Your OMDb API key |
| datasets.imdbws.com | Download public IMDb datasets | None (public data) |

**We do not operate any servers that receive your data.**

### Verify It Yourself

#### 1. Inspect the Source Code
All code is available at: https://github.com/ShekMate/Comparr

Search the codebase for any suspicious activity:
```bash
# Clone and search for any telemetry/tracking
git clone https://github.com/ShekMate/Comparr.git
cd Comparr
grep -r "analytics\|telemetry\|phone.?home\|tracking" src/
# Returns: No results (except this file)
```

#### 2. Monitor Network Traffic
Watch what the container actually does:
```bash
# View all outgoing connections
docker logs comparr -f

# Monitor network traffic (requires tcpdump)
sudo tcpdump -i any -n 'host not (192.168.0.0/16 or 10.0.0.0/8 or 172.16.0.0/12)' | grep comparr
```

You'll see it only connects to:
- Your local IP addresses (Plex, Radarr, etc.)
- api.themoviedb.org
- www.omdbapi.com
- datasets.imdbws.com (for IMDb data downloads)

#### 3. Inspect the Docker Image
The image contains only the application code and dependencies:
```bash
# See what's in the image
docker run --rm ghcr.io/shekmate/comparr:latest ls -la /app
docker run --rm ghcr.io/shekmate/comparr:latest cat /app/src/index.ts
```

No API keys, no configuration, no secrets.

### Data Storage

All persistent data is stored in your mounted volume (default: `/mnt/user/appdata/Comparr-data`):
- `session-state.json` - Your session data and preferences
- `poster-cache/` - Downloaded movie posters
- `.imdb/` - Cached IMDb datasets

This data never leaves your server.

### API Keys

When you configure Comparr with environment variables:
```yaml
PLEX_TOKEN=your-token-here
OMDB_API_KEY=your-key-here
TMDB_API_KEY=your-key-here
```

These values:
- ✅ Are stored only in your Docker container's environment
- ✅ Are never logged (passwords are masked in XML template)
- ✅ Are never sent to any third-party except the intended API
- ✅ Are not visible to the developer

### Transparency Commitment

We commit to:
- **Never adding telemetry or tracking** of any kind
- **Keeping all code open source** and auditable
- **Clearly documenting** any external network requests
- **Accepting community security audits** and feedback

### Reporting Security Issues

If you discover a security vulnerability, please report it via:
- GitHub Issues: https://github.com/ShekMate/Comparr/issues
- Or email the maintainer privately (see GitHub profile)

We take security seriously and will address any legitimate concerns promptly.

---

## Technical Details

### Architecture

```
┌─────────────────────────────────────────┐
│ Your Server (Unraid/Docker Host)        │
│                                          │
│  ┌────────────────────────────────────┐ │
│  │ Comparr Container                  │ │
│  │                                    │ │
│  │  Reads:                            │ │
│  │  - ENV vars (your API keys)        │ │
│  │  - /data (your local storage)      │ │
│  │                                    │ │
│  │  Connects to:                      │ │
│  │  - Your Plex (local IP)            │ │
│  │  - Your Radarr (local IP)          │ │
│  │  - TMDb API (themoviedb.org)       │ │
│  │  - OMDb API (omdbapi.com)          │ │
│  │  - IMDb datasets (public data)     │ │
│  └────────────────────────────────────┘ │
│                                          │
│  ┌────────────────────────────────────┐ │
│  │ /mnt/user/appdata/Comparr-data     │ │
│  │ (Your data, stored locally)        │ │
│  └────────────────────────────────────┘ │
└─────────────────────────────────────────┘

         No connection to Comparr developer
         No telemetry servers
         No data collection
```

### Code Audit Points

Key files to review for security:

1. **Network requests**: `src/api/*.ts` - All API calls to your services
2. **Configuration**: `src/core/config.ts` - Reads environment variables only
3. **Data storage**: `src/features/session/session.ts` - Local file operations
4. **Main server**: `src/index.ts` - Entry point and request handling

Search for `fetch(` to see every outbound HTTP request - they're all documented above.

### Build Process

The Docker image is built via GitHub Actions:
- `.github/workflows/docker-build.yml` - Automated, public build process
- Published to: `ghcr.io/shekmate/comparr`
- No manual build steps that could inject code

---

**TL;DR: Your API keys and data never leave your server. We can't see them even if we wanted to.**
