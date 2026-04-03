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
  'setup mode blocks remote admin settings writes by default',
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

    assertEquals(response?.status, 403)
    assertEquals(calls.updates, 0)
  }
)

Deno.test(
  'setup mode still allows remote ADMIN_PASSWORD bootstrap when enabled',
  async () => {
    Deno.env.set('ALLOW_REMOTE_BOOTSTRAP', 'true')
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
    Deno.env.delete('ALLOW_REMOTE_BOOTSTRAP')
  }
)
