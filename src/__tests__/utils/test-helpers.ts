// Test utilities and helpers for Deno tests
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
} from 'std/testing/asserts.ts'

export { assertEquals, assertExists, assertRejects, assertThrows }

/**
 * Create a mock fetch function that returns predefined responses
 */
export function createMockFetch(responses: Map<string, any>) {
  return async (
    url: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    const urlString = typeof url === 'string' ? url : url.toString()

    // Remove query parameters for matching
    const baseUrl = urlString.split('?')[0]

    // Check if we have a mock response for this URL
    for (const [pattern, response] of responses.entries()) {
      if (urlString.includes(pattern) || baseUrl.includes(pattern)) {
        return createMockResponse(response)
      }
    }

    // Default 404 response
    return createMockResponse({ status: 404, body: 'Not Found' })
  }
}

/**
 * Create a mock Response object
 */
export function createMockResponse(config: {
  status?: number
  statusText?: string
  body?: any
  headers?: Record<string, string>
}): Response {
  const { status = 200, statusText = 'OK', body = {}, headers = {} } = config

  const responseBody = typeof body === 'string' ? body : JSON.stringify(body)

  return new Response(responseBody, {
    status,
    statusText,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  })
}

/**
 * Mock environment variables for tests
 */
export function mockEnv(vars: Record<string, string>): () => void {
  const original: Record<string, string | undefined> = {}

  for (const [key, value] of Object.entries(vars)) {
    original[key] = Deno.env.get(key)
    Deno.env.set(key, value)
  }

  // Return cleanup function
  return () => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) {
        Deno.env.delete(key)
      } else {
        Deno.env.set(key, value)
      }
    }
  }
}

/**
 * Create a mock WebSocket for testing
 */
export class MockWebSocket {
  readyState: number = 1 // OPEN
  sentMessages: any[] = []

  send(data: string) {
    this.sentMessages.push(JSON.parse(data))
  }

  close() {
    this.readyState = 3 // CLOSED
  }

  // Simulate receiving a message
  simulateMessage(data: any) {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(data) } as any)
    }
  }

  onmessage: ((event: any) => void) | null = null
  onerror: ((event: any) => void) | null = null
  onclose: ((event: any) => void) | null = null
  onopen: ((event: any) => void) | null = null
}

/**
 * Wait for a condition to be true
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeout = 1000,
  interval = 50
): Promise<void> {
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return
    }
    await new Promise(resolve => setTimeout(resolve, interval))
  }

  throw new Error(`Timeout waiting for condition after ${timeout}ms`)
}

/**
 * Create a delay promise
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
