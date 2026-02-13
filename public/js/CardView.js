// deno-lint-ignore-file

export default class CardView {
  constructor(movieData, eventTarget) {
    this.movieData = movieData
    this.eventTarget = eventTarget
    this.animationDuration = 500
    this.basePath = document.body.dataset.basePath
    this.render()
  }

  render() {
    // Get cardList dynamically each time to ensure it exists
    const cardList = document.querySelector('.js-card-stack')
    if (!cardList) {
      console.error('❌ CardView: .js-card-stack not found in DOM!')
      return
    }

    const node = document.createElement('div')
    this.node = node
    node.classList.add('card')

    node.addEventListener('rate', e =>
      this.rate(e.data, this.getAnimation(e.data ? 'right' : 'left'))
    )

    const {
      title,
      type,
      art,
      year,
      guid,
      summary = '',
      rating = '',
    } = this.movieData
    node.dataset.guid = guid

    console.log(
      'DEBUG CardView art:',
      art,
      'starts with https:',
      art.startsWith('https://')
    )

    // Treat "/<digits>/thumb/<digits>" as a Plex-only path (not a real image file)
    const isPlexThumb = u => !!u && /^\/\d+\/thumb\/\d+/.test(u)

    // Treat "/<digits>/thumb/<digits>" as a Plex-only path (not a real image file)
    const isPlexThumbCore = u => /^\/\d+\/thumb\/\d+/.test(u || '')

    // Normalize any legacy or partial poster path into a canonical, loadable URL
    const normalizeArt = u => {
      if (!u) return u

      // Strip known local prefixes to inspect the core path
      let core = u
      if (core.startsWith('/tmdb-poster/'))
        core = core.slice('/tmdb-poster'.length)
      if (core.startsWith('/poster/')) core = core.slice('/poster'.length)

      // If the core path is a Plex thumb id, do NOT request it
      if (isPlexThumbCore(core)) return ''

      // Already-final or full URLs
      if (u.startsWith('/cached-poster/') || u.startsWith('/tmdb-poster/'))
        return u
      if (u.startsWith('http://') || u.startsWith('https://')) return u

      // Legacy -> canonical
      if (u.startsWith('/poster/'))
        return '/tmdb-poster/' + u.slice('/poster/'.length)

      // Raw TMDB path like "/h7wJ...jpg"
      return '/tmdb-poster' + (u.startsWith('/') ? u : '/' + u)
    }

    const finalArt = normalizeArt(art)

    node.innerHTML = `
      <div class="poster-wrapper">
        <button type="button" class="undo-button" aria-label="Undo" title="Undo last rating">
          <i class="fas fa-undo"></i>
        </button>
        <img
          class="poster"
          src="${
            finalArt.startsWith('http')
              ? finalArt
              : `${this.basePath || ''}${finalArt}`
          }"
          decoding="async"
          alt="${title} poster"
        />
      </div>

      <div class="card-meta">
        <div class="card-title">
          ${title}${type === 'movie' ? ` (${year})` : ''}
        </div>
        ${this.renderCrewInfo()}
        ${
          summary
            ? `<p class="card-plot" onclick="this.closest('.card')._handlePlot(event)">${summary}</p>`
            : ''
        }
        ${rating ? `<div class="card-ratings">${rating}</div>` : ''}

        <div class="rate-controls">
          <div class="button-wrapper">
            <button type="button" class="rate-thumbs-down" aria-label="Thumbs down" onclick="this.closest('.card')._handleDown(event)">
              <i class="fas fa-thumbs-down"></i>
              <span class="button-label">Pass</span>
            </button>
          </div>
          <div class="button-wrapper">
            <button type="button" class="rate-seen" aria-label="Mark as seen" onclick="this.closest('.card')._handleSeen(event)">
              <i class="fas fa-eye"></i>
              <span class="button-label">Seen</span>
            </button>
          </div>
          <div class="button-wrapper">
            <button type="button" class="rate-thumbs-up" aria-label="Thumbs up" onclick="this.closest('.card')._handleUp(event)">
              <i class="fas fa-thumbs-up"></i>
              <span class="button-label">Watch</span>
            </button>
          </div>
        </div>
      </div>
    `

    // Wire the three buttons to dispatch the "rate" message
    const upBtn = node.querySelector('.rate-thumbs-up')
    const downBtn = node.querySelector('.rate-thumbs-down')
    const seenBtn = node.querySelector('.rate-seen')
    const undoBtn = node.querySelector('.undo-button')

    const handleRate = value => {
      return e => {
        e.preventDefault()
        e.stopPropagation()
        node.dispatchEvent(new MessageEvent('rate', { data: value }))
      }
    }

    const handleUndo = e => {
      e.preventDefault()
      e.stopPropagation()
      this.eventTarget.dispatchEvent(new Event('undo'))
    }

    // Use touchend for mobile, click for desktop
    upBtn?.addEventListener('touchend', handleRate(true), { passive: false })
    upBtn?.addEventListener('click', handleRate(true))

    downBtn?.addEventListener('touchend', handleRate(false), { passive: false })
    downBtn?.addEventListener('click', handleRate(false))

    seenBtn?.addEventListener('touchend', handleRate(null), { passive: false })
    seenBtn?.addEventListener('click', handleRate(null))

    undoBtn?.addEventListener('touchend', handleUndo, { passive: false })
    undoBtn?.addEventListener('click', handleUndo)

    // Add handlers for plot expansion
    const plotEl = node.querySelector('.card-plot')
    const handlePlotToggle = e => {
      e.preventDefault()
      e.stopPropagation()
      plotEl.classList.toggle('expanded')
    }

    plotEl?.addEventListener('touchend', handlePlotToggle, { passive: false })
    plotEl?.addEventListener('click', handlePlotToggle)

    // Attach swipe handler ONLY to poster to allow scrolling on text/metadata areas
    // Only enable swipe on touch-capable devices (mobile/tablet)
    const posterEl = node.querySelector('.poster')
    const isTouchDevice =
      'ontouchstart' in window || navigator.maxTouchPoints > 0
    if (isTouchDevice) {
      posterEl?.addEventListener('pointerdown', this.handleSwipe)
    }

    // Append to card stack
    console.log(
      `🎴 CardView: Appending card for "${this.movieData.title}" to stack`
    )
    cardList.appendChild(node)
    console.log(
      `✅ CardView: Card appended. Stack now has ${cardList.children.length} cards`
    )
  }

