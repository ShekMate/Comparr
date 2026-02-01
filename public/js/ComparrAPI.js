// deno-lint-ignore-file

export class ComparrAPI extends EventTarget {
  constructor() {
  super()
  const basePath = location.pathname.replace(/\/(index\.html)?$/, '')
  
  const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${basePath}/ws`;
  console.log('🔌 Connecting WebSocket to:', wsUrl);

  this.socket = new WebSocket(wsUrl)
  
  this.socket.addEventListener('open', () => {
    console.log('✅ WebSocket connected successfully');
  });
  
  this.socket.addEventListener('error', (err) => {
    console.error('❌ WebSocket error:', err);
  });
  
  this.socket.addEventListener('close', (event) => {
    console.warn('⚠️ WebSocket closed:', event.code, event.reason);
    
    // Clear any pending buffer promises in main.js
    if (window.ensureMovieBufferPromise) {
      window.ensureMovieBufferPromise = null;
    }
    if (window.isLoadingBatch !== undefined) {
      window.isLoadingBatch = false;
    }
    
    // Show error to user
    const cardStack = document.querySelector('.js-card-stack');
    if (cardStack) {
      const hasVisibleMovies = cardStack.children.length > 0;
      if (!hasVisibleMovies) {
        cardStack.style.setProperty(
          '--empty-text',
          '"Connection lost. Please refresh the page."'
        );
      }
    }
    
    // Show a notification
    if (window.showNotification) {
      window.showNotification('Connection lost. Please refresh the page.');
    }
  });

  this.socket.addEventListener('message', e => this.handleMessage(e))

    this._movieList = []

    window.addEventListener('beforeunload', () => {
      this.socket.close()
    })
  }
    // Recreate or wait until the WebSocket is OPEN before sending
  async _waitOpen() {
    // Already open? good to go.
    if (this.socket && this.socket.readyState === WebSocket.OPEN) return;

    // Missing or closing/closed? recreate it
    if (!this.socket || this.socket.readyState >= WebSocket.CLOSING) {
      const basePath = location.pathname.replace(/\/(index\.html)?$/, '');
      this.socket = new WebSocket(
        `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${basePath}/ws`
      );
      this.socket.addEventListener('message', e => this.handleMessage(e));
      // no need to re-add the beforeunload handler; the one in the constructor
      // references this.socket and will close the current instance at unload time
    }

    // CONNECTING? wait until it opens (or error)
    await new Promise((resolve, reject) => {
      if (this.socket.readyState === WebSocket.OPEN) return resolve();
      const onOpen = () => { cleanup(); resolve(); };
      const onErr  = (e) => { cleanup(); reject(e); };
      const cleanup = () => {
        this.socket.removeEventListener('open', onOpen);
        this.socket.removeEventListener('error', onErr);
      };
      this.socket.addEventListener('open',  onOpen, { once: true });
      this.socket.addEventListener('error', onErr,  { once: true });
    });
  }

  async login(user, roomCode, accessPassword) {
    await this._waitOpen();
	this.socket.send(
      JSON.stringify({
        type: 'login',
        payload: {
          name: user,
          roomCode,
          accessPassword,
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
            reject(new Error(`${user} is already logged in.`))
          }
        },
        { once: true }
      )
    })
  }

  handleMessage(e) {
    const data = JSON.parse(e.data)
    console.log('📨 WebSocket message received:', data.type);

    switch (data.type) {
      case 'batch': {
        console.log('📦 Batch received:', data.payload.length, 'movies');
        if (data.payload.length === 0) {
          console.error('❌ Empty batch received!');
        } else {
          console.log('🎬 First movie:', data.payload[0]?.title);
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
      case 'error': {
        console.error('Server error:', data.payload)
        
        // Show user-friendly error notification
        const errorDiv = document.createElement('div')
        errorDiv.className = 'error-notification'
        errorDiv.innerHTML = `
          <div class="error-content">
            <i class="fas fa-exclamation-triangle"></i>
            <div>
              <strong>Error</strong>
              <p>${data.payload.message}</p>
            </div>
            <button onclick="this.parentElement.parentElement.remove()" class="error-close">
              <i class="fas fa-times"></i>
            </button>
          </div>
        `
        
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
    }
  }

  // ================== PASTE STARTS HERE ==================

  // Build the same base path you already use for the WebSocket (e.g. "/comparr" or "")
  _getBasePath() {
    return location.pathname.replace(/\/(index\.html)?$/, '');
  }

  /**
   * Read previously rated items for this user in this room.
   * If your server uses a different route or param names, change the URL below.
   * Returns whatever JSON your server sends; 404 returns an empty list.
   */
  async getUserDecisions(roomCode, userName) {
    const base = this._getBasePath();
    const url  = `${base}/api/session-state?code=${encodeURIComponent(roomCode)}&user=${encodeURIComponent(userName)}`;

    const res = await fetch(url);
    if (res.status === 404) {
      // No endpoint yet — let the caller proceed with no history.
      return { rated: [] };
    }
    if (!res.ok) {
      throw new Error(`GET ${url} failed: ${res.status}`);
    }
    return res.json();
  }

  /**
   * Return a minimal movie record from the in-memory list; no network call.
   * Used when hydrating the Watch/Pass tabs so we can show title/art.
   */
  async getMovieSummary(guid) {
    const m = this.getMovie(guid);
    if (!m) return null;
    const { title, year, art } = m;
    return { guid, title, year, art };
  }

  // ================== PASTE ENDS HERE ==================

  async respond({ guid, wantsToWatch }) {
    await this._waitOpen();
    this.socket.send(
      JSON.stringify({
        type: 'response',
        payload: { guid, wantsToWatch },
      })
    )
  }

  async requestNextBatch() {
    await this._waitOpen();
	
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
    await this._waitOpen();

	console.log('ComparrAPI received filters:', filters);
    console.log('Directors:', filters.directors);
    console.log('Actors:', filters.actors);

    const message = {
      type: 'nextBatch',
      payload: {
        yearMin: filters.yearRange.min,
        yearMax: filters.yearRange.max,
        genres: filters.genres,
        // streamingServices: filters.streamingServices,
        showPlexOnly: filters.showPlexOnly,
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
      }
    };

    console.log('🌐 FILTER DEBUG - WebSocket sending filters:');
    console.log('  Year Range:', message.payload.yearMin, '-', message.payload.yearMax);
    console.log('  Genres:', message.payload.genres);
    // console.log('  Streaming:', message.payload.streamingServices);
    console.log('  Show Plex Only:', message.payload.showPlexOnly);
    console.log('  Content Ratings:', message.payload.contentRatings);
    console.log('  IMDb Rating:', message.payload.imdbRating);
    console.log('  TMDb Rating:', message.payload.tmdbRating);
    // console.log('  RT Rating:', message.payload.rtRating);  // COMMENTED OUT
    console.log('  Languages:', message.payload.languages);
    console.log('  Countries:', message.payload.countries);
    console.log('  Runtime:', message.payload.runtimeMin, '-', message.payload.runtimeMax);
    console.log('  Vote Count:', message.payload.voteCount);
    console.log('  Sort By:', message.payload.sortBy);
    console.log('  Full message:', JSON.stringify(message, null, 2));
    
    this.socket.send(JSON.stringify(message));
    
    return new Promise(resolve =>
      this.addEventListener('batch', e => {
        console.log('DEBUG: Received batch event:', e.data);
        resolve(e.data);
      }, { once: true })
    );
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
