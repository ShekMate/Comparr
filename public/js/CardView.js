import { escapeHtml } from './utils.js'

// deno-lint-ignore-file

function openTrailerModal(trailerKey) {
  document.getElementById('trailer-modal')?.remove()

  const origin = encodeURIComponent(location.origin)
  const modal = document.createElement('div')
  modal.id = 'trailer-modal'
  modal.className = 'trailer-modal-overlay'
  modal.innerHTML = `
    <div class="trailer-modal-content">
      <button class="trailer-modal-close" type="button" aria-label="Close trailer">
        <i class="fas fa-times"></i>
      </button>
      <div class="trailer-modal-iframe-wrap">
        <iframe
          class="trailer-modal-iframe"
          src="https://www.youtube.com/embed/${encodeURIComponent(trailerKey)}?autoplay=1&rel=0&enablejsapi=1&origin=${origin}"
          allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
          allowfullscreen
          referrerpolicy="strict-origin-when-cross-origin"
        ></iframe>
      </div>
    </div>
  `

  const showFallback = () => {
    const wrap = modal.querySelector('.trailer-modal-iframe-wrap')
    if (!wrap) return
    wrap.innerHTML = `
      <div class="trailer-modal-blocked">
        <i class="fas fa-lock"></i>
        <p>This trailer can't be embedded because it's age-restricted on YouTube.</p>
        <a class="trailer-modal-yt-link"
           href="https://www.youtube.com/watch?v=${encodeURIComponent(trailerKey)}"
           target="_blank" rel="noopener noreferrer">
          <i class="fab fa-youtube"></i> Watch on YouTube
        </a>
      </div>
    `
  }

  const onMessage = e => {
    if (e.origin !== 'https://www.youtube.com') return
    try {
      const data = JSON.parse(e.data)
      if (data.event === 'onError' && (data.info === 101 || data.info === 150)) {
        showFallback()
      }
    } catch {}
  }

  const close = () => {
    const iframe = modal.querySelector('iframe')
    if (iframe) iframe.src = ''
    modal.remove()
    document.removeEventListener('keydown', onEsc)
    window.removeEventListener('message', onMessage)
  }

  const onEsc = e => { if (e.key === 'Escape') close() }

  modal.addEventListener('click', e => { if (e.target === modal) close() })
  modal.querySelector('.trailer-modal-close').addEventListener('click', close)
  document.addEventListener('keydown', onEsc)
  window.addEventListener('message', onMessage)

  document.body.appendChild(modal)
}

function getLanguageDisplayName(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''

  // Keep plain-language values untouched (e.g., "English")
  if (!/^[a-z]{2,3}(?:-[a-z]{2})?$/i.test(raw)) return raw

  try {
    const normalized = raw.replace('_', '-')
    const languageCode = normalized.split('-')[0].toLowerCase()
    const region = normalized.split('-')[1]?.toUpperCase()
    const localeCode = region ? `${languageCode}-${region}` : languageCode
    const display = new Intl.DisplayNames(['en'], { type: 'language' }).of(
      localeCode
    )
    return display || raw
  } catch {
    return raw
  }
}

export default class CardView {
  constructor(movieData, eventTarget) {
    this.movieData = movieData
    this.eventTarget = eventTarget
    this.animationDuration = 500
    this.swipeThreshold = 100
    this.flickVelocityThreshold = 500
    this.throwDistance = 300
    this.dragActivationThreshold = 5
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
      rating = '',
      summary = '',
      genres = [],
    } = this.movieData
    node.dataset.guid = guid

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

    const titleLine = `${escapeHtml(title)}${
      type === 'movie'
        ? ` <span class="poster-year">(${escapeHtml(year)})</span>`
        : ''
    }`
    const genreLine = Array.isArray(genres)
      ? genres.slice(0, 2).map(escapeHtml).join(' • ')
      : ''

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
          alt="${escapeHtml(title)} poster"
          draggable="false"
        />
        <div class="poster-overlay">
          <div class="poster-overlay-content">
            <div class="poster-title">${titleLine}</div>
            ${genreLine ? `<div class="poster-genres">${genreLine}</div>` : ''}
            ${rating ? `<div class="card-ratings compact">${rating}</div>` : ''}
            ${
              summary
                ? `<p class="card-plot card-plot-preview">${escapeHtml(
                    summary
                  )}</p>`
                : ''
            }
          </div>
        </div>
      </div>

