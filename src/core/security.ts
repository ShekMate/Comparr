const encoder = new TextEncoder()

export const timingSafeEqual = (a: string, b: string): boolean => {
  const left = encoder.encode(String(a ?? ''))
  const right = encoder.encode(String(b ?? ''))

  const maxLength = Math.max(left.length, right.length)
  let mismatch = left.length ^ right.length

  for (let i = 0; i < maxLength; i++) {
    const l = i < left.length ? left[i] : 0
    const r = i < right.length ? right[i] : 0
    mismatch |= l ^ r
  }

  return mismatch === 0
}

// PBKDF2 password hashing using the built-in Web Crypto API (no external deps).
// Stored format: "pbkdf2:sha256:100000:<salt_hex>:<hash_hex>"
const HASH_PREFIX = 'pbkdf2:sha256:100000:'
const PBKDF2_ITERATIONS = 100_000

const toHex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')

const fromHex = (hex: string): Uint8Array =>
  new Uint8Array(hex.match(/.{2}/g)!.map(b => parseInt(b, 16)))

export const isHashedPassword = (value: string): boolean =>
  value.startsWith(HASH_PREFIX)

export const hashPassword = async (plaintext: string): Promise<string> => {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(plaintext),
    'PBKDF2',
    false,
    ['deriveBits']
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    keyMaterial,
    256
  )
  return `${HASH_PREFIX}${toHex(salt.buffer)}:${toHex(bits)}`
}

export const verifyPassword = async (
  candidate: string,
  stored: string
): Promise<boolean> => {
  if (!stored) return !candidate
  if (!isHashedPassword(stored)) {
    // Stored as plaintext (env var or pre-hashing install) — use timing-safe compare
    return timingSafeEqual(candidate, stored)
  }
  const parts = stored.split(':')
  // format: pbkdf2:sha256:100000:<salt>:<hash>  → parts[3]=salt, parts[4]=hash
  if (parts.length !== 5) return false
  const salt = fromHex(parts[3])
  const storedHash = fromHex(parts[4])
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(candidate),
    'PBKDF2',
    false,
    ['deriveBits']
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    keyMaterial,
    256
  )
  const candidateHash = new Uint8Array(bits)
  if (candidateHash.length !== storedHash.length) return false
  let mismatch = 0
  for (let i = 0; i < candidateHash.length; i++) mismatch |= candidateHash[i] ^ storedHash[i]
  return mismatch === 0
}
