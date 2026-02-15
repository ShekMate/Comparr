import {
  assertEquals,
  assertRejects,
} from '../../__tests__/utils/test-helpers.ts'

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
    assertEquals(settings.PAID_STREAMING_SERVICES, '[]')
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
      PAID_STREAMING_SERVICES: '["netflix","hulu"]',
      PERSONAL_MEDIA_SOURCES: '["plex","jellyfin"]',
    })

    const reloaded = await import(uniqueSettingsModulePath())
    const settings = reloaded.getSettings()

    assertEquals(settings.STREAMING_PROFILE_MODE, 'my_subscriptions')
    assertEquals(settings.PAID_STREAMING_SERVICES, '["netflix","hulu"]')
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
    assertEquals(settings.PAID_STREAMING_SERVICES, '["netflix","hulu"]')
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
      Error,
      'Settings validation failed'
    )

    await assertRejects(
      () =>
        settingsModule.updateSettings({
          PAID_STREAMING_SERVICES: '["netflix","unknown-provider"]',
        }),
      Error,
      'Settings validation failed'
    )

    await assertRejects(
      () =>
        settingsModule.updateSettings({
          PERSONAL_MEDIA_SOURCES: '{"plex": true}',
        }),
      Error,
      'Settings validation failed'
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
