// imdb-datasets.ts
// Downloads and manages IMDb dataset dumps for ratings data
// https://datasets.imdbws.com/

import { Database } from 'jsr:@db/sqlite'
import * as log from 'jsr:@std/log'
import { fetchWithTimeout } from '../../infra/http/fetch-with-timeout.ts'
import { getDataDir } from '../../core/env.ts'

const IMDB_DB_PATH = `${getDataDir()}/imdb-ratings.db`
const IMDB_DUMP_URL = 'https://datasets.imdbws.com/title.ratings.tsv.gz'
const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24 hours

let db: Database | null = null
let isDownloading = false
let lastUpdateCheck = 0
let backgroundJobId: number | null = null

/**
 * Initialize the IMDb database connection
 */
export function initIMDbDatabase(): Database | null {
  if (db) return db

  try {
    // Check if database exists
    const dbExists = existsSync(IMDB_DB_PATH)
    if (!dbExists) {
      log.info('IMDb ratings database not found, will download in background')
      return null
    }

    db = new Database(IMDB_DB_PATH, { readonly: true })
    log.info(`✅ IMDb ratings database loaded from ${IMDB_DB_PATH}`)
    return db
  } catch (error) {
    log.error(`Failed to open IMDb database: ${error}`)
    return null
  }
}

/**
 * Get IMDb rating for a given IMDb ID (e.g., "tt1234567")
 */
export function getIMDbRating(imdbId: string): number | null {
  if (!db) {
    db = initIMDbDatabase()
    if (!db) return null
  }

  try {
    const stmt = db.prepare(
      'SELECT averageRating FROM ratings WHERE tconst = ? LIMIT 1'
    )
    const result = stmt.value<[number]>(imdbId)
    stmt.finalize()
    if (result && result.length > 0) {
      const rating = result[0]
      return typeof rating === 'number' ? rating : null
    }

    return null
  } catch (error) {
    log.error(`Failed to query IMDb rating for ${imdbId}: ${error}`)
    return null
  }
}

/**
 * Download and build the IMDb ratings database
 */
export async function downloadAndBuildIMDbDatabase(): Promise<boolean> {
  if (isDownloading) {
    log.info('IMDb database download already in progress')
    return false
  }

  isDownloading = true

  try {
    log.info(`📥 Downloading IMDb ratings dataset from ${IMDB_DUMP_URL}`)

    // Ensure data directory exists
    await ensureDataDir()

    // Download the gzipped TSV file
    const response = await fetchWithTimeout(IMDB_DUMP_URL)
    if (!response.ok) {
      throw new Error(
        `Failed to download IMDb data: ${response.status} ${response.statusText}`
      )
    }

    const compressedData = new Uint8Array(await response.arrayBuffer())
    log.info(
      `✅ Downloaded ${(compressedData.length / 1024 / 1024).toFixed(
        2
      )} MB, decompressing...`
    )

    // Decompress using native web streams API.
    const compressedStream = new Blob([compressedData]).stream()
    const decompressedStream = compressedStream.pipeThrough(
      new DecompressionStream('gzip')
    )
    const decompressedBuffer = await new Response(
      decompressedStream
    ).arrayBuffer()
    const tsvData = new TextDecoder().decode(decompressedBuffer)
    log.info(
      `✅ Decompressed to ${(tsvData.length / 1024 / 1024).toFixed(
        2
      )} MB, parsing...`
    )

    // Build SQLite database
    await buildDatabase(tsvData)

    // Initialize the database connection
    db = null // Reset connection
    initIMDbDatabase()

    log.info('✅ IMDb ratings database ready!')
    return true
  } catch (error) {
    log.error(`Failed to download/build IMDb database: ${error}`)
    return false
  } finally {
    isDownloading = false
  }
}

/**
 * Build SQLite database from TSV data
 */
