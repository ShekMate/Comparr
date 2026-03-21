import { assertEquals } from 'jsr:@std/assert'
import {
  extractImdbExportUrlFromHtml,
  extractImdbIdsFromHtml,
  resolveImdbImportTarget,
} from '../imdb-import.ts'

Deno.test('resolveImdbImportTarget supports bare ls list ids', () => {
  const result = resolveImdbImportTarget('ls593674607')

  assertEquals(result, {
    exportUrl: 'https://www.imdb.com/list/ls593674607/export',
    pageUrl: 'https://www.imdb.com/list/ls593674607',
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
      pageUrl: 'https://www.imdb.com/user/ur24069733/ratings',
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
    pageUrl: 'https://www.imdb.com/user/ur24069733/watchlist',
    sourceType: 'watchlist',
    normalizedInput: 'ur24069733',
  })
})

Deno.test('resolveImdbImportTarget rejects invalid input', () => {
  assertEquals(resolveImdbImportTarget('not-valid'), null)
})

Deno.test('extractImdbExportUrlFromHtml parses direct export href', () => {
  const html =
    '<a href="/user/ur24069733/ratings/export?ref_=something">Export</a>'

  assertEquals(
    extractImdbExportUrlFromHtml(html),
    'https://www.imdb.com/user/ur24069733/ratings/export?ref_=something'
  )
})

Deno.test(
  'extractImdbExportUrlFromHtml parses unescaped absolute export url',
  () => {
    const html =
      '{"exportUrl":"https://www.imdb.com/user/ur24069733/ratings/export?ref_=rt"}'

    assertEquals(
      extractImdbExportUrlFromHtml(html),
      'https://www.imdb.com/user/ur24069733/ratings/export?ref_=rt'
    )
  }
)

Deno.test('extractImdbExportUrlFromHtml parses escaped export url', () => {
  const html =
    '"https:\\/\\/www.imdb.com\\/user\\/ur24069733\\/ratings\\/export\\/"'

  assertEquals(
    extractImdbExportUrlFromHtml(html),
    'https://www.imdb.com/user/ur24069733/ratings/export/'
  )
})

Deno.test('extractImdbIdsFromHtml parses title links and deduplicates', () => {
  const html = `
    <a href="/title/tt0111161/">The Shawshank Redemption</a>
    <a href="/title/tt0068646/">The Godfather</a>
    <a href="/title/tt0111161/">Duplicate</a>
  `

  assertEquals(extractImdbIdsFromHtml(html), ['tt0111161', 'tt0068646'])
})

Deno.test('extractImdbIdsFromHtml parses json-like payloads', () => {
  const html = `{"items":[{"tconst":"tt0468569"},{"titleId":"tt1375666"}]}`

  assertEquals(extractImdbIdsFromHtml(html), ['tt0468569', 'tt1375666'])
})
