import { getAllowedOrigins, getTrustProxy } from '../../core/config.ts'

export const isPrivateNetwork = (hostname: string) => {
  if (!hostname) return false
  if (hostname.startsWith('::ffff:')) {
    hostname = hostname.replace('::ffff:', '')
  }
  if (
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '0:0:0:0:0:0:0:1'
  ) {
    return true
  }
  if (hostname.startsWith('10.')) return true
  if (hostname.startsWith('192.168.')) return true
  if (hostname.startsWith('172.')) {
    const octet = Number(hostname.split('.')[1] ?? '0')
    return octet >= 16 && octet <= 31
  }
  return false
}

const stripIpFormatting = (value: string) => {
  const trimmed = String(value || '').trim()
  if (!trimmed) return ''

  if (trimmed.startsWith('[')) {
    const closingIndex = trimmed.indexOf(']')
    if (closingIndex > 1) {
      return trimmed.slice(1, closingIndex)
    }
  }

  return trimmed
}

const getForwardedIp = (req: {
  headers?: { get?: (name: string) => string | null }
}) => {
  const xForwardedFor = req?.headers?.get?.('x-forwarded-for')
  if (xForwardedFor) {
    const firstHop = xForwardedFor.split(',')[0]
    const forwarded = stripIpFormatting(firstHop)
    if (forwarded) return forwarded
  }

  const xRealIp = req?.headers?.get?.('x-real-ip')
  if (xRealIp) {
    const forwarded = stripIpFormatting(xRealIp)
    if (forwarded) return forwarded
  }

  const forwarded = req?.headers?.get?.('forwarded')
  if (forwarded) {
    const match = forwarded.match(/for=(?:"?\[?)([^;,"]+)/i)
    if (match?.[1]) {
      const value = stripIpFormatting(match[1])
      if (value) return value
    }
  }

  return ''
}

const matchAllowedOrigin = (
  candidate: string,
  origin: string,
  host: string
) => {
  const lowered = candidate.toLowerCase()
  try {
    const parsed = new URL(lowered)
    return parsed.origin === origin || parsed.host === host
  } catch {
    return lowered === origin || lowered === host
  }
}

const getSocketIp = (req: { conn?: { remoteAddr?: Deno.NetAddr } }) => {
  const remote = req?.conn?.remoteAddr as Deno.NetAddr | undefined
  return remote?.hostname ?? ''
}

export const isValidHost = (req: {
  headers?: { get?: (name: string) => string | null }
}) => {
  const allowedOrigins = getAllowedOrigins()
  if (allowedOrigins.length === 0) return true

  const host = String(req?.headers?.get?.('host') || '')
    .trim()
    .toLowerCase()
  if (!host) return false

  return allowedOrigins.some(candidate =>
    matchAllowedOrigin(candidate, '', host)
  )
}

const isValidOrigin = (req: {
  headers?: { get?: (name: string) => string | null }
}) => {
  const origin = String(req?.headers?.get?.('origin') || '')
    .trim()
    .toLowerCase()
  if (!origin) return true

  const host = String(req?.headers?.get?.('host') || '')
    .trim()
    .toLowerCase()
  if (!host) return false

  const allowedOrigins = getAllowedOrigins()
  if (allowedOrigins.length > 0) {
    return allowedOrigins.some(candidate =>
      matchAllowedOrigin(candidate, origin, host)
    )
  }

  try {
    return new URL(origin).host.toLowerCase() === host
  } catch {
    return false
  }
}

export const isValidStateChangingOrigin = (req: {
  headers?: { get?: (name: string) => string | null }
}) => {
  const origin = String(req?.headers?.get?.('origin') || '').trim()
  if (!origin) return false
  return isValidOrigin(req)
}

export const isLocalRequest = (req: {
  conn?: { remoteAddr?: Deno.NetAddr }
  headers?: { get?: (name: string) => string | null }
}) => {
  if (getTrustProxy()) {
    const forwardedIp = getForwardedIp(req)
    if (forwardedIp) {
      return isPrivateNetwork(forwardedIp)
    }
  }

  return isPrivateNetwork(getSocketIp(req))
}
