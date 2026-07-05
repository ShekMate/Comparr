const DEFAULT_FETCH_TIMEOUT_MS = 10_000

export async function fetchWithTimeout(
  input: Request | string | URL,
  init: RequestInit = {},
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  let response: Response
  try {
    response = await fetch(input, {
      ...init,
      signal: controller.signal,
    })
  } catch (err) {
    clearTimeout(timeout)
    throw err
  }

  // fetch() resolving only means headers arrived — the body can still stall.
  // Keep the abort timer alive until whichever body-read method the caller
  // uses actually finishes, so a stalled body is bounded by timeoutMs too.
  const wrapBodyRead = <T>(read: () => Promise<T>) => {
    return async (): Promise<T> => {
      try {
        return await read()
      } finally {
        clearTimeout(timeout)
      }
    }
  }

  response.json = wrapBodyRead(response.json.bind(response))
  response.text = wrapBodyRead(response.text.bind(response))
  response.arrayBuffer = wrapBodyRead(response.arrayBuffer.bind(response))
  response.blob = wrapBodyRead(response.blob.bind(response))
  response.formData = wrapBodyRead(response.formData.bind(response))

  return response
}
