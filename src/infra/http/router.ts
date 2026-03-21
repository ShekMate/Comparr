import type { CompatRequest } from './compat-request.ts'

export type RouteHandler = (
  req: CompatRequest,
  path: string
) => Promise<Response | null>

export async function handleRoutes(
  req: CompatRequest,
  path: string,
  handlers: RouteHandler[]
): Promise<Response | null> {
  for (const handler of handlers) {
    const response = await handler(req, path)
    if (response) {
      return response
    }
  }

  return null
}
