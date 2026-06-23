// Email OTP provider — generates, stores, and verifies 6-digit login codes.
// Uses the same in-memory + JSON-file pattern as the Plex PIN store.

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
  // Purge expired entries
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

export async function sendOtpEmail(email: string, otp: string): Promise<void> {
  const host = getSetting('SMTP_HOST')
  if (!host) {
    throw new Error('Email login is not configured on this server. Contact your admin.')
  }

  const port = parseInt(getSetting('SMTP_PORT') || '587', 10)
  const user = getSetting('SMTP_USER')
  const pass = getSetting('SMTP_PASS')
  const from = getSetting('SMTP_FROM') || user || 'Comparr <noreply@comparr.app>'

  const nodemailer = await import('npm:nodemailer')
  const transporter = nodemailer.default.createTransport({
    host,
    port,
    secure: port === 465,
    auth: user ? { user, pass } : undefined,
  })

  await transporter.sendMail({
    from,
    to: email,
    subject: `Your Comparr login code: ${otp}`,
    text: [
      `Your Comparr login code is: ${otp}`,
      '',
      'This code expires in 10 minutes. Do not share it.',
    ].join('\n'),
    html: `<p>Your Comparr login code is:</p><h2 style="letter-spacing:0.2em">${otp}</h2><p>This code expires in 10 minutes. Do not share it.</p>`,
  })

  log.info(`[auth] OTP email sent to ${email}`)
}
