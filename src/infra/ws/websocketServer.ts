import type { CompatRequest } from '../http/compat-request.ts'
import { EventEmitter } from 'node:events'
import { getAllowedOrigins } from '../../core/config.ts'

export class WebSocketError extends Error {}

export enum WebSocketState {
  CONNECTING = 0,
  OPEN = 1,
  CLOSING = 2,
  CLOSED = 3,
}

const MAX_WS_MESSAGE_BYTES = 65_536
const MAX_WS_CONNECTIONS_PER_IP = 10

const matchAllowedOrigin = (candidate: string, origin: string, host: string) => {
  const lowered = candidate.toLowerCase()
  try {
    const parsed = new URL(lowered)
    return parsed.origin === origin || parsed.host === host
  } catch {
    return lowered === origin || lowered === host
  }
}

interface Options {
  onConnection: (ws: WebSocket, req: CompatRequest) => void
  onError: (error: Error) => void
}

export class WebSocketServer {
  clients: Set<WebSocket> = new Set<WebSocket>()
  options: Options
  ipConnections = new Map<string, number>()

  constructor(options: Options) {
    this.options = options
  }

  private isAllowedOrigin(req: CompatRequest) {
    const origin = String(req.headers.get('origin') || '').trim()
    if (!origin) return false

    const allowed = getAllowedOrigins()
    const host = String(req.headers.get('host') || '').trim().toLowerCase()

    if (allowed.length > 0) {
      const target = origin.toLowerCase()
      return allowed.some(item => matchAllowedOrigin(item, target, host))
    }

    if (!host) return false

    try {
      return new URL(origin).host.toLowerCase() === host
    } catch {
      return false
    }
  }

  private getClientIp(req: CompatRequest) {
    return String((req.conn.remoteAddr as Deno.NetAddr | undefined)?.hostname || 'unknown')
  }

  connect(req: CompatRequest): Promise<Response> {
    const clientIp = this.getClientIp(req)

    if (!this.isAllowedOrigin(req)) {
      return Promise.resolve(new Response(null, { status: 403 }))
    }

    const openCount = this.ipConnections.get(clientIp) ?? 0
    if (openCount >= MAX_WS_CONNECTIONS_PER_IP) {
      return Promise.resolve(new Response(null, { status: 429 }))
    }

    try {
      const { socket, response } = Deno.upgradeWebSocket(req.rawRequest)
      this.ipConnections.set(clientIp, openCount + 1)
      const ws = new WebSocket(socket)

      ws.once('close', () => {
        this.clients.delete(ws)
        const current = this.ipConnections.get(clientIp) ?? 0
        if (current <= 1) this.ipConnections.delete(clientIp)
        else this.ipConnections.set(clientIp, current - 1)
      })

      this.clients.add(ws)
      this.options.onConnection(ws, req)
      return Promise.resolve(response)
    } catch (err) {
      this.options.onError(err as Error)
      return Promise.resolve(new Response(null, { status: 400 }))
    }
  }

  async close() {
    const clients = Array.from(this.clients)
    this.clients.clear()
    this.ipConnections.clear()
    await Promise.allSettled(clients.map(client => client.close(1001, 'Server shutdown')))
  }
}

export class WebSocket extends EventEmitter {
  webSocket?: globalThis.WebSocket
  state: WebSocketState = WebSocketState.CONNECTING

  constructor(socket?: globalThis.WebSocket) {
    super()
    if (socket) this.open(socket)
  }

  open(sock: globalThis.WebSocket) {
    this.webSocket = sock

    sock.onopen = () => {
      this.state = WebSocketState.OPEN
      this.emit('open')
    }

    sock.onmessage = event => {
      const payload = event.data
      if (typeof payload === 'string') {
        const byteLength = new TextEncoder().encode(payload).byteLength
        if (byteLength > MAX_WS_MESSAGE_BYTES) {
          this.close(1009, 'Message too big').catch(() => {})
          return
        }
        this.emit('message', payload)
        return
      }

      if (payload instanceof ArrayBuffer) {
        const bytes = new Uint8Array(payload)
        if (bytes.byteLength > MAX_WS_MESSAGE_BYTES) {
          this.close(1009, 'Message too big').catch(() => {})
          return
        }
        this.emit('message', bytes)
      }
    }

    sock.onerror = () => {
      this.emit('error', new WebSocketError('WebSocket error'))
    }

    sock.onclose = event => {
      this.state = WebSocketState.CLOSED
      this.emit('close', event.code)
    }
  }

  ping(_message?: string | Uint8Array) {
    // Native browser-style WebSocket does not expose ping frames.
    return
  }

  send(message: string | Uint8Array) {
    if (this.state === WebSocketState.CONNECTING || !this.webSocket) {
      throw new WebSocketError('WebSocket is not open: state 0 (CONNECTING)')
    }

    if (message instanceof Uint8Array) {
      this.webSocket.send(message)
      return
    }

    this.webSocket.send(message)
  }

  close(code = 1000, reason?: string): Promise<void> {
    if (
      this.state === WebSocketState.CLOSING ||
      this.state === WebSocketState.CLOSED ||
      !this.webSocket
    ) {
      return Promise.resolve()
    }

    this.state = WebSocketState.CLOSING
    this.webSocket.close(code, reason)
    return Promise.resolve()
  }

  closeForce() {
    return this.close(1001)
  }

  get isClosed(): boolean {
    return this.state === WebSocketState.CLOSED
  }
}
