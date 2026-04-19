import { assertEquals, assertRejects } from '../../testdata/test-helpers.ts'

function uniqueSettingsModulePath() {
  return `../settings.ts?ts=${Date.now()}-${Math.random()}`
}

Deno.test('settings include streaming profile defaults', async () => {
  const dataDir = await Deno.makeTempDir({
    prefix: 'comparr-settings-defaults-',
  })
  const originalDataDir = Deno.env.get('DATA_DIR')

  Deno.env.set('DATA_DIR', dataDir)

  try {
    const settingsModule = await import(uniqueSettingsModulePath())
    const settings = settingsModule.getSettings()

    assertEquals(settings.STREAMING_PROFILE_MODE, 'anywhere')
    assertEquals(settings.ACCESS_PASSWORD, '')
    assertEquals(settings.PAID_STREAMING_SERVICES, '[]')
    assertEquals(settings.PERSONAL_MEDIA_SOURCES, '[]')
    assertEquals(settings.SETUP_WIZARD_COMPLETED, 'false')
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
      ACCESS_PASSWORD: 'secret-access',
      PAID_STREAMING_SERVICES: '["netflix","hulu"]',
      PERSONAL_MEDIA_SOURCES: '["plex","jellyfin"]',
      SETUP_WIZARD_COMPLETED: 'true',
    })

    const reloaded = await import(uniqueSettingsModulePath())
    const settings = reloaded.getSettings()

    assertEquals(settings.STREAMING_PROFILE_MODE, 'my_subscriptions')
    assertEquals(settings.ACCESS_PASSWORD, 'secret-access')
    assertEquals(settings.PAID_STREAMING_SERVICES, '["netflix","hulu"]')
    assertEquals(settings.PERSONAL_MEDIA_SOURCES, '["plex","jellyfin"]')
    assertEquals(settings.SETUP_WIZARD_COMPLETED, 'true')
  } finally {
    if (originalDataDir === undefined) {
      Deno.env.delete('DATA_DIR')
    } else {
      Deno.env.set('DATA_DIR', originalDataDir)
    }
    await Deno.remove(dataDir, { recursive: true }).catch(() => {})
  }
})

Deno.test('settings normalize streaming profile values', async () => {
  const dataDir = await Deno.makeTempDir({
    prefix: 'comparr-settings-normalize-',
  })
  const originalDataDir = Deno.env.get('DATA_DIR')

  Deno.env.set('DATA_DIR', dataDir)

  try {
    const settingsModule = await import(uniqueSettingsModulePath())

    await settingsModule.updateSettings({
      STREAMING_PROFILE_MODE: 'MY_SUBSCRIPTIONS',
      PAID_STREAMING_SERVICES: '["Netflix", " hulu ", "netflix"]',
      PERSONAL_MEDIA_SOURCES: '["Plex", " jellyfin ", "plex"]',
    })

    const settings = settingsModule.getSettings()

    assertEquals(settings.STREAMING_PROFILE_MODE, 'my_subscriptions')
    assertEquals(settings.ACCESS_PASSWORD, '')
    assertEquals(settings.PAID_STREAMING_SERVICES, '["netflix","hulu"]')
    assertEquals(settings.PERSONAL_MEDIA_SOURCES, '["plex","jellyfin"]')
    assertEquals(settings.SETUP_WIZARD_COMPLETED, 'true')
  } finally {
    if (originalDataDir === undefined) {
      Deno.env.delete('DATA_DIR')
    } else {
      Deno.env.set('DATA_DIR', originalDataDir)
    }
    await Deno.remove(dataDir, { recursive: true }).catch(() => {})
  }
})

