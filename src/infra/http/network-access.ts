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

export const isLocalRequest = (req: {
  conn?: { remoteAddr?: Deno.NetAddr }
}) => {
  const remote = req?.conn?.remoteAddr as Deno.NetAddr | undefined
  const hostname = remote?.hostname ?? ''
  return isPrivateNetwork(hostname)
}
