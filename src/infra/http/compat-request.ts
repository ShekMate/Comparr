export type CompatResponseInit = {
  status?: number
  headers?: HeadersInit
  body?: BodyInit | null
}

export type CompatRequest = {
  method: string
  url: string
  headers: Headers
  conn: { remoteAddr?: Deno.NetAddr | Deno.UnixAddr }
  rawRequest: Request
  respond: (init: CompatResponseInit) => Promise<void>
  respondWith: (response: Response) => Promise<void>
  text: () => Promise<string>
  json: <T = unknown>() => Promise<T>
}
