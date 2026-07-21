import type { CompatRequest } from '../compat-request.ts'
import { makeHeaders } from '../security-headers.ts'

type SystemRouteDeps = {
  csrfCookieName: string
  createCsrfToken: () => string
  shouldUseSecureCookies: (req: CompatRequest) => boolean
}

export const handleSystemRoutes = async (
  req: CompatRequest,
  pathname: string,
  deps: SystemRouteDeps
): Promise<Response | null> => {
  if (pathname === '/api/health' && req.method === 'GET') {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: makeHeaders(req, 'application/json'),
    })
  }

  if (pathname === '/api/csrf-token' && req.method === 'GET') {
    const token = deps.createCsrfToken()
    const headers = makeHeaders(req, 'application/json')
    const secureFlag = deps.shouldUseSecureCookies(req) ? '; Secure' : ''
    headers.set(
      'set-cookie',
      `${deps.csrfCookieName}=${token}; Path=/; SameSite=Strict; HttpOnly${secureFlag}`
    )
    return new Response(JSON.stringify({ csrfToken: token }), {
      status: 200,
      headers,
    })
  }

  return null
}
