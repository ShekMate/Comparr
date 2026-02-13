import { assertEquals } from '../../__tests__/utils/test-helpers.ts'

function uniqueSettingsModulePath() {
  return `../settings.ts?ts=${Date.now()}-${Math.random()}`
}

Deno.test('settings include streaming profile defaults', async () => {
  const dataDir = await Deno.makeTempDir({ prefix: 'comparr-settings-defaults-' })
  const originalDataDir = Deno.env.get('DATA_DIR')

  Deno.env.set('DATA_DIR', dataDir)

  try {
    const settingsModule = await import(uniqueSettingsModulePath())
    const settings = settingsModule.getSettings()

    assertEquals(settings.STREAMING_PROFILE_MODE, 'anywhere')
    assertEquals(settings.PAID_STREAMING_SERVICES, '')
    assertEquals(settings.PERSONAL_MEDIA_SOURCES, '[]')
  } finally {
    if (originalDataDir === undefined) {
      Deno.env.delete('DATA_DIR')
    } else {
      Deno.env.set('DATA_DIR', originalDataDir)
    }
    await Deno.remove(dataDir, { recursive: true }).catch(() => {})
  }
})

Deno.test('settings can persist streaming profile updates', async () => {
  const dataDir = await Deno.makeTempDir({ prefix: 'comparr-settings-update-' })
  const originalDataDir = Deno.env.get('DATA_DIR')

  Deno.env.set('DATA_DIR', dataDir)

  try {
    const settingsModule = await import(uniqueSettingsModulePath())

    await settingsModule.updateSettings({
      STREAMING_PROFILE_MODE: 'my_subscriptions',
      PAID_STREAMING_SERVICES: 'netflix,hulu',
      PERSONAL_MEDIA_SOURCES: '["plex","jellyfin"]',
    })

    const reloaded = await import(uniqueSettingsModulePath())
    const settings = reloaded.getSettings()

    assertEquals(settings.STREAMING_PROFILE_MODE, 'my_subscriptions')
    assertEquals(settings.PAID_STREAMING_SERVICES, 'netflix,hulu')
    assertEquals(settings.PERSONAL_MEDIA_SOURCES, '["plex","jellyfin"]')
  } finally {
    if (originalDataDir === undefined) {
      Deno.env.delete('DATA_DIR')
    } else {
      Deno.env.set('DATA_DIR', originalDataDir)
    }
    await Deno.remove(dataDir, { recursive: true }).catch(() => {})
  }
})
