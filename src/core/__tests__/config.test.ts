import { assertEquals } from '../../__tests__/utils/test-helpers.ts'

function uniqueSettingsModulePath() {
  return `../settings.ts?ts=${Date.now()}-${Math.random()}`
}

function uniqueConfigModulePath() {
  return `../config.ts?ts=${Date.now()}-${Math.random()}`
}

Deno.test('getPlexUrl normalizes Plex web app URLs', async () => {
  const dataDir = await Deno.makeTempDir({
    prefix: 'comparr-config-plex-url-',
  })
  const originalDataDir = Deno.env.get('DATA_DIR')

  Deno.env.set('DATA_DIR', dataDir)

  try {
    const settingsModule = await import(uniqueSettingsModulePath())

    await settingsModule.updateSettings({
      PLEX_URL: 'http://localhost:32400/web/index.html/',
    })

    const configModule = await import(uniqueConfigModulePath())
    assertEquals(configModule.getPlexUrl(), 'http://localhost:32400')

    await settingsModule.updateSettings({
      PLEX_URL: 'http://localhost:32400/web',
    })

    assertEquals(configModule.getPlexUrl(), 'http://localhost:32400')
  } finally {
    if (originalDataDir === undefined) {
      Deno.env.delete('DATA_DIR')
    } else {
      Deno.env.set('DATA_DIR', originalDataDir)
    }
    await Deno.remove(dataDir, { recursive: true }).catch(() => {})
  }
})
