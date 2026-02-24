import { assertEquals } from 'https://deno.land/std@0.191.0/testing/asserts.ts'
import { isLocalRequest, isPrivateNetwork } from './network-access.ts'

Deno.test('isPrivateNetwork supports common private network ranges', () => {
  assertEquals(isPrivateNetwork('127.0.0.1'), true)
  assertEquals(isPrivateNetwork('::1'), true)
  assertEquals(isPrivateNetwork('10.0.0.15'), true)
  assertEquals(isPrivateNetwork('192.168.1.2'), true)
  assertEquals(isPrivateNetwork('172.16.5.3'), true)
  assertEquals(isPrivateNetwork('172.31.255.8'), true)
  assertEquals(isPrivateNetwork('172.32.0.1'), false)
  assertEquals(isPrivateNetwork('8.8.8.8'), false)
})

Deno.test('isLocalRequest ignores forwarded headers unless TRUST_PROXY=true', () => {
  Deno.env.set('TRUST_PROXY', 'false')

  const req = {
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'x-forwarded-for'
          ? '192.168.0.9, 203.0.113.10'
          : null,
    },
    conn: {
      remoteAddr: { hostname: '203.0.113.15' },
    },
  }

  assertEquals(isLocalRequest(req as any), false)
})

Deno.test('isLocalRequest trusts forwarded headers only when TRUST_PROXY=true', () => {
  Deno.env.set('TRUST_PROXY', 'true')

  const req = {
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'x-real-ip' ? '10.0.0.20' : null,
    },
    conn: {
      remoteAddr: { hostname: '203.0.113.15' },
    },
  }

  assertEquals(isLocalRequest(req as any), true)
})

Deno.test(
  'isLocalRequest falls back to socket remote address when no forwarded headers',
  () => {
    Deno.env.set('TRUST_PROXY', 'true')

    const req = {
      headers: { get: (_name: string) => null },
      conn: {
        remoteAddr: { hostname: '10.20.0.4' },
      },
    }

    assertEquals(isLocalRequest(req as any), true)
  }
)
