import { assertEquals } from 'jsr:@std/assert'
import {
  handleSettingsRoutes,
  type SettingsRouteDeps,
} from './settings.ts'

const makeReq = ({
  method = 'POST',
  url = 'http://example.test/api/settings',
  body = '',
  origin = 'http://example.test',
}: {
  method?: string
  url?: string
  body?: string
  origin?: string
}) =>
  ({
    method,
    url,
    headers: new Headers({
      host: 'example.test',
      origin,
      'content-type': 'application/json',
    }),
    conn: { remoteAddr: { hostname: '203.0.113.10' } },
    rawRequest: new Request(url, { method }),
    respond: async () => {},
    respondWith: async () => {},
    text: async () => body,
    json: async () => JSON.parse(body),
  }) as any

const makeDeps = (
  settings: Record<string, unknown>,
  calls: { updates: number; reset: number }
): SettingsRouteDeps => ({
  buildPlexCache: async () => {},
  clearAllMoviesCache: () => {},
  getPlexLibraryName: () => '',
  getEmbyLibraryName: () => '',
  getJellyfinLibraryName: () => '',
  getSettings: () => settings,
  isLocalRequest: () => false,
  refreshRadarrCache: async () => {},
  updateSettings: async () => {
    calls.updates += 1
    return settings
  },
  resetSettings: async () => {
    calls.reset += 1
    return settings
  },
  getAllRooms: () => ({}),
  clearAllRooms: () => {},
  clearRooms: () => {},
  clearUsersFromRoom: () => {},
})

Deno.test(
  'setup mode allows remote admin settings writes during wizard',
  async () => {
    Deno.env.delete('ALLOW_REMOTE_BOOTSTRAP')
    const calls = { updates: 0, reset: 0 }
    const settings = { SETUP_WIZARD_COMPLETED: 'false', ADMIN_PASSWORD: '' }

    const response = await handleSettingsRoutes(
      makeReq({
        body: JSON.stringify({ settings: { PLEX_TOKEN: 'secret' } }),
      }),
      '/api/settings',
      makeDeps(settings, calls)
    )

    assertEquals(response?.status, 200)
    assertEquals(calls.updates, 1)
  }
)

Deno.test(
  'setup mode allows admin password write without ALLOW_REMOTE_BOOTSTRAP',
  async () => {
    Deno.env.delete('ALLOW_REMOTE_BOOTSTRAP')
    const calls = { updates: 0, reset: 0 }
    const settings = { SETUP_WIZARD_COMPLETED: 'false', ADMIN_PASSWORD: '' }

    const response = await handleSettingsRoutes(
      makeReq({
        body: JSON.stringify({ settings: { ADMIN_PASSWORD: 'new-secret' } }),
      }),
      '/api/settings',
      makeDeps(settings, calls)
    )

    assertEquals(response?.status, 200)
    assertEquals(calls.updates, 1)
  }
)

Deno.test(
  'completed wizard blocks unauthorized remote admin settings writes',
  async () => {
    const calls = { updates: 0, reset: 0 }
    const settings = {
      SETUP_WIZARD_COMPLETED: 'true',
      ADMIN_PASSWORD: 'pbkdf2:sha256:100000:aabbcc:ddeeff',
    }

    const response = await handleSettingsRoutes(
      makeReq({
        body: JSON.stringify({ settings: { PLEX_TOKEN: 'secret' } }),
      }),
      '/api/settings',
      makeDeps(settings, calls)
    )

    assertEquals(response?.status, 403)
    assertEquals(calls.updates, 0)
  }
)
