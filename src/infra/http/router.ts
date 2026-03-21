import type { CompatRequest } from './compat-request.ts'
export type RouteHandler = (req: CompatRequest, path: string) => Promise<boolean>

export async function handleRoutes(
  req: CompatRequest,
  path: string,
  handlers: RouteHandler[]
): Promise<boolean> {
  for (const handler of handlers) {
    if (await handler(req, path)) {
      return true
    }
  }

  return false
}
