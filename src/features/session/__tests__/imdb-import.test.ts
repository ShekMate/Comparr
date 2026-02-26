import { assertEquals } from 'https://deno.land/std@0.79.0/testing/asserts.ts'
import { resolveImdbImportTarget } from '../imdb-import.ts'

Deno.test('resolveImdbImportTarget supports bare ls list ids', () => {
  const result = resolveImdbImportTarget('ls593674607')

  assertEquals(result, {
    exportUrl: 'https://www.imdb.com/list/ls593674607/export',
    sourceType: 'list',
    normalizedInput: 'ls593674607',
  })
})

Deno.test(
  'resolveImdbImportTarget supports bare ur ids (defaults to ratings)',
  () => {
    const result = resolveImdbImportTarget('ur24069733')

    assertEquals(result, {
      exportUrl: 'https://www.imdb.com/user/ur24069733/ratings/export',
      sourceType: 'ratings',
      normalizedInput: 'ur24069733',
    })
  }
)

Deno.test('resolveImdbImportTarget supports watchlist urls', () => {
  const result = resolveImdbImportTarget(
    'https://www.imdb.com/user/ur24069733/watchlist/'
  )

  assertEquals(result, {
    exportUrl: 'https://www.imdb.com/user/ur24069733/watchlist/export',
    sourceType: 'watchlist',
    normalizedInput: 'ur24069733',
  })
})

Deno.test('resolveImdbImportTarget rejects invalid input', () => {
  assertEquals(resolveImdbImportTarget('not-valid'), null)
})
