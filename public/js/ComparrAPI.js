// deno-lint-ignore-file

export class ComparrAPI extends EventTarget {
  constructor() {
    super()
    this._basePath = location.pathname.replace(/\/(index\.html)?$/, '')

    const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${
      location.host
    }${this._basePath}/ws`
    console.log('🔌 Connecting WebSocket to:', wsUrl)

    this.socket = new WebSocket(wsUrl)

    this.socket.addEventListener('open', () => {
      console.log('✅ WebSocket connected successfully')
    })

    this.socket.addEventListener('error', err => {
      console.error('❌ WebSocket error:', err)
    })

    this.socket.addEventListener('close', event => {
      console.warn('⚠️ WebSocket closed:', event.code, event.reason)

      // Clear any pending buffer promises in main.js
      if (window.ensureMovieBufferPromise) {
        window.ensureMovieBufferPromise = null
      }
      if (window.isLoadingBatch !== undefined) {
        window.isLoadingBatch = false
      }

      // Show error to user
      const cardStack = document.querySelector('.js-card-stack')
      if (cardStack) {
        const hasVisibleMovies = cardStack.children.length > 0
        if (!hasVisibleMovies) {
          cardStack.style.setProperty(
            '--empty-text',
            '"Connection lost. Please refresh the page."'
          )
        }
      }

      // Show a notification
      if (window.showNotification) {
        window.showNotification('Connection lost. Please refresh the page.')
      }
    })

    this.socket.addEventListener('message', e => this.handleMessage(e))

    this._movieList = []

    window.addEventListener('beforeunload', () => {
      this.socket.close()
    })
  }
  // Recreate or wait until the WebSocket is OPEN before sending
  async _waitOpen() {
    // Already open? good to go.
    if (this.socket && this.socket.readyState === WebSocket.OPEN) return

    // Missing or closing/closed? recreate it
    if (!this.socket || this.socket.readyState >= WebSocket.CLOSING) {
      this.socket = new WebSocket(
        `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${
          this._basePath
        }/ws`
      )
      this.socket.addEventListener('message', e => this.handleMessage(e))
      // no need to re-add the beforeunload handler; the one in the constructor
      // references this.socket and will close the current instance at unload time
    }

    // CONNECTING? wait until it opens (or error)
    await new Promise((resolve, reject) => {
      if (this.socket.readyState === WebSocket.OPEN) return resolve()
      const onOpen = () => {
        cleanup()
        resolve()
      }
      const onErr = e => {
        cleanup()
        reject(e)
      }
      const cleanup = () => {
        this.socket.removeEventListener('open', onOpen)
        this.socket.removeEventListener('error', onErr)
      }
      this.socket.addEventListener('open', onOpen, { once: true })
      this.socket.addEventListener('error', onErr, { once: true })
    })
  }

  async getAccessPasswordStatus() {
    const res = await fetch(`${this._basePath}/api/access-password/status`)
    const data = await res.json().catch(() => ({}))

    if (res.status === 404) {
      // Endpoint intentionally disabled to avoid password-state disclosure.
      return { requiresPassword: true }
    }

    if (!res.ok) {
      throw new Error(data.message || 'Unable to check access password status.')
    }

    return {
      requiresPassword: Boolean(data.requiresPassword),
    }
  }

  async verifyAccessPassword(accessPassword) {
    const res = await fetch(`${this._basePath}/api/access-password/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessPassword }),
    })

    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.success) {
      throw new Error(
        data.message || 'Incorrect access password. Please try again.'
      )
    }

    return data
  }

  async logoutAccessSession() {
    await fetch(`${this._basePath}/api/access-password/logout`, {
      method: 'POST',
    }).catch(() => {})
  }

  // ── User auth (Plex / Jellyfin / Emby) ──────────────────────────────────

  async getAuthProviders() {
    const res = await fetch(`${this._basePath}/api/auth/providers`)
    if (!res.ok) return { providers: [], userAuthEnabled: false }
    return res.json().catch(() => ({ providers: [], userAuthEnabled: false }))
  }

  async getAuthUser() {
    console.debug('[api][auth] GET /api/auth/me')
    const res = await fetch(`${this._basePath}/api/auth/me`)
    console.debug('[api][auth] /api/auth/me response', { status: res.status })
    if (!res.ok) return { user: null }
    return res.json().catch(() => ({ user: null }))
  }

  async requestPlexPin() {
    console.info('[api][auth] POST /api/auth/plex/pin')
    const res = await fetch(`${this._basePath}/api/auth/plex/pin`, {
      method: 'POST',
    })
    const data = await res.json().catch(() => ({}))
    console.info('[api][auth] /api/auth/plex/pin response', {
      status: res.status,
      hasPinId: Boolean(data?.pinId),
      hasAuthUrl: Boolean(data?.authUrl),
      error: data?.error || null,
    })
    if (!res.ok) throw new Error(data.error || 'Could not start Plex login.')
    return data
  }

  async pollPlexPin(pinId) {
    console.debug('[api][auth] GET /api/auth/plex/pin/:pinId', { pinId })
    const res = await fetch(
      `${this._basePath}/api/auth/plex/pin/${encodeURIComponent(pinId)}`
    )
    const data = await res.json().catch(() => ({}))
    console.debug('[api][auth] /api/auth/plex/pin/:pinId response', {
      pinId,
      statusCode: res.status,
      status: data?.status || null,
      hasUser: Boolean(data?.user),
      error: data?.error || null,
    })
    if (!res.ok) throw new Error(data.error || 'Plex login check failed.')
    return data
  }

  async loginWithPlex(authToken, clientId) {
    const res = await fetch(`${this._basePath}/api/auth/plex`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        authToken: String(authToken || ''),
        clientId: String(clientId || ''),
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Plex login failed.')
    return data
  }

  async loginWithJellyfin(username, password) {
    const res = await fetch(`${this._basePath}/api/auth/jellyfin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Jellyfin login failed.')
    return data
  }

  async loginWithEmby(username, password) {
    const res = await fetch(`${this._basePath}/api/auth/emby`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Emby login failed.')
    return data
  }

  async logoutUser() {
    await fetch(`${this._basePath}/api/auth/logout`, {
      method: 'POST',
    }).catch(() => {})
  }

  async createGuestSession(guestToken) {
    const res = await fetch(`${this._basePath}/api/auth/guest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ guestToken: guestToken || '' }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Could not start guest session.')
    return data // { guestToken, roomCode, name }
  }

  async checkRoomExists(roomCode) {
    const normalizedCode = String(roomCode || '')
      .trim()
      .toUpperCase()

    const res = await fetch(
      `${this._basePath}/api/rooms/exists?code=${encodeURIComponent(
        normalizedCode
      )}`
    )
    const data = await res.json().catch(() => ({}))

    if (!res.ok || !data.success) {
      throw new Error(
        data.message || 'Unable to check room code. Please try again.'
      )
    }

    return data
  }

  async generateRoomCode() {
    const res = await fetch(`${this._basePath}/api/rooms/generate`, {
      method: 'POST',
    })
    const data = await res.json().catch(() => ({}))

    if (!res.ok || !data.success || !data.roomCode) {
      throw new Error(
        data.message ||
          'Unable to generate room code right now. Please try again.'
      )
    }

    return data.roomCode
  }

  async login(user, roomCode, accessPassword, forceTakeover = false) {
    await this._waitOpen()
    this.socket.send(
      JSON.stringify({
        type: 'login',
        payload: {
          name: user,
          roomCode,
          accessPassword,
          forceTakeover,
        },
      })
    )

    return new Promise((resolve, reject) => {
      this.addEventListener(
        'loginResponse',
        e => {
          if (e.data.success) {
            resolve(e.data)
          } else {
            const error = new Error(
              e.data.message ||
                e.data.error ||
                'Login failed. Please try again.'
            )
            if (e.data.code) {
              error.code = e.data.code
            }
            reject(error)
          }
        },
        { once: true }
      )
    })
  }

  handleMessage(e) {
    const data = JSON.parse(e.data)
    const debugWs =
      typeof window !== 'undefined' &&
      window.localStorage?.getItem('comparrDebugWs') === '1'
    if (debugWs) {
      console.log('📨 WebSocket message received:', data.type)
    }

    switch (data.type) {
      case 'batch': {
        console.log('📦 Batch received:', data.payload.length, 'movies')
        if (data.payload.length === 0) {
          console.error('❌ Empty batch received!')
        } else {
          console.log('🎬 First movie:', data.payload[0]?.title)
        }
        this.dispatchEvent(new MessageEvent('batch', { data: data.payload }))
        this._movieList.push(...data.payload)
        break
      }
      case 'match': {
        return this.dispatchEvent(
          new MessageEvent('match', { data: data.payload })
        )
      }
      case 'loginResponse': {
        this._movieList = data.payload.movies ?? []
        this.dispatchEvent(
          new MessageEvent('loginResponse', { data: data.payload })
        )
        break
      }
      case 'roomMembers': {
        this.dispatchEvent(
          new MessageEvent('roomMembers', { data: data.payload })
        )
        break
      }
      case 'error': {
        console.error('Server error:', data.payload)

        // Show user-friendly error notification
        const errorDiv = document.createElement('div')
        errorDiv.className = 'error-notification'

        const errorContent = document.createElement('div')
        errorContent.className = 'error-content'

        const icon = document.createElement('i')
        icon.className = 'fas fa-exclamation-triangle'

        const textWrap = document.createElement('div')
        const strong = document.createElement('strong')
        strong.textContent = 'Error'
        const p = document.createElement('p')
        p.textContent = String(data?.payload?.message || 'An error occurred.')
        textWrap.appendChild(strong)
        textWrap.appendChild(p)

        const closeBtn = document.createElement('button')
        closeBtn.className = 'error-close'
        const closeIcon = document.createElement('i')
        closeIcon.className = 'fas fa-times'
        closeBtn.appendChild(closeIcon)
        closeBtn.addEventListener('click', () => errorDiv.remove())

        errorContent.appendChild(icon)
        errorContent.appendChild(textWrap)
        errorContent.appendChild(closeBtn)
        errorDiv.appendChild(errorContent)

        document.body.appendChild(errorDiv)

        // Auto-remove after 10 seconds
        setTimeout(() => {
          if (errorDiv.parentElement) {
            errorDiv.remove()
          }
        }, 10000)

        this.dispatchEvent(new MessageEvent('error', { data: data.payload }))
        break
      }
      default: {
        // Forward unrecognised server messages (e.g. imdbImportProgress,
        // imdbImportMovie) as a generic 'message' event so other modules can
        // listen via api.addEventListener('message', ...) and inspect data.type.
        this.dispatchEvent(new MessageEvent('message', { data }))
        break
      }
    }
  }

  // ================== PASTE STARTS HERE ==================

  // Build the same base path you already use for the WebSocket (e.g. "/comparr" or "")
  _getBasePath() {
    return location.pathname.replace(/\/(index\.html)?$/, '')
  }

  /**
   * Read previously rated items for this user in this room.
   * If your server uses a different route or param names, change the URL below.
   * Returns whatever JSON your server sends; 404 returns an empty list.
   */
  async getUserDecisions(roomCode, userName) {
    const base = this._getBasePath()
    const url = `${base}/api/session-state?code=${encodeURIComponent(
      roomCode
    )}&user=${encodeURIComponent(userName)}`

    const res = await fetch(url)
    if (res.status === 404) {
      // No endpoint yet — let the caller proceed with no history.
      return { rated: [] }
    }
    if (!res.ok) {
      throw new Error(`GET ${url} failed: ${res.status}`)
    }
    return res.json()
  }

  /**
   * Return a minimal movie record from the in-memory list; no network call.
   * Used when hydrating the Watch/Pass tabs so we can show title/art.
   */
  async getMovieSummary(guid) {
    const m = this.getMovie(guid)
    if (!m) return null
    const { title, year, art } = m
    return { guid, title, year, art }
  }

  // ================== PASTE ENDS HERE ==================

  async getRecommendations(tmdbId) {
    const base = this._getBasePath()
    const url = `${base}/api/recommendations?tmdbId=${encodeURIComponent(
      tmdbId
    )}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`)
    return res.json()
  }

  async respond({ guid, wantsToWatch }) {
    await this._waitOpen()
    this.socket.send(
      JSON.stringify({
        type: 'response',
        payload: { guid, wantsToWatch },
      })
    )
  }

  async getMatches(roomCode, userName) {
    const base = this._getBasePath()
    const url = `${base}/api/matches?code=${encodeURIComponent(
      roomCode
    )}&user=${encodeURIComponent(userName)}`
    const res = await fetch(url)
    if (!res.ok) {
      throw new Error(`GET ${url} failed: ${res.status}`)
    }
    return res.json()
  }

  async requestNextBatch() {
    await this._waitOpen()

    this.socket.send(
      JSON.stringify({
        type: 'nextBatch',
      })
    )
    return new Promise(resolve =>
      this.addEventListener('batch', e => resolve(e.data), { once: true })
    )
  }

  async requestNextBatchWithFilters(filters) {
    await this._waitOpen()

    console.log('ComparrAPI received filters:', filters)
    console.log('Directors:', filters.directors)
    console.log('Actors:', filters.actors)

    const message = {
      type: 'nextBatch',
      payload: {
        yearMin: filters.yearRange.min,
        yearMax: filters.yearRange.max,
        genres: filters.genres,
        // streamingServices: filters.streamingServices,
        showPlexOnly: filters.showPlexOnly,
        availability: filters.availability,
        contentRatings: filters.contentRatings,
        imdbRating: filters.imdbRating,
        tmdbRating: filters.tmdbRating,
        languages: filters.languages,
        countries: filters.countries,
        runtimeMin: filters.runtimeRange.min,
        runtimeMax: filters.runtimeRange.max,
        voteCount: filters.voteCount,
        sortBy: filters.sortBy,
        // rtRating: filters.rtRating  // COMMENTED OUT
      },
    }

    console.log('🌐 FILTER DEBUG - WebSocket sending filters:')
    console.log(
      '  Year Range:',
      message.payload.yearMin,
      '-',
      message.payload.yearMax
    )
    console.log('  Genres:', message.payload.genres)
    // console.log('  Streaming:', message.payload.streamingServices);
    console.log('  Show Plex Only:', message.payload.showPlexOnly)
    console.log('  Content Ratings:', message.payload.contentRatings)
    console.log('  IMDb Rating:', message.payload.imdbRating)
    console.log('  TMDb Rating:', message.payload.tmdbRating)
    // console.log('  RT Rating:', message.payload.rtRating);  // COMMENTED OUT
    console.log('  Languages:', message.payload.languages)
    console.log('  Countries:', message.payload.countries)
    console.log(
      '  Runtime:',
      message.payload.runtimeMin,
      '-',
      message.payload.runtimeMax
    )
    console.log('  Vote Count:', message.payload.voteCount)
    console.log('  Sort By:', message.payload.sortBy)
    console.log('  Full message:', JSON.stringify(message, null, 2))

    this.socket.send(JSON.stringify(message))

    return new Promise(resolve =>
      this.addEventListener(
        'batch',
        e => {
          console.log('DEBUG: Received batch event:', e.data)
          resolve(e.data)
        },
        { once: true }
      )
    )
  }

  getMovie(guid) {
    return this._movieList.find(_ => _.guid === guid)
  }

  [Symbol.asyncIterator]() {
    this.movieListIndex = 0
    return {
      next: async () => {
        if (!this._movieList[this.movieListIndex]) {
          const batch = await this.requestNextBatch()
          if (batch.length === 0) {
            return { done: true }
          }
        }

        const value = [
          this._movieList[this.movieListIndex],
          this.movieListIndex,
        ]
        this.movieListIndex += 1
        return {
          value,
          done: false,
        }
      },
    }
  }
}