async function buildDatabase(tsvData: string): Promise<void> {
  const tempDbPath = `${IMDB_DB_PATH}.tmp`

  // Create new database
  const buildDb = new Database(tempDbPath)

  try {
    // Create table
    buildDb.exec(`
      CREATE TABLE IF NOT EXISTS ratings (
        tconst TEXT PRIMARY KEY,
        averageRating REAL,
        numVotes INTEGER
      )
    `)

    // Parse TSV and insert data
    const lines = tsvData.split('\n')
    log.info(`Processing ${lines.length - 1} ratings...`)

    buildDb.exec('BEGIN TRANSACTION')

    const insertStmt = buildDb.prepare(
      'INSERT OR REPLACE INTO ratings (tconst, averageRating, numVotes) VALUES (?, ?, ?)'
    )

    let count = 0
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue

      const [tconst, avgRating, numVotes] = line.split('\t')

      // Skip invalid data
      if (!tconst || avgRating === '\\N' || numVotes === '\\N') continue

      insertStmt.run(tconst, parseFloat(avgRating), parseInt(numVotes, 10))

      count++

      // Progress indicator
      if (count % 100000 === 0) {
        log.info(`  Processed ${count.toLocaleString()} ratings...`)
      }
    }

    insertStmt.finalize()
    buildDb.exec('COMMIT')

    // Create index for fast lookups
    log.info('Creating index...')
    buildDb.exec('CREATE INDEX IF NOT EXISTS idx_tconst ON ratings(tconst)')

    log.info(`✅ Inserted ${count.toLocaleString()} ratings into database`)
  } finally {
    buildDb.close()
  }

  // Atomic rename
  try {
    await Deno.remove(IMDB_DB_PATH).catch(() => {}) // Remove old DB if exists
    await Deno.rename(tempDbPath, IMDB_DB_PATH)
  } catch (error) {
    log.error(`Failed to rename database: ${error}`)
    throw error
  }
}

/**
 * Check if database needs updating and update in background
 */
export async function checkAndUpdateDatabase(): Promise<void> {
  const now = Date.now()

  // Rate limit checks to once per hour
  if (now - lastUpdateCheck < 60 * 60 * 1000) {
    return
  }

  lastUpdateCheck = now

  try {
    const dbExists = existsSync(IMDB_DB_PATH)

    if (!dbExists) {
      log.info('IMDb database missing, downloading in background...')
      // Don't await - run in background
      downloadAndBuildIMDbDatabase().catch(err =>
        log.error(`Background download failed: ${err}`)
      )
      return
    }

    // Check if database is older than 24 hours
    const stats = await Deno.stat(IMDB_DB_PATH)
    const ageMs = now - stats.mtime!.getTime()

    if (ageMs > UPDATE_INTERVAL_MS) {
      log.info(
        `IMDb database is ${(ageMs / 1000 / 60 / 60).toFixed(
          1
        )} hours old, updating in background...`
      )
      // Don't await - run in background
      downloadAndBuildIMDbDatabase().catch(err =>
        log.error(`Background update failed: ${err}`)
      )
    }
  } catch (error) {
    log.error(`Failed to check database age: ${error}`)
  }
}

/**
 * Start background update job
 */
export function startBackgroundUpdateJob(): void {
  if (backgroundJobId !== null) return
  // Initial check on startup
  checkAndUpdateDatabase().catch(err =>
    log.error(`Initial database check failed: ${err}`)
  )

  // Check daily
  backgroundJobId = setInterval(() => {
    checkAndUpdateDatabase().catch(err =>
      log.error(`Scheduled database check failed: ${err}`)
    )
  }, UPDATE_INTERVAL_MS)

  log.info('📅 IMDb background update job started (checks daily)')
}

export function stopBackgroundUpdateJob(): void {
  if (backgroundJobId === null) return
  clearInterval(backgroundJobId)
  backgroundJobId = null
  log.info('🛑 IMDb background update job stopped')
}

/**
 * Cleanup database connection
 */
export function closeIMDbDatabase(): void {
  if (db) {
    db.close()
    db = null
    log.info('IMDb database connection closed')
  }
}

/**
 * Helper to check if file exists
 */
function existsSync(path: string): boolean {
  try {
    Deno.statSync(path)
    return true
  } catch {
    return false
  }
}

/**
 * Ensure data directory exists
 */
async function ensureDataDir(): Promise<void> {
  try {
    await Deno.mkdir(getDataDir(), { recursive: true })
  } catch {
    // Ignore if already exists
  }
}
