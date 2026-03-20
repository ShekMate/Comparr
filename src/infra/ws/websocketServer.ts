import { EventEmitter } from 'https://deno.land/std@0.79.0/node/events.ts'
import { ServerRequest } from 'https://deno.land/std@0.79.0/http/server.ts'
import {
  acceptWebSocket,
  isWebSocketCloseEvent,
  isWebSocketPingEvent,
  isWebSocketPongEvent,
} from 'https://deno.land/std@0.79.0/ws/mod.ts'

import type { WebSocket as STDWebSocket } from 'https://deno.land/std@0.79.0/ws/mod.ts'
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
  onConnection: (ws: WebSocket, req: ServerRequest) => void
  onError: (error: Error) => void
}

export class WebSocketServer {
  clients: Set<WebSocket> = new Set<WebSocket>()
  options: Options
  ipConnections = new Map<string, number>()

  constructor(options: Options) {
    this.options = options
  }

  private isAllowedOrigin(req: ServerRequest) {
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

  private getClientIp(req: ServerRequest) {
    return String((req.conn.remoteAddr as Deno.NetAddr | undefined)?.hostname || 'unknown')
  }

  async connect(req: ServerRequest) {
    const { conn, r: bufReader, w: bufWriter, headers } = req
    const clientIp = this.getClientIp(req)

    if (!this.isAllowedOrigin(req)) {
      await req.respond({ status: 403 })
      return
    }

    const openCount = this.ipConnections.get(clientIp) ?? 0
    if (openCount >= MAX_WS_CONNECTIONS_PER_IP) {
      await req.respond({ status: 429 })
      return
    }

    try {
      const sock = await acceptWebSocket({
        conn,
        bufReader,
        bufWriter,
        headers,
      })
      this.ipConnections.set(clientIp, openCount + 1)

      const ws: WebSocket = new WebSocket()
      ws.open(sock)
      ws.once('close', () => {
        const current = this.ipConnections.get(clientIp) ?? 0
        if (current <= 1) this.ipConnections.delete(clientIp)
        else this.ipConnections.set(clientIp, current - 1)
      })

      this.clients.add(ws)
      this.options.onConnection(ws, req)
    } catch (err) {
      this.options.onError(err)
      await req.respond({ status: 400 })
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
  webSocket?: STDWebSocket
  state: WebSocketState = WebSocketState.CONNECTING

  async open(sock: STDWebSocket) {
    this.webSocket = sock
    this.state = WebSocketState.OPEN
    this.emit('open')
    this.heartbeat()
    try {
      for await (const ev of sock) {
        if (typeof ev === 'string') {
          const byteLength = new TextEncoder().encode(ev).byteLength
          if (byteLength > MAX_WS_MESSAGE_BYTES) {
            await sock.close(1009, 'Message too big')
            break
          }
          this.emit('message', ev)
        } else if (ev instanceof Uint8Array) {
          if (ev.byteLength > MAX_WS_MESSAGE_BYTES) {
            await sock.close(1009, 'Message too big')
            break
          }
          this.emit('message', ev)
        } else if (isWebSocketPingEvent(ev)) {
          const [, body] = ev
          this.emit('ping', body)
        } else if (isWebSocketPongEvent(ev)) {
          const [, body] = ev
          this.emit('pong', body)
        } else if (isWebSocketCloseEvent(ev)) {
          const { code } = ev
          this.state = WebSocketState.CLOSED
          this.emit('close', code)
        }
      }
    } catch (err) {
      this.emit('close', err)
      if (!sock.isClosed) {
        await sock.close(1000).catch(e => {
          throw new WebSocketError(e)
        })
      }
    }
  }

  async heartbeat() {
    while (this.state === WebSocketState.OPEN) {
      if (this.isClosed) {
        this.emit('close', 1001)
        break
      }

      await new Promise(resolve => setTimeout(() => resolve, 2_000))
    }
  }

  ping(message?: string | Uint8Array) {
    if (this.state === WebSocketState.CONNECTING) {
      throw new WebSocketError('WebSocket is not open: state 0 (CONNECTING)')
    }
    return this.webSocket!.ping(message)
  }

  send(message: string | Uint8Array) {
    if (this.state === WebSocketState.CONNECTING) {
      throw new WebSocketError('WebSocket is not open: state 0 (CONNECTING)')
    }
    return this.webSocket!.send(message)
  }

  close(code = 1000, reason?: string): Promise<void> {
    if (
      this.state === WebSocketState.CLOSING ||
      this.state === WebSocketState.CLOSED
    ) {
      return Promise.resolve()
    }

    this.state = WebSocketState.CLOSING
    return this.webSocket!.close(code, reason!)
  }

  closeForce() {
    if (
      this.state === WebSocketState.CLOSING ||
      this.state === WebSocketState.CLOSED
    ) {
      return
    }
    this.state = WebSocketState.CLOSING
    return this.webSocket!.closeForce()
  }

  get isClosed(): boolean | undefined {
    return this.webSocket!.isClosed
  }
}
