import type { CompatRequest } from './compat-request.ts'

type RequestLike = {
  headers?: Headers
  url?: string
}

const getFrameAncestorsDirective = () => {
  const configured = (Deno.env.get('FRAME_ANCESTORS') ?? '').trim()
  return configured || "'none'"
}

const isSecureTransport = (req?: RequestLike) => {
  const xForwardedProto = String(req?.headers?.get('x-forwarded-proto') || '')
    .split(',')[0]
    .trim()
    .toLowerCase()
  if (xForwardedProto) return xForwardedProto === 'https'
  return String(req?.url || '')
    .toLowerCase()
    .startsWith('https://')
}

export const addSecurityHeaders = (
  headers: Headers,
  req?: RequestLike
): void => {
  const frameAncestors = getFrameAncestorsDirective()
  headers.set('X-Content-Type-Options', 'nosniff')
  if (frameAncestors === "'none'") {
    headers.set('X-Frame-Options', 'DENY')
  }
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  headers.set(
    'Content-Security-Policy',
    `default-src 'self'; script-src 'self'; style-src 'self'; style-src-elem 'self' https://cdnjs.cloudflare.com https://fonts.googleapis.com; font-src 'self' https://cdnjs.cloudflare.com https://fonts.gstatic.com data:; img-src 'self' https://image.tmdb.org data: blob:; connect-src 'self' ws: wss:; frame-ancestors ${frameAncestors};`
  )
  if (isSecureTransport(req)) {
    headers.set(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains'
    )
  }
}

export const makeHeaders = (req: CompatRequest, contentType?: string): Headers => {
  const headers = new Headers()
  if (contentType) headers.set('content-type', contentType)
  addSecurityHeaders(headers, req)
  return headers
}