      <div class="card-meta">
        ${this.renderCrewInfo()}
      </div>
    `

    const undoBtn = node.querySelector('.undo-button')
    const posterWrapper = node.querySelector('.poster-wrapper')

    const handleUndo = e => {
      e.preventDefault()
      e.stopPropagation()
      this.eventTarget.dispatchEvent(new Event('undo'))
    }

    undoBtn?.addEventListener('touchend', handleUndo, { passive: false })
    undoBtn?.addEventListener('click', handleUndo)

    posterWrapper?.addEventListener('click', e => {
      if (e.target.closest('.undo-button')) return
      if (this.didDragCard) {
        this.didDragCard = false
        return
      }
      node.classList.toggle('details-expanded')
    })

    // Add handlers for plot expansion
    const plotEl = node.querySelector('.card-plot')
    const handlePlotToggle = e => {
      e.preventDefault()
      e.stopPropagation()
      plotEl.classList.toggle('expanded')
    }

    plotEl?.addEventListener('touchend', handlePlotToggle, { passive: false })
    plotEl?.addEventListener('click', handlePlotToggle)

    const trailerBtn = node.querySelector('.card-trailer-btn[data-trailer-key]')
    trailerBtn?.addEventListener('click', e => {
      e.stopPropagation()
      openTrailerModal(trailerBtn.dataset.trailerKey)
    })

    // Attach swipe handler ONLY to poster to allow scrolling on text/metadata areas
    // Pointer events support touch + mouse, so desktop users can click-and-drag too.
    const posterEl = node.querySelector('.poster')
    posterEl?.addEventListener('pointerdown', this.handleSwipe)

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
    let hasMoved = false
    let currentOffsetX = 0
    let currentOffsetY = 0
    const dragStartTime = performance.now()

    const handleMove = e => {
      // Only start swipe if moved more than 10px
      if (!hasMoved) {
        const deltaX = Math.abs(e.clientX - startEvent.clientX)
        const deltaY = Math.abs(e.clientY - startEvent.clientY)

        if (
          deltaX < this.dragActivationThreshold &&
          deltaY < this.dragActivationThreshold
        )
          return // Ignore tiny movement (could be a tap)

        // Check if movement is primarily vertical (scrolling) or horizontal (swiping)
        if (deltaY > deltaX) {
          // Vertical movement detected - allow scrolling, stop tracking this gesture
          this.node.removeEventListener('pointermove', handleMove)
          return
        }

        // Now we know it's a horizontal swipe, not a tap or scroll
        hasMoved = true
        this.didDragCard = true
        startEvent.preventDefault()
        this.node.setPointerCapture(startEvent.pointerId)
        this.node.classList.add('is-dragging')
        this.node.style.transition = 'none'
        this.node.style.willChange = 'transform, opacity'
      }

      currentOffsetX = e.clientX - startEvent.clientX
      currentOffsetY = e.clientY - startEvent.clientY

      const rotateDeg = Math.max(-25, Math.min(25, currentOffsetX / 10))
      const opacity = Math.max(
        0.4,
        1 - Math.min(Math.abs(currentOffsetX) / 350, 0.6)
      )
      this.node.style.transform = `translate3d(${currentOffsetX}px, ${currentOffsetY}px, 0) rotate(${rotateDeg}deg)`
      this.node.style.opacity = `${opacity}`
    }

    this.node.addEventListener('pointermove', handleMove, { passive: false })
    this.node.addEventListener(
      'pointerup',
      async () => {
        this.node.removeEventListener('pointermove', handleMove)
        this.node.classList.remove('is-dragging')
        this.node.style.willChange = ''
        if (hasMoved) {
          const elapsedMs = Math.max(1, performance.now() - dragStartTime)
          const velocityX = (currentOffsetX / elapsedMs) * 1000
          const velocityY = (currentOffsetY / elapsedMs) * 1000
          const absX = Math.abs(currentOffsetX)
          const absY = Math.abs(currentOffsetY)
          const direction = currentOffsetX < 0 ? 'left' : 'right'

          // Horizontal-dominance guard + OR thresholds (distance OR flick velocity)
          const qualifiesSwipe =
            absX > absY &&
            (absX > this.swipeThreshold ||
              Math.abs(velocityX) > this.flickVelocityThreshold)

          if (qualifiesSwipe) {
            const throwTargetX =
              direction === 'left' ? -this.throwDistance : this.throwDistance
            const throwTargetY = currentOffsetY + velocityY * 0.2
            await this.rate(
              direction === 'right',
              this.getThrowAnimation(throwTargetX, throwTargetY)
            )
          } else {
            this.animateSnapBack()
          }
        } else {
          this.node.style.transform = ''
          this.node.style.opacity = ''
          this.node.style.transition = ''
        }
      },
      { once: true }
    )

    this.node.addEventListener(
      'pointercancel',
      () => {
        this.node.removeEventListener('pointermove', handleMove)
        this.node.classList.remove('is-dragging')
        this.node.style.willChange = ''
        this.animateSnapBack()
      },
      { once: true }
    )
  }

  animateSnapBack() {
    this.node.animate(
      [
        {
          transform:
            this.node.style.transform || 'translate(0, 0) rotate(0deg)',
          opacity: this.node.style.opacity || '1',
        },
        { transform: 'translate(0, 0) rotate(0deg)', opacity: 1 },
      ],
      {
        duration: 250,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        fill: 'forwards',
      }
    )
    this.node.style.transform = ''
    this.node.style.opacity = ''
    this.node.style.transition = ''
  }

  getThrowAnimation(targetX, targetY) {
    return this.node.animate(
      {
        transform: [
          this.node.style.transform || 'translate(0, 0) rotate(0deg)',
          `translate(${targetX}px, ${targetY}px) rotate(${
            targetX < 0 ? -20 : 20
          }deg)`,
        ],
        opacity: [this.node.style.opacity || '1', '0'],
      },
      {
        duration: 250,
        easing: 'ease-out',
        fill: 'both',
      }
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
    const {
      title,
      year,
      director,
      writers,
      cast,
      castMembers,
      genres,
      contentRating,
      summary,
      rating,
      originalLanguage,
      original_language,
      language,
      watchProviders,
      streamingServices,
      trailerKey,
    } = this.movieData

    console.log('DEBUG renderCrewInfo:', {
      director,
      writersCount: writers?.length,
      writers: writers?.slice(0, 3),
      castCount: cast?.length,
      cast: cast?.slice(0, 3),
      castMembersCount: castMembers?.length,
      castMembers: castMembers?.slice(0, 3),
      genresCount: genres?.length,
      genres,
      contentRating,
    })

    const lines = []

    if (title) {
      const titleWithYear = `${escapeHtml(title)}${
        year
          ? ` <span class="crew-title-year">(${escapeHtml(year)})</span>`
          : ''
      }`
      lines.push(`<div class="crew-title">${titleWithYear}</div>`)
    }

    // IMDb/TMDb ratings + trailer button on same row
    if (rating || trailerKey) {
      const trailerBtnHtml = trailerKey
        ? `<button class="card-trailer-btn" type="button" data-trailer-key="${escapeHtml(trailerKey)}"><i class="fas fa-play"></i> Trailer</button>`
        : ''
      lines.push(
        `<div class="card-ratings-row" onclick="event.stopPropagation()">` +
        (rating ? `<div class="card-ratings">${rating}</div>` : '') +
        trailerBtnHtml +
        `</div>`
      )
    }

    // Content Rating + Genres combined line
    const ratingGenreParts = []

    // Add content rating if available
    if (contentRating && contentRating !== 'N/A') {
      ratingGenreParts.push(
        `<i class="fas fa-shield-alt"></i> ${escapeHtml(contentRating)}`
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

    const rawOriginalLanguage =
      originalLanguage || original_language || language
    const originalLanguageDisplay = getLanguageDisplayName(rawOriginalLanguage)
    if (originalLanguageDisplay) {
      ratingGenreParts.push(
        `<i class="fas fa-language"></i> ${escapeHtml(
          String(originalLanguageDisplay)
        )}`
      )
    }

    // Combine with separator if both exist
    if (ratingGenreParts.length > 0) {
      lines.push(
        `<div class="crew-line" onclick="this.classList.toggle('expanded')">${ratingGenreParts.join(
          ' <span style="opacity: 0.5; margin: 0 0.25rem;">|</span> '
        )}</div>`
      )
    }

    const crewPeopleParts = []

    // Director + Writers on one line with separators and icons only
    if (director && director !== 'undefined') {
      crewPeopleParts.push(
        `<i class="fas fa-video"></i> ${escapeHtml(director)}`
      )
    }

    // Writers (show max 2 on mobile, 3 on desktop)
    if (writers && Array.isArray(writers) && writers.length > 0) {
      const maxWriters = window.innerWidth <= 600 ? 2 : 3
      const displayWriters = writers.slice(0, maxWriters)
      const hasMore = writers.length > maxWriters
      crewPeopleParts.push(
        `<i class="fas fa-pen"></i> ${displayWriters
          .map(escapeHtml)
          .join(', ')}${hasMore ? ' & more' : ''}`
      )
    }

    if (crewPeopleParts.length > 0) {
      lines.push(
        `<div class="crew-line" onclick="this.classList.toggle('expanded')">${crewPeopleParts.join(
          ' <span style="opacity: 0.5; margin: 0 0.25rem;">|</span> '
        )}</div>`
      )
    }

    if (summary) {
      lines.push(
        `<h4 class="storyline-header">Storyline</h4><p class="card-plot" onclick="this.closest('.card')._handlePlot(event)">${escapeHtml(
          summary
        )}</p>`
      )
    }

    const providerCandidates = Array.isArray(watchProviders)
      ? watchProviders
      : []
    const fallbackProviders = [
      ...(streamingServices && Array.isArray(streamingServices.subscription)
        ? streamingServices.subscription
        : []),
      ...(streamingServices && Array.isArray(streamingServices.free)
        ? streamingServices.free
        : []),
    ]
    const allProviders = providerCandidates.length
      ? providerCandidates
      : fallbackProviders

    if (allProviders.length > 0) {
      const uniqueProviders = []
      const seenProviders = new Set()
      allProviders.forEach(provider => {
        const fallbackName = String(provider?.name || '').trim()
        const isPersonalLibraryProvider =
          provider?.logo_path === '/assets/logos/allvids.svg' ||
          (provider?.id === 0 && provider?.type === 'subscription')

        const resolvedName = isPersonalLibraryProvider
          ? String(window.PLEX_LIBRARY_NAME || fallbackName).trim()
          : fallbackName

        if (!resolvedName) return
        const key = resolvedName.toLowerCase()
        if (seenProviders.has(key)) return
        seenProviders.add(key)
        uniqueProviders.push({
          ...provider,
          name: resolvedName,
        })
      })

      if (uniqueProviders.length > 0) {
        const providerPills = uniqueProviders
          .map(provider => {
            const logoPath = provider?.logo_path
            const logoUrl = logoPath
              ? logoPath.startsWith('/assets/')
                ? `${this.basePath || ''}${logoPath}`
                : `https://image.tmdb.org/t/p/w92${logoPath}`
              : ''

