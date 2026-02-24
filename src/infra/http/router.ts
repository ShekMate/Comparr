export type RouteHandler = (req: any, path: string) => Promise<boolean>

export async function handleRoutes(
  req: any,
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
