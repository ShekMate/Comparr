// Global test setup for frontend tests
import { beforeEach, afterEach, vi } from 'vitest'

// Mock WebSocket globally
class MockWebSocket {
  constructor(url) {
    this.url = url
    this.readyState = MockWebSocket.OPEN
    this.onopen = null
    this.onmessage = null
    this.onerror = null
    this.onclose = null
    this.sentMessages = []
    this._eventListeners = new Map()

    // Simulate connection opening after a tick
    setTimeout(() => {
      if (this.onopen) {
        this.onopen({ type: 'open' })
      }
      this._dispatchEvent('open', { type: 'open' })
    }, 0)
  }

  addEventListener(event, handler, options) {
    if (!this._eventListeners.has(event)) {
      this._eventListeners.set(event, [])
    }
    this._eventListeners.get(event).push({ handler, once: options?.once })
  }

  removeEventListener(event, handler) {
    if (this._eventListeners.has(event)) {
      const listeners = this._eventListeners.get(event)
      const index = listeners.findIndex(l => l.handler === handler)
      if (index > -1) {
        listeners.splice(index, 1)
      }
    }
  }

  _dispatchEvent(event, data) {
    if (this._eventListeners.has(event)) {
      const listeners = this._eventListeners.get(event)
      const toRemove = []
      listeners.forEach((listener, index) => {
        listener.handler(data)
        if (listener.once) {
          toRemove.push(index)
        }
      })
      // Remove once listeners in reverse order
      toRemove.reverse().forEach(index => listeners.splice(index, 1))
    }
  }

  send(data) {
    this.sentMessages.push(data)
  }

  close() {
    this.readyState = MockWebSocket.CLOSED
    if (this.onclose) {
      this.onclose({ type: 'close' })
    }
    this._dispatchEvent('close', { type: 'close' })
  }

  // Test helper to simulate receiving a message
  simulateMessage(data) {
    const messageData = {
      data: typeof data === 'string' ? data : JSON.stringify(data),
    }
    if (this.onmessage) {
      this.onmessage(messageData)
    }
    this._dispatchEvent('message', messageData)
  }

  // Test helper to simulate error
  simulateError(error) {
    const errorData = { type: 'error', error }
    if (this.onerror) {
      this.onerror(errorData)
    }
    this._dispatchEvent('error', errorData)
  }
}

// Add static constants
MockWebSocket.CONNECTING = 0
MockWebSocket.OPEN = 1
MockWebSocket.CLOSING = 2
MockWebSocket.CLOSED = 3

// Assign to global
global.WebSocket = MockWebSocket

// Mock console methods to reduce noise in tests
beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})
