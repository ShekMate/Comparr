// Shared media-server/API connection validation, used by both the admin settings routes
// (src/infra/http/routes/settings.ts) and the per-user media-server routes
// (src/infra/http/routes/media-server.ts). Extracted so both call sites share one
// implementation and one SSRF policy instead of drifting apart.

import { tmdbFetch } from '../../api/tmdb.ts'
import { fetchWithTimeout } from './fetch-with-timeout.ts'

export const isValidHttpUrl = (value: string) => {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

// Block loopback and link-local ranges from the connection tester.
// Private LAN ranges (192.168.x.x, 10.x.x.x, 172.16-31.x.x) are intentionally
// allowed — Plex, Radarr etc. legitimately live there (including a user's own
// home-network Plex/Emby/Jellyfin server, per-user or admin-configured).
// We only block ranges that have no legitimate target:
//   127.0.0.0/8  — loopback
//   169.254.0.0/16 — link-local / cloud IMDS (AWS, GCP, Azure metadata)
//   ::1           — IPv6 loopback
//   fe80::/10     — IPv6 link-local
export const isSsrfBlockedHostname = (hostname: string): boolean => {
  const h = hostname.trim().toLowerCase()
  if (h === 'localhost' || h === '0.0.0.0') return true
  // IPv6 loopback / link-local
  if (h === '::1' || h === '[::1]') return true
  if (h.startsWith('fe80:') || h.startsWith('[fe80:')) return true
  // IPv4 loopback
  if (/^127\./.test(h)) return true
  // Cloud IMDS link-local (AWS/GCP/Azure/OCI all use 169.254.169.254)
  if (/^169\.254\./.test(h)) return true
  return false
}

export const normalizePlexToken = (token: string) =>
  String(token || '')
    .trim()
    .replace(/^X-Plex-Token=/i, '')

export const normalizePlexUrl = (value: string) => {
  const trimmed = String(value || '')
    .trim()
    .replace(/\/$/, '')
  if (!trimmed) return ''

  try {
    const parsed = new URL(trimmed)
    const normalizedPath = parsed.pathname
      .replace(/\/$/, '')
      .replace(/\/web$/i, '')
      .replace(/\/web\/index\.html$/i, '')

    return `${parsed.origin}${normalizedPath}`.replace(/\/$/, '')
  } catch {
    return trimmed
      .replace(/\/web\/index\.html$/i, '')
      .replace(/\/web$/i, '')
      .replace(/\/$/, '')
  }
}

export const runConnectionCheck = async (
  target: string,
  url: string,
  token: string
): Promise<{ ok: boolean; message: string }> => {
  const normalizedTarget = String(target || '')
    .trim()
    .toLowerCase()
  const normalizedUrl = String(url || '')
    .trim()
    .replace(/\/$/, '')
  const serviceUrl =
    normalizedTarget === 'plex'
      ? normalizePlexUrl(normalizedUrl)
      : normalizedUrl
  const normalizedToken =
    normalizedTarget === 'plex'
      ? normalizePlexToken(token)
      : String(token || '').trim()

  if (normalizedTarget !== 'tmdb' && !isValidHttpUrl(serviceUrl)) {
    return { ok: false, message: 'Invalid URL.' }
  }

  if (normalizedTarget !== 'tmdb') {
    try {
      const { hostname } = new URL(serviceUrl)
      if (isSsrfBlockedHostname(hostname)) {
        return { ok: false, message: 'URL targets a blocked address.' }
      }
    } catch {
      return { ok: false, message: 'Invalid URL.' }
    }
  }

  if (!normalizedToken) {
    return { ok: false, message: 'API key/token is required.' }
  }

  let endpoint = serviceUrl
  let headers: HeadersInit = {}

  if (normalizedTarget === 'plex') {
    endpoint = `${serviceUrl}/library/sections`
    headers = { 'X-Plex-Token': normalizedToken }
  } else if (normalizedTarget === 'radarr') {
    endpoint = `${serviceUrl}/api/v3/system/status`
    headers = { 'X-Api-Key': normalizedToken }
  } else if (normalizedTarget === 'emby') {
    endpoint = `${serviceUrl}/System/Info`
    headers = { 'X-Emby-Token': normalizedToken }
  } else if (normalizedTarget === 'jellyfin') {
    endpoint = `${serviceUrl}/System/Info`
    headers = { 'X-Emby-Token': normalizedToken }
  } else if (normalizedTarget === 'seerr') {
    endpoint = `${serviceUrl}/api/v1/status`
    headers = { 'X-Api-Key': normalizedToken }
  } else if (normalizedTarget === 'tmdb') {
    endpoint = 'https://api.themoviedb.org/3/configuration'
  } else {
    return { ok: false, message: 'Unknown service target.' }
  }

  try {
    const response =
      normalizedTarget === 'tmdb'
        ? await tmdbFetch('/configuration', normalizedToken)
        : await fetchWithTimeout(endpoint, {
            method: 'GET',
            headers,
          })

    if (!response.ok) {
      return {
        ok: false,
        message: `Connection failed with status ${response.status}.`,
      }
    }

    return { ok: true, message: 'Connection successful.' }
  } catch (err) {
    return {
      ok: false,
      message: `Connection failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}