Deno.test('settings reject invalid streaming profile values', async () => {
  const dataDir = await Deno.makeTempDir({
    prefix: 'comparr-settings-invalid-',
  })
  const originalDataDir = Deno.env.get('DATA_DIR')

  Deno.env.set('DATA_DIR', dataDir)

  try {
    const settingsModule = await import(uniqueSettingsModulePath())

    await assertRejects(
      () =>
        settingsModule.updateSettings({
          STREAMING_PROFILE_MODE: 'something_else',
        }),
      Error
    )

    await assertRejects(
      () =>
        settingsModule.updateSettings({
          PAID_STREAMING_SERVICES: '["netflix","unknown-provider"]',
        }),
      Error
    )

    await assertRejects(
      () =>
        settingsModule.updateSettings({
          PERSONAL_MEDIA_SOURCES: '{"plex": true}',
        }),
      Error
    )
  } finally {
    if (originalDataDir === undefined) {
      Deno.env.delete('DATA_DIR')
    } else {
      Deno.env.set('DATA_DIR', originalDataDir)
    }
    await Deno.remove(dataDir, { recursive: true }).catch(() => {})
  }
})

Deno.test(
  'settings accept legacy CSV paid services and normalize to JSON array',
  async () => {
    const dataDir = await Deno.makeTempDir({
      prefix: 'comparr-settings-legacy-csv-',
    })
    const originalDataDir = Deno.env.get('DATA_DIR')

    Deno.env.set('DATA_DIR', dataDir)

    try {
      const settingsModule = await import(uniqueSettingsModulePath())

      await settingsModule.updateSettings({
        PAID_STREAMING_SERVICES: 'Netflix, hulu, netflix',
      })

      const settings = settingsModule.getSettings()
      assertEquals(settings.PAID_STREAMING_SERVICES, '["netflix","hulu"]')
    } finally {
      if (originalDataDir === undefined) {
        Deno.env.delete('DATA_DIR')
      } else {
        Deno.env.set('DATA_DIR', originalDataDir)
      }
      await Deno.remove(dataDir, { recursive: true }).catch(() => {})
    }
  }
)

Deno.test('PORT from env is not overridden by settings.json', async () => {
  const dataDir = await Deno.makeTempDir({
    prefix: 'comparr-settings-port-env-only-load-',
  })
  const originalDataDir = Deno.env.get('DATA_DIR')
  const originalPort = Deno.env.get('PORT')

  Deno.env.set('DATA_DIR', dataDir)
  Deno.env.set('PORT', '8000')

  try {
    await Deno.writeTextFile(
      `${dataDir}/settings.json`,
      JSON.stringify({ PORT: '8001', ACCESS_PASSWORD: 'from-file' }, null, 2)
    )

    const settingsModule = await import(uniqueSettingsModulePath())
    const settings = settingsModule.getSettings()

    assertEquals(settings.PORT, '8000')
    assertEquals(settings.ACCESS_PASSWORD, 'from-file')
  } finally {
    if (originalDataDir === undefined) {
      Deno.env.delete('DATA_DIR')
    } else {
      Deno.env.set('DATA_DIR', originalDataDir)
    }
    if (originalPort === undefined) {
      Deno.env.delete('PORT')
    } else {
      Deno.env.set('PORT', originalPort)
    }
    await Deno.remove(dataDir, { recursive: true }).catch(() => {})
  }
})

Deno.test(
  'updating settings does not persist PORT to settings.json',
  async () => {
    const dataDir = await Deno.makeTempDir({
      prefix: 'comparr-settings-port-env-only-save-',
    })
    const originalDataDir = Deno.env.get('DATA_DIR')
    const originalPort = Deno.env.get('PORT')

    Deno.env.set('DATA_DIR', dataDir)
    Deno.env.set('PORT', '8000')

    try {
      const settingsModule = await import(uniqueSettingsModulePath())

      await settingsModule.updateSettings({
        PORT: '8001',
        ACCESS_PASSWORD: 'persist-me',
      })

      const disk = JSON.parse(
        await Deno.readTextFile(`${dataDir}/settings.json`)
      )
      assertEquals('PORT' in disk, false)
      assertEquals(disk.ACCESS_PASSWORD, 'persist-me')
      assertEquals(settingsModule.getSettings().PORT, '8000')
    } finally {
      if (originalDataDir === undefined) {
        Deno.env.delete('DATA_DIR')
      } else {
        Deno.env.set('DATA_DIR', originalDataDir)
      }
      if (originalPort === undefined) {
        Deno.env.delete('PORT')
      } else {
        Deno.env.set('PORT', originalPort)
      }
      await Deno.remove(dataDir, { recursive: true }).catch(() => {})
    }
  }
)