  async rate(wantsToWatch, animation) {
    // Debounce rapid swipes on mobile
    const now = Date.now()
    if (this.lastRateTime && now - this.lastRateTime < 300) {
      console.log('⚠️ Debouncing rapid swipe')
      return
    }
    this.lastRateTime = now

    // tell controller a new top card is coming
    this.eventTarget.dispatchEvent(new Event('newTopCard'))

    // finish or fast-forward current animation
    if (animation.playState !== 'finished') {
      if (animation.currentTime === this.animationDuration) {
        animation.finish()
      } else {
        animation.playbackRate = 3
        animation.play()
      }
      await animation.finished
    }

    // send response up
    this.eventTarget.dispatchEvent(
      new MessageEvent('response', {
        data: {
          guid: this.movieData.guid,
          wantsToWatch,
        },
      })
    )

    // remove this card
    this.destroy()
  }

  handleSwipe = startEvent => {
    const isButton = startEvent.target.closest('button')
    const isPlot = startEvent.target.closest('.card-plot')

    if (
      (startEvent.pointerType === 'mouse' && startEvent.button !== 0) ||
      isButton || // clicking a thumb: don't start swipe
      isPlot // clicking plot: don't start swipe
    ) {
      return
    }

    // Don't prevent default or capture yet - wait for movement
    const maxX = window.innerWidth
    let hasMoved = false
    let currentDirection
    let position = 0

    const handleMove = e => {
      // Only start swipe if moved more than 10px
      if (!hasMoved) {
        const deltaX = Math.abs(e.x - startEvent.x)
        const deltaY = Math.abs(e.y - startEvent.y)

        if (deltaX < 10 && deltaY < 10) return // Ignore small movements (could be a tap)

        // Check if movement is primarily vertical (scrolling) or horizontal (swiping)
        if (deltaY > deltaX) {
          // Vertical movement detected - allow scrolling, stop tracking this gesture
          this.node.removeEventListener('pointermove', handleMove)
          return
        }

        // Now we know it's a horizontal swipe, not a tap or scroll
        hasMoved = true
        startEvent.preventDefault()
        this.node.setPointerCapture(startEvent.pointerId)
        this.animationFrameRequestId = requestAnimationFrame(() =>
          this.animationLoop()
        )
      }

      const direction = e.x < startEvent.x ? 'left' : 'right'
      const delta = e.x - startEvent.x

      position =
        direction === 'left'
          ? Math.abs(delta) / startEvent.x
          : delta / (maxX - startEvent.x)

      if (currentDirection != direction) {
        currentDirection = direction
        this.animation = this.getAnimation(direction)
        this.animation.pause()
      }

      this.currentTime =
        Math.max(0, Math.min(1, position)) * this.animationDuration
    }

    this.node.addEventListener('pointermove', handleMove, { passive: false })
    this.node.addEventListener(
      'pointerup',
      async () => {
        this.node.removeEventListener('pointermove', handleMove)
        if (hasMoved) {
          cancelAnimationFrame(this.animationFrameRequestId)
          if (this.animation) {
            if (position >= 0.5) {
              await this.rate(currentDirection === 'right', this.animation)
            } else {
              this.animation.reverse()
            }

            this.animation = null
            currentDirection = null
          }
        }
      },
      { once: true }
    )
  }

