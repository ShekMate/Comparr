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

  // [::1]:8000 -> ::1
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

export const isLocalRequest = (req: {
  conn?: { remoteAddr?: Deno.NetAddr }
  headers?: { get?: (name: string) => string | null }
}) => {
  const forwardedIp = getForwardedIp(req)
  if (forwardedIp) {
    return isPrivateNetwork(forwardedIp)
  }

  const remote = req?.conn?.remoteAddr as Deno.NetAddr | undefined
  const hostname = remote?.hostname ?? ''
  return isPrivateNetwork(hostname)
}
