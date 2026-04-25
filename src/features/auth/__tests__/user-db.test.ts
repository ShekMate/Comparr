// Tests for src/features/auth/user-db.ts
// Each test uses an isolated temp directory so SQLite state doesn't bleed between tests.

import { assertEquals, assertExists } from '../../../testdata/test-helpers.ts'

// ---------------------------------------------------------------------------
// Helper: give each test its own DATA_DIR and a fresh module import
// ---------------------------------------------------------------------------

function uniqueDbModulePath() {
  return `../user-db.ts?ts=${Date.now()}-${Math.random()}`
}

async function withTempDb<T>(
  fn: (mod: typeof import('../user-db.ts')) => Promise<T>
): Promise<T> {
  const dataDir = await Deno.makeTempDir({ prefix: 'comparr-user-db-test-' })
  const originalDataDir = Deno.env.get('DATA_DIR')
  Deno.env.set('DATA_DIR', dataDir)

  // Force the module to re-initialize with the new DATA_DIR
  const mod = (await import(
    uniqueDbModulePath()
  )) as typeof import('../user-db.ts')
  // Init DB explicitly
  mod.initUserDatabase()

  try {
    return await fn(mod)
  } finally {
    mod.closeUserDatabase()
    if (originalDataDir === undefined) {
      Deno.env.delete('DATA_DIR')
    } else {
      Deno.env.set('DATA_DIR', originalDataDir)
    }
    await Deno.remove(dataDir, { recursive: true }).catch(() => {})
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test('user-db: first upserted user becomes admin', async () => {
  await withTempDb(async mod => {
    assertEquals(
      mod.adminExists(),
      false,
      'no admin before any user is created'
    )

    const user = mod.upsertUser({
      provider: 'plex',
      providerUserId: 'plex-001',
      username: 'Alice',
      email: 'alice@example.com',
      avatarUrl: 'https://example.com/alice.jpg',
    })

    assertEquals(user.isAdmin, true, 'first user should be admin')
    assertEquals(
      mod.adminExists(),
      true,
      'adminExists() should return true now'
    )
  })
})

Deno.test('user-db: second upserted user is not admin', async () => {
  await withTempDb(async mod => {
    mod.upsertUser({
      provider: 'plex',
      providerUserId: 'plex-001',
      username: 'Alice',
      email: 'alice@example.com',
      avatarUrl: '',
    })

    const bob = mod.upsertUser({
      provider: 'plex',
      providerUserId: 'plex-002',
      username: 'Bob',
      email: 'bob@example.com',
      avatarUrl: '',
    })

    assertEquals(bob.isAdmin, false, 'second user must not be admin')
  })
})

Deno.test(
  'user-db: upsert updates username/email but preserves is_admin',
  async () => {
    await withTempDb(async mod => {
      const first = mod.upsertUser({
        provider: 'jellyfin',
        providerUserId: 'jf-100',
        username: 'Charlie',
        email: 'charlie@example.com',
        avatarUrl: '',
      })
      assertEquals(first.isAdmin, true)

      // Upsert again with changed username — admin flag must survive
      const updated = mod.upsertUser({
        provider: 'jellyfin',
        providerUserId: 'jf-100',
        username: 'CharlieUpdated',
        email: 'charlie+new@example.com',
        avatarUrl: 'https://example.com/charlie.jpg',
      })

      assertEquals(updated.username, 'CharlieUpdated')
      assertEquals(updated.email, 'charlie+new@example.com')
      assertEquals(updated.avatarUrl, 'https://example.com/charlie.jpg')
      assertEquals(updated.isAdmin, true, 'is_admin must survive upsert')
      assertEquals(updated.id, first.id, 'same row — ID unchanged')
    })
  }
)

Deno.test('user-db: findUser returns null for unknown user', async () => {
  await withTempDb(async mod => {
    const result = mod.findUser('emby', 'does-not-exist')
    assertEquals(result, null)
  })
})

Deno.test('user-db: findUser returns correct user after upsert', async () => {
  await withTempDb(async mod => {
    mod.upsertUser({
      provider: 'emby',
      providerUserId: 'emby-42',
      username: 'Dana',
      email: 'dana@example.com',
      avatarUrl: '',
    })

    const found = mod.findUser('emby', 'emby-42')
    assertExists(found, 'findUser should find the inserted record')
    assertEquals(found!.username, 'Dana')
    assertEquals(found!.provider, 'emby')
    assertEquals(found!.providerUserId, 'emby-42')
  })
})

Deno.test('user-db: findUserById returns correct user', async () => {
  await withTempDb(async mod => {
    const created = mod.upsertUser({
      provider: 'plex',
      providerUserId: 'plex-999',
      username: 'Eve',
      email: 'eve@example.com',
      avatarUrl: '',
    })

    const found = mod.findUserById(created.id)
    assertExists(found)
    assertEquals(found!.id, created.id)
    assertEquals(found!.username, 'Eve')
  })
})

Deno.test('user-db: findUserById returns null for unknown id', async () => {
  await withTempDb(async mod => {
    const result = mod.findUserById(99999)
    assertEquals(result, null)
  })
})

Deno.test(
  'user-db: provider isolation — same providerUserId on different providers are separate users',
  async () => {
    await withTempDb(async mod => {
      const plexUser = mod.upsertUser({
        provider: 'plex',
        providerUserId: 'shared-id',
        username: 'PlexFrank',
        email: '',
        avatarUrl: '',
      })
      const jellyfinUser = mod.upsertUser({
        provider: 'jellyfin',
        providerUserId: 'shared-id',
        username: 'JellyFrank',
        email: '',
        avatarUrl: '',
      })

      assertEquals(
        plexUser.id !== jellyfinUser.id,
        true,
        'should be different rows'
      )
      assertEquals(plexUser.isAdmin, true)
      assertEquals(jellyfinUser.isAdmin, false)
    })
  }
)

Deno.test('user-db: listUsers returns inserted usernames', async () => {
  await withTempDb(async mod => {
    mod.upsertUser({
      provider: 'plex',
      providerUserId: 'plex-a1',
      username: 'Alice',
      email: '',
      avatarUrl: '',
    })
    mod.upsertUser({
      provider: 'plex',
      providerUserId: 'plex-b2',
      username: 'Bob',
      email: '',
      avatarUrl: '',
    })

    const users = mod.listUsers()
    assertEquals(users.length, 2)
    assertEquals(
      users.map(u => u.username),
      ['Alice', 'Bob']
    )
  })
})

Deno.test('user-db: deleteUserById removes user record', async () => {
  await withTempDb(async mod => {
    const created = mod.upsertUser({
      provider: 'plex',
      providerUserId: 'plex-z9',
      username: 'Zed',
      email: '',
      avatarUrl: '',
    })

    const removed = mod.deleteUserById(created.id)
    assertEquals(removed, true)
    assertEquals(mod.findUserById(created.id), null)
  })
})