  animationLoop() {
    if (this.animation) {
      this.animation.currentTime = this.currentTime
    }
    this.animationFrameRequestId = requestAnimationFrame(() =>
      this.animationLoop()
    )
  }

  getAnimation(direction) {
    return this.node.animate(
      {
        transform: [
          'translate(0, 0)',
          `translate(${direction === 'left' ? '-50vw' : '50vw'}, 0)`,
        ],
        opacity: ['1', '0.8', '0'],
      },
      {
        duration: this.animationDuration,
        easing: 'ease-in-out',
        fill: 'both',
      }
    )
  }

  renderCrewInfo() {
    const { director, writers, cast, genres, contentRating } = this.movieData

    console.log('DEBUG renderCrewInfo:', {
      director,
      writersCount: writers?.length,
      writers: writers?.slice(0, 3),
      castCount: cast?.length,
      cast: cast?.slice(0, 3),
      genresCount: genres?.length,
      genres,
      contentRating,
    })

    const lines = []

    // Content Rating + Genres combined line
    const ratingGenreParts = []

    // Add content rating if available
    if (contentRating && contentRating !== 'N/A') {
      ratingGenreParts.push(
        `<i class="fas fa-shield-alt"></i> ${contentRating}`
      )
    }

    // Add genres if available
    if (genres && Array.isArray(genres) && genres.length > 0) {
      const maxGenres = window.innerWidth <= 600 ? 3 : 4
      const displayGenres = genres.slice(0, maxGenres)
      const hasMore = genres.length > maxGenres
      ratingGenreParts.push(
        `<i class="fas fa-theater-masks"></i> ${displayGenres.join(', ')}${
          hasMore ? '...' : ''
        }`
      )
    }

    // âœ… Runtime (new block you added)
    const runtimeMin = (() => {
      const m = this.movieData
      const minuteCandidates = [
        Number(m.runtime),
        Number(m.tmdbRuntime),
        Number(m.runtimeMinutes),
      ].filter(v => Number.isFinite(v) && v > 0)
      if (minuteCandidates.length && minuteCandidates[0] < 1000)
        return Math.round(minuteCandidates[0])
      if (Number.isFinite(m.duration) && m.duration > 0)
        return Math.round(m.duration / 60000)
      return null
    })()
    if (runtimeMin) {
      ratingGenreParts.push(`<i class="fas fa-clock"></i> ${runtimeMin} min`)
    }

    // Combine with separator if both exist
    if (ratingGenreParts.length > 0) {
      lines.push(
        `<div class="crew-line" onclick="this.classList.toggle('expanded')">${ratingGenreParts.join(
          ' <span style="opacity: 0.5; margin: 0 0.25rem;">|</span> '
        )}</div>`
      )
    }

    // Director
    if (director && director !== 'undefined') {
      lines.push(
        `<div class="crew-line" onclick="this.classList.toggle('expanded')"><i class="fas fa-video"></i> ${director}</div>`
      )
    }

    // Writers (show max 2 on mobile, 3 on desktop)
    if (writers && Array.isArray(writers) && writers.length > 0) {
      const maxWriters = window.innerWidth <= 600 ? 2 : 3
      const displayWriters = writers.slice(0, maxWriters)
      const hasMore = writers.length > maxWriters
      lines.push(
        `<div class="crew-line" onclick="this.classList.toggle('expanded')"><i class="fas fa-pen"></i> ${displayWriters.join(
          ', '
        )}${hasMore ? ' & more' : ''}</div>`
      )
    }

    // Cast (show max 3 on mobile, 4 on desktop)
    if (cast && Array.isArray(cast) && cast.length > 0) {
      const maxCast = window.innerWidth <= 600 ? 3 : 4
      const displayCast = cast.slice(0, maxCast)
      const hasMore = cast.length > maxCast
      lines.push(
        `<div class="crew-line" onclick="this.classList.toggle('expanded')"><i class="fas fa-users"></i> ${displayCast.join(
          ', '
        )}${hasMore ? ' & more' : ''}</div>`
      )
    }

    console.log('DEBUG lines generated:', lines.length)

    if (lines.length === 0) return ''

    return `<div class="card-crew">${lines.join('')}</div>`
  }

  destroy() {
    this.node.remove()
  }
}
