import { assertEquals } from 'jsr:@std/assert'
import { handleSettingsRoutes } from './settings.ts'
import type { SettingsRouteDeps } from './settings.ts'
import { createAccessSession } from '../../../core/access-session-store.ts'

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
  } as any)

const makeDeps = (
  settings: Record<string, unknown>,
  calls: { updates: number; reset: number; wizardComplete: number }
): SettingsRouteDeps => ({
  buildPlexCache: async () => {},
  clearAllMoviesCache: () => {},
  getPlexLibraryName: () => '',
  getEmbyLibraryName: () => '',
  getJellyfinLibraryName: () => '',
  getSettings: () => settings,
  isLocalRequest: () => false,
  refreshRadarrCache: async () => {},
  updateSettings: async incoming => {
    calls.updates += 1
    return { ...settings, ...incoming }
  },
  resetSettings: async () => {
    calls.reset += 1
    return settings
  },
  getAllRooms: () => ({}),
  clearAllRooms: () => {},
  clearRooms: () => {},
  clearUsersFromRoom: () => {},
  clearUsersFromAllRooms: () => {},
  onWizardComplete: () => {
    calls.wizardComplete += 1
  },
})

Deno.test(
  'setup mode allows remote admin settings writes during wizard',
  async () => {
    Deno.env.delete('ALLOW_REMOTE_BOOTSTRAP')
    const calls = { updates: 0, reset: 0, wizardComplete: 0 }
    const settings = { SETUP_WIZARD_COMPLETED: 'false', ACCESS_PASSWORD: '' }

    const response = await handleSettingsRoutes(
      makeReq({
        body: JSON.stringify({ settings: { PLEX_TOKEN: 'secret' } }),
      }),
      '/api/settings',
      makeDeps(settings, calls)
    )

    assertEquals(response?.status, 200)
    assertEquals(calls.updates, 1)
    assertEquals(calls.wizardComplete, 0)
  }
)

Deno.test(
  'setup mode allows access password write without ALLOW_REMOTE_BOOTSTRAP',
  async () => {
    Deno.env.delete('ALLOW_REMOTE_BOOTSTRAP')
    const calls = { updates: 0, reset: 0, wizardComplete: 0 }
    const settings = { SETUP_WIZARD_COMPLETED: 'false', ACCESS_PASSWORD: '' }

    const response = await handleSettingsRoutes(
      makeReq({
        body: JSON.stringify({ settings: { ACCESS_PASSWORD: 'new-secret' } }),
      }),
      '/api/settings',
      makeDeps(settings, calls)
    )

    assertEquals(response?.status, 200)
    assertEquals(calls.updates, 1)
    assertEquals(calls.wizardComplete, 0)
  }
)

Deno.test(
  'completed wizard blocks unauthorized remote admin settings writes',
  async () => {
    const calls = { updates: 0, reset: 0, wizardComplete: 0 }
    const settings = {
      SETUP_WIZARD_COMPLETED: 'true',
      ACCESS_PASSWORD: 'pbkdf2:sha256:100000:aabbcc:ddeeff',
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
    assertEquals(calls.wizardComplete, 0)
  }
)

Deno.test(
  'wizard completion hook runs once when setup flips to complete',
  async () => {
    Deno.env.delete('ALLOW_REMOTE_BOOTSTRAP')
    const calls = { updates: 0, reset: 0, wizardComplete: 0 }
    const settings = { SETUP_WIZARD_COMPLETED: 'false', ACCESS_PASSWORD: '' }

    const response = await handleSettingsRoutes(
      makeReq({
        body: JSON.stringify({
          settings: { SETUP_WIZARD_COMPLETED: 'true' },
        }),
      }),
      '/api/settings',
      makeDeps(settings, calls)
    )

    assertEquals(response?.status, 200)
    assertEquals(calls.updates, 1)
    assertEquals(calls.wizardComplete, 1)
  }
)

Deno.test(
  'access-password verify accepts an existing access-session cookie token',
  async () => {
    const calls = { updates: 0, reset: 0, wizardComplete: 0 }
    const settings = {
      SETUP_WIZARD_COMPLETED: 'true',
      ACCESS_PASSWORD: 'pbkdf2:sha256:100000:aabbcc:ddeeff',
    }
    const sessionToken = createAccessSession()
    const req = makeReq({
      url: 'http://example.test/api/access-password/verify',
      body: JSON.stringify({ accessPassword: '' }),
    })
    req.headers.set('cookie', `comparr_access=${sessionToken}`)

    const response = await handleSettingsRoutes(
      req,
      '/api/access-password/verify',
      makeDeps(settings, calls)
    )
    const data = await response?.json()

    assertEquals(response?.status, 200)
    assertEquals(data?.success, true)
  }
)
