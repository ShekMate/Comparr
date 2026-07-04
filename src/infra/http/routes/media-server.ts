// Per-user personal media server connections (Plex/Emby/Jellyfin) — distinct from the
// instance-wide admin settings in routes/settings.ts. Any authenticated user can connect their
// own server here; nothing here is admin-gated. See ARCHITECTURE note in
// src/features/session/personal-media-sources.ts for how these feed the discovery pipeline.

import type { CompatRequest } from '../compat-request.ts'
import { addSecurityHeaders } from '../security-headers.ts'
import { getUserTokenFromCookie } from './auth.ts'
import { getUserSession } from '../../../core/user-session-store.ts'
import { getUserSettings, upsertUserSettings, UserSettings } from '../../../features/auth/user-db.ts'
import { runConnectionCheck } from '../connection-check.ts'

type Provider = 'plex' | 'emby' | 'jellyfin'

const PROVIDERS: Provider[] = ['plex', 'emby', 'jellyfin']

function isProvider(value: unknown): value is Provider {
  return typeof value === 'string' && (PROVIDERS as string[]).includes(value)
}

const makeJson = (req: CompatRequest) => {
  const h = new Headers({ 'content-type': 'application/json' })
  addSecurityHeaders(h, req)
  return h
}

function getCallerSession(req: CompatRequest) {
  const token = getUserTokenFromCookie(req)
  return token ? getUserSession(token) : null
}

// Maps a provider name to its (url, token, libraryName) fields on UserSettings.
function providerFields(
  provider: Provider
): { urlKey: keyof UserSettings; tokenKey: keyof UserSettings; libraryKey: keyof UserSettings } {
  if (provider === 'plex') {
    return { urlKey: 'plexUrl', tokenKey: 'plexToken', libraryKey: 'plexLibraryName' }
  }
  if (provider === 'emby') {
    return { urlKey: 'embyUrl', tokenKey: 'embyApiKey', libraryKey: 'embyLibraryName' }
  }
  return { urlKey: 'jellyfinUrl', tokenKey: 'jellyfinApiKey', libraryKey: 'jellyfinLibraryName' }
}

export async function handleMediaServerRoutes(
  req: CompatRequest,
  path: string
): Promise<Response | null> {
  // ── GET /api/profile/media-server ─────────────────────────────────────────
  // Per-provider connection status. Never echoes the stored token/API key back.
  if (path === '/api/profile/media-server' && req.method === 'GET') {
    const session = getCallerSession(req)
    if (!session) {
      return new Response(JSON.stringify({ error: 'Not authenticated.' }), {
        status: 401, headers: makeJson(req),
      })
    }

    const settings = getUserSettings(session.userId)
    const status = Object.fromEntries(
      PROVIDERS.map(provider => {
        const { urlKey, tokenKey, libraryKey } = providerFields(provider)
        const url = String(settings?.[urlKey] ?? '')
        const token = String(settings?.[tokenKey] ?? '')
        return [
          provider,
          {
            connected: Boolean(url && token),
            url,
            libraryName: String(settings?.[libraryKey] ?? ''),
          },
        ]
      })
    )

    return new Response(JSON.stringify(status), {
      status: 200, headers: makeJson(req),
    })
  }

  // ── POST /api/profile/media-server/test ───────────────────────────────────
  // Body: { provider, url, token }. Does not persist anything.
  if (path === '/api/profile/media-server/test' && req.method === 'POST') {
    const session = getCallerSession(req)
    if (!session) {
      return new Response(JSON.stringify({ error: 'Not authenticated.' }), {
        status: 401, headers: makeJson(req),
      })
    }

    let body: { provider?: string; url?: string; token?: string } = {}
    try { body = await req.json() } catch { /* empty body ok */ }

    if (!isProvider(body.provider)) {
      return new Response(JSON.stringify({ error: 'Invalid provider.' }), {
        status: 400, headers: makeJson(req),
      })
    }

    const result = await runConnectionCheck(body.provider, body.url || '', body.token || '')
    return new Response(JSON.stringify(result), {
      status: result.ok ? 200 : 400, headers: makeJson(req),
    })
  }

  // ── PUT /api/profile/media-server ─────────────────────────────────────────
  // Body: { provider, url, token, libraryName? }. Re-validates server-side — never trusts a
  // client-reported test result alone.
  if (path === '/api/profile/media-server' && req.method === 'PUT') {
    const session = getCallerSession(req)
    if (!session) {
      return new Response(JSON.stringify({ error: 'Not authenticated.' }), {
        status: 401, headers: makeJson(req),
      })
    }

    let body: { provider?: string; url?: string; token?: string; libraryName?: string } = {}
    try { body = await req.json() } catch { /* empty body ok */ }

    if (!isProvider(body.provider)) {
      return new Response(JSON.stringify({ error: 'Invalid provider.' }), {
        status: 400, headers: makeJson(req),
      })
    }

    const url = String(body.url || '').trim()
    const token = String(body.token || '').trim()
    if (!url || !token) {
      return new Response(JSON.stringify({ error: 'url and token are required.' }), {
        status: 400, headers: makeJson(req),
      })
    }

    const check = await runConnectionCheck(body.provider, url, token)
    if (!check.ok) {
      return new Response(JSON.stringify({ error: check.message }), {
        status: 400, headers: makeJson(req),
      })
    }

    const { urlKey, tokenKey, libraryKey } = providerFields(body.provider)
    upsertUserSettings(session.userId, {
      [urlKey]: url,
      [tokenKey]: token,
      [libraryKey]: String(body.libraryName || ''),
    })

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: makeJson(req),
    })
  }

  // ── DELETE /api/profile/media-server/:provider ────────────────────────────
  const deleteMatch = path.match(/^\/api\/profile\/media-server\/(plex|emby|jellyfin)$/)
  if (deleteMatch && req.method === 'DELETE') {
    const session = getCallerSession(req)
    if (!session) {
      return new Response(JSON.stringify({ error: 'Not authenticated.' }), {
        status: 401, headers: makeJson(req),
      })
    }

    const provider = deleteMatch[1] as Provider
    const { urlKey, tokenKey, libraryKey } = providerFields(provider)
    upsertUserSettings(session.userId, {
      [urlKey]: '',
      [tokenKey]: '',
      [libraryKey]: '',
    })

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: makeJson(req),
    })
  }

  return null
}