            return `<span class="where-to-watch-pill">${
              logoUrl
                ? `<img src="${logoUrl}" alt="${escapeHtml(
                    provider.name
                  )}" class="where-to-watch-pill-logo" loading="lazy" decoding="async" />`
                : ''
            }<span class="where-to-watch-pill-name">${escapeHtml(
              provider.name
            )}</span></span>`
          })
          .join('')

        lines.push(`<section class="where-to-watch-section">
          <h4 class="where-to-watch-heading">Where to Watch</h4>
          <div class="where-to-watch-pill-list" onclick="event.stopPropagation()">${providerPills}</div>
        </section>`)
      }
    }

    // Cast cards section (TMDb style horizontal scroll)
    if (castMembers && Array.isArray(castMembers) && castMembers.length > 0) {
      const castCards = castMembers
        .filter(member => member?.name)
        .map(member => {
          const profilePath = member.profilePath || ''
          const profileUrl = profilePath
            ? `${this.basePath || ''}/tmdb-poster${
                profilePath.startsWith('/') ? profilePath : `/${profilePath}`
              }`
            : ''
          return `<article class="cast-card" title="${escapeHtml(member.name)}">
            <div class="cast-card-photo-wrap">
              ${
                profileUrl
                  ? `<img class="cast-card-photo" src="${profileUrl}" alt="${escapeHtml(
                      member.name
                    )}" loading="lazy" decoding="async" draggable="false" />`
                  : `<div class="cast-card-photo cast-card-photo-fallback" aria-hidden="true"><i class="fas fa-user"></i></div>`
              }
            </div>
            <div class="cast-card-body">
              <div class="cast-card-name">${escapeHtml(member.name)}</div>
              <div class="cast-card-character">${escapeHtml(
                member.character || ''
              )}</div>
            </div>
          </article>`
        })
        .join('')

      if (castCards) {
        lines.push(`<section class="card-cast-section">
          <h4 class="cast-header">Cast</h4>
          <div class="cast-scroll" aria-label="Cast list" onclick="event.stopPropagation()">${castCards}</div>
        </section>`)
      }
    } else if (cast && Array.isArray(cast) && cast.length > 0) {
      const maxCast = window.innerWidth <= 600 ? 3 : 4
      const displayCast = cast.slice(0, maxCast)
      const hasMore = cast.length > maxCast
      lines.push(
        `<div class="crew-line" onclick="this.classList.toggle('expanded')"><i class="fas fa-users"></i> ${displayCast
          .map(escapeHtml)
          .join(', ')}${hasMore ? ' & more' : ''}</div>`
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
