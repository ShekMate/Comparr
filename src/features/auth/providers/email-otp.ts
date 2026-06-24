// Email OTP provider — generates, stores, and verifies 6-digit login codes.
// Uses the same in-memory + JSON-file pattern as the Plex PIN store.
// SMTP sending is implemented natively with Deno TLS — no npm dependencies.

import * as log from 'jsr:@std/log'
import { getDataDir } from '../../../core/env.ts'
import { getSetting } from '../../../core/settings.ts'

const OTP_TTL_MS = 10 * 60 * 1000
const OTP_DIGITS = 6

interface OtpRecord {
  email: string
  otpHash: string
  expiresAt: number
}

const _pendingOtps = new Map<string, OtpRecord>()
const PENDING_OTPS_FILE = `${getDataDir()}/pending-email-otps.json`

function normalizeEmail(email: string): string {
  return email.toLowerCase().trim()
}

async function hashOtp(email: string, otp: string): Promise<string> {
  const data = new TextEncoder().encode(`${normalizeEmail(email)}:${otp}`)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

export function loadOtpsFromDisk(): void {
  try {
    const text = Deno.readTextFileSync(PENDING_OTPS_FILE)
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object') return
    _pendingOtps.clear()
    const now = Date.now()
    for (const [key, value] of Object.entries(parsed)) {
      if (!value || typeof value !== 'object') continue
      const rec = value as { email?: string; otpHash?: string; expiresAt?: number }
      if (!rec.email || !rec.otpHash || !rec.expiresAt || now > rec.expiresAt) continue
      _pendingOtps.set(key, {
        email: String(rec.email),
        otpHash: String(rec.otpHash),
        expiresAt: Number(rec.expiresAt),
      })
    }
  } catch {
    // ignore file-read/parse errors
  }
}

function persistOtpsToDisk(): void {
  try {
    Deno.mkdirSync(getDataDir(), { recursive: true })
    const tmp = `${PENDING_OTPS_FILE}.tmp.${Date.now()}`
    Deno.writeTextFileSync(tmp, JSON.stringify(Object.fromEntries(_pendingOtps.entries())))
    Deno.renameSync(tmp, PENDING_OTPS_FILE)
  } catch {
    // best-effort
  }
}

export function generateOtp(): string {
  const buf = crypto.getRandomValues(new Uint32Array(1))
  return String(buf[0] % Math.pow(10, OTP_DIGITS)).padStart(OTP_DIGITS, '0')
}

export async function storeOtp(email: string, otp: string): Promise<void> {
  const now = Date.now()
  for (const [key, rec] of _pendingOtps) {
    if (now > rec.expiresAt) _pendingOtps.delete(key)
  }
  const key = normalizeEmail(email)
  const otpHash = await hashOtp(email, otp)
  _pendingOtps.set(key, { email, otpHash, expiresAt: now + OTP_TTL_MS })
  persistOtpsToDisk()
}

export async function verifyAndConsumeOtp(email: string, otp: string): Promise<boolean> {
  const key = normalizeEmail(email)
  const record = _pendingOtps.get(key)
  if (!record) return false
  if (Date.now() > record.expiresAt) {
    _pendingOtps.delete(key)
    persistOtpsToDisk()
    return false
  }
  const inputHash = await hashOtp(email, otp.trim())
  if (inputHash !== record.otpHash) return false
  _pendingOtps.delete(key)
  persistOtpsToDisk()
  return true
}

// ---------------------------------------------------------------------------
// Minimal native SMTP client — no npm dependencies
// ---------------------------------------------------------------------------

const enc = new TextEncoder()
const dec = new TextDecoder()

async function smtpRead(conn: Deno.Conn): Promise<string> {
  const buf = new Uint8Array(4096)
  let result = ''
  while (true) {
    const n = await conn.read(buf)
    if (n === null) break
    result += dec.decode(buf.subarray(0, n))
    // Multi-line responses end when a line starts with "NNN " (space after code)
    const lines = result.split('\r\n')
    const last = lines.filter(l => l.length > 0).pop() ?? ''
    if (/^\d{3} /.test(last)) break
  }
  return result
}

async function smtpWrite(conn: Deno.Conn, line: string): Promise<void> {
  await conn.write(enc.encode(line + '\r\n'))
}

function smtpCode(response: string): number {
  return parseInt(response.slice(0, 3), 10)
}

function assertSmtp(response: string, expected: number, label: string): void {
  const code = smtpCode(response)
  if (code !== expected) {
    throw new Error(`[smtp] ${label}: expected ${expected}, got ${code} — ${response.trim()}`)
  }
}

function mimeEncode(value: string): string {
  // RFC 2047 encoded-word for non-ASCII display names
  if (/^[\x20-\x7e]*$/.test(value)) return value
  return `=?UTF-8?B?${btoa(value)}?=`
}

function buildMessage(opts: {
  from: string
  to: string
  subject: string
  text: string
  html: string
}): string {
  const boundary = `comparr_${crypto.randomUUID().replace(/-/g, '')}`
  const date = new Date().toUTCString()
  const subjectEncoded = mimeEncode(opts.subject)

  return [
    `Date: ${date}`,
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: ${subjectEncoded}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset=UTF-8`,
    ``,
    opts.text,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=UTF-8`,
    ``,
    opts.html,
    ``,
    `--${boundary}--`,
  ].join('\r\n')
}

async function sendSmtp(opts: {
  host: string
  port: number
  user?: string
  pass?: string
  from: string
  to: string
  subject: string
  text: string
  html: string
}): Promise<void> {
  const { host, port, user, pass } = opts
  const useTls = port === 465

  let conn: Deno.Conn

  if (useTls) {
    conn = await Deno.connectTls({ hostname: host, port })
  } else {
    conn = await Deno.connect({ hostname: host, port })
  }

  try {
    // Greeting
    const greeting = await smtpRead(conn)
    assertSmtp(greeting, 220, 'greeting')

    // EHLO
    await smtpWrite(conn, `EHLO comparr`)
    const ehlo1 = await smtpRead(conn)
    assertSmtp(ehlo1, 250, 'EHLO')

    // STARTTLS for port 587
    if (!useTls) {
      await smtpWrite(conn, 'STARTTLS')
      const starttls = await smtpRead(conn)
      assertSmtp(starttls, 220, 'STARTTLS')
      conn = await Deno.startTls(conn as Deno.TcpConn, { hostname: host })
      await smtpWrite(conn, `EHLO comparr`)
      const ehlo2 = await smtpRead(conn)
      assertSmtp(ehlo2, 250, 'EHLO after STARTTLS')
    }

    // AUTH LOGIN
    if (user && pass) {
      await smtpWrite(conn, 'AUTH LOGIN')
      const auth1 = await smtpRead(conn)
      assertSmtp(auth1, 334, 'AUTH LOGIN')
      await smtpWrite(conn, btoa(user))
      const auth2 = await smtpRead(conn)
      assertSmtp(auth2, 334, 'AUTH username')
      await smtpWrite(conn, btoa(pass))
      const auth3 = await smtpRead(conn)
      assertSmtp(auth3, 235, 'AUTH password')
    }

    // Extract bare address from "Name <addr>" format
    const bareAddr = (s: string) => {
      const m = s.match(/<([^>]+)>/)
      return m ? m[1] : s.trim()
    }

    await smtpWrite(conn, `MAIL FROM:<${bareAddr(opts.from)}>`)
    assertSmtp(await smtpRead(conn), 250, 'MAIL FROM')

    await smtpWrite(conn, `RCPT TO:<${bareAddr(opts.to)}>`)
    assertSmtp(await smtpRead(conn), 250, 'RCPT TO')

    await smtpWrite(conn, 'DATA')
    assertSmtp(await smtpRead(conn), 354, 'DATA')

    const message = buildMessage(opts)
    // Dot-stuffing: lines starting with '.' get an extra '.'
    const stuffed = message.replace(/^\./gm, '..')
    await smtpWrite(conn, stuffed + '\r\n.')
    assertSmtp(await smtpRead(conn), 250, 'message accepted')

    await smtpWrite(conn, 'QUIT')
  } finally {
    try { conn.close() } catch { /* ignore */ }
  }
}

export async function sendOtpEmail(email: string, otp: string): Promise<void> {
  const host = getSetting('SMTP_HOST')
  if (!host) {
    throw new Error('Email login is not configured on this server. Contact your admin.')
  }

  const port = parseInt(getSetting('SMTP_PORT') || '587', 10)
  const user = getSetting('SMTP_USER') || undefined
  const pass = getSetting('SMTP_PASS') || undefined
  const from = getSetting('SMTP_FROM') || user || 'Comparr <noreply@comparr.app>'

  await sendSmtp({
    host,
    port,
    user,
    pass,
    from,
    to: email,
    subject: `Your Comparr login code: ${otp}`,
    text: [
      `Your Comparr login code is: ${otp}`,
      '',
      'This code expires in 10 minutes. Do not share it.',
    ].join('\n'),
    html: `<p>Your Comparr login code is:</p><h2 style="letter-spacing:0.2em;font-size:2rem">${otp}</h2><p>This code expires in 10 minutes. Do not share it.</p>`,
  })

  log.info(`[auth] OTP email sent to ${email}`)
}
