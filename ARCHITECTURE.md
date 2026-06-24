# Comparr — Architecture Overview

> Living document. Update this before writing code for any major feature.

---

## What This Is

Comparr is a **self-hosted Docker app** — think Overseerr / Jellyseerr. One person
installs it and hosts it for themselves and their friends. It is **not** a
multi-tenant SaaS and is **not** the future mobile app (see bottom of this doc).

---

## Deployment Model

```
[Unraid / NAS / VPS]
  └── Comparr Docker container
        ├── Deno/TypeScript backend
        ├── SQLite database
        └── Served at e.g. comparr.myfriend.com (reverse proxy + HTTPS)
```

The person running Docker is the **admin/owner**. They configure the instance.
Everyone else is a **guest user** who visits the URL and creates an account.

---

## User Roles

| Role | Who | Responsibilities |
|------|-----|-----------------|
| Admin | The person who installed Docker | Connects media servers, manages instance settings |
| User | Admin's friends / family | Creates an account, swipes, matches — no server config |

Key point: **media server connections are instance-level, not user-level.**
A guest user visiting `comparr.myfriend.com` swipes from the admin's library.
They never need their own Plex/Emby/Jellyfin account or API key.

---

## Authentication

### Current
- **Plex OAuth** — works well, requires the user to have a Plex account

### Planned
- **Email magic link (OTP)** — user enters email, receives a 6-digit code, no
  password stored ever. Removes the Plex-account requirement for guest users.
  Backend stores: `email`, `otp_hash` (bcrypt), `otp_expires_at`.
- Plex OAuth stays as an option alongside email login.

### Not planned (Docker version)
- Google / Apple OAuth (too much overhead for a self-hosted tool)
- Passwords (magic link is cleaner and more trustworthy)

---

## Media Sources

Connected at the **instance level** by the admin during setup:

- **Plex** — Plex OAuth token + server URL (already implemented)
- **Emby** — server URL + admin API key (already implemented)
- **Jellyfin** — server URL + admin API key (already implemented)
- **TMDb** — API key for metadata enrichment, ratings, and streaming
  availability via JustWatch data (already implemented)

**Per-user streaming preferences** (already implemented):
- Users select their paid streaming subscriptions in Settings
- Swipe deck filters to show only movies available on their services
- "Where to Watch" shown on swipe cards, overview cards, and detail modals
- Free streaming filter also available

Guest users inherit whatever media server sources the admin has connected.
They configure their own streaming service preferences individually.

### Library Sharing (removed)
The old "Share my library" toggle between friends has been removed. It was a
remnant of a room-code era before Plex login existed. Matching now works
purely on swipe history across all connected sources.

---

## Swipe & Matching

- Each user has a personal room code (`U001`, `U002`, etc.) that stores their
  swipe responses
- `sendNextBatch()` serves movies from the instance's connected libraries,
  filtered by user preferences (genre, rating, etc.)
- Friend prioritization: movies already liked by an accepted friend surface
  first in the deck
- `getCompareMatches()` cross-references two users' liked movies using both
  GUID and TMDb ID to handle cross-source matches (Plex GUID ≠ Emby GUID for
  the same film, but TMDb ID matches)

---

## Friends & Matches

- Users add each other by **invite code** (e.g. `UFVHTL`)
- Friend connections are stored in `friend_connections` table with
  `status: pending | accepted`
- Matches tab shows combined matches from all accepted friends, filterable by
  individual friend selection
- All users are on the same instance — cross-instance matching is not planned
  for the Docker version

---

## PWA

The app ships as a PWA. Current state:
- `manifest.json` ✓ (name, icons, theme, standalone display mode)
- Service worker ✗ (needed for Chrome/Android install prompt)

**Install flow for friends**: admin texts them the URL → they open it in mobile
browser → Chrome shows install banner (once service worker is added) → app icon
on home screen, launches full-screen. iOS requires manual Share → Add to Home
Screen (can hint at this in UI).

TODO: add a minimal service worker that caches the app shell so the install
prompt fires on Android.

---

## What This Is NOT

**The Docker version is not the mobile app.** Key differences:

| | Docker (this repo) | Mobile App (future) |
|---|---|---|
| Who installs | Server owner | Anyone |
| Media sources | Admin-configured, instance-level | Per-user, self-configured |
| Auth | Plex OAuth + email magic link | Email magic link + social (Apple/Google?) |
| Emby/Jellyfin | Admin API key at setup | Per-user API key or Quick Connect |
| Streaming availability | Already works — TMDb/JustWatch data, per-user subscription selection, swipe deck filtering | Same |
| Monetization | Free / open source | App store, subscriptions |
| Scope | Plex/Emby/Jellyfin owners and their friends | Anyone with any streaming service |

When building the mobile app, start a new repo and a new architecture doc.
Do not try to make this Docker codebase serve both use cases.

---

## Open Questions

- [ ] Email provider for magic link OTP (Resend? Postmark? Nodemailer + SMTP?)
- [ ] Should admin be able to disable email login and force Plex OAuth only?
- [ ] Service worker caching strategy (app shell only, or include API responses?)
- [ ] Should the admin's own swipe data be separate from the shared library, or
      is the admin just another user on their own instance?
