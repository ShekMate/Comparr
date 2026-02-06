// deno-lint-ignore-file

export class MatchesView {
  constructor(matches = []) {
    this.matches = matches
    this.node = document.querySelector('.js-matches-section')
    
    if (!this.node) {
      console.warn('Matches section not found in DOM')
      return
    }
    
    this.matchesCountEl = this.node.querySelector('.js-matches-count')
    this.matchesListEl = this.node.querySelector('.js-matches-list')
    this.render()
  }

  add(match) {
    const existingIndex = this.matches.findIndex(
      _ => _.movie.guid === match.movie.guid
    )

    if (existingIndex !== -1) {
      this.matches.splice(existingIndex, 1)
    }

    this.matchesCountEl.animate(
      {
        transform: ['scale(1)', 'scale(1.5)', 'scale(1)'],
      },
      {
        duration: 300,
        easing: 'ease-in-out',
        fill: 'both',
      }
    )

    this.matches.push(match)
    this.render()
  }

  formatList = users => {
    if (users.length < 3) return users.join(' and ')

    const items = [...users]
    const last = items.splice(-1)
    return `${items.join(', ')}, ${
      document.body.dataset.i18nListConjunction
    } ${last}`
  }

  render() {
    if (!this.matchesCountEl || !this.matchesListEl) {
      console.warn('Matches DOM elements not available')
      return
    }
    
    this.matchesCountEl.dataset.count = this.matches.length
    this.matches.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    
    this.matchesListEl.innerHTML = this.matches
      .map(({ users, movie }) => {
        const basePath = document.body.dataset.basePath
        const posterUrl = movie.art || movie.thumb || ''
        
        return `
      <div class="watch-card" data-guid="${movie.guid}">
        <!-- Header with title and matched users -->
        <div class="watch-card-collapsed" style="cursor: default;">
          <div class="watch-card-header-compact">
            <div class="watch-card-title-compact">
              ${movie.title}
              ${movie.year ? `<span class="watch-card-year">(${movie.year})</span>` : ''}
            </div>
          </div>
          <div class="watch-card-metadata">
            <i class="fas fa-users"></i>
            Matched with ${this.formatList(users)}
          </div>
        </div>
        
        <!-- Details (always visible, not collapsible) -->
        <div class="watch-card-details" style="display: block;">
          ${posterUrl ? `
          <div class="watch-card-poster">
            <img src="${posterUrl.startsWith('http') ? posterUrl : basePath + posterUrl}" alt="${movie.title} poster" />
          </div>
          ` : ''}
          
          <div class="watch-card-content">
            ${movie.summary ? `
            <p class="watch-card-summary">${movie.summary}</p>
            ` : ''}

            ${this.renderWatchCardMetadata(movie)}

            <div class="watch-card-actions">
              ${this.renderWatchCardStreamingButton(movie)}
              ${this.renderWatchCardPlexButton(movie)}
              <div class="list-actions inline-actions">
                <button class="list-action-btn move-to-seen" title="Mark as Watched" data-guid="${movie.guid}">
                  <i class="fas fa-eye"></i>
                </button>
                <button class="list-action-btn move-to-pass" title="Pass" data-guid="${movie.guid}">
                  <i class="fas fa-times"></i>
                </button>
                <button class="list-action-btn refresh-movie-btn" title="Refresh" data-guid="${movie.guid}">
                  <i class="fas fa-sync-alt"></i>
                </button>
              </div>
              ${movie.rating ? `
              <div class="watch-card-ratings">${movie.rating}</div>
              ` : ''}
            </div>
          </div>
        </div>
      </div>
    `
      })
      .join('\n')
    
    // Attach event listeners after rendering
    this.attachEventListeners()
  }

  renderWatchCardMetadata(movie) {
    const badges = []
    
    if (movie.contentRating) {
      badges.push(`<span class="metadata-badge badge-rating"><i class="fas fa-certificate"></i>${movie.contentRating}</span>`)
    }
    
    if (movie.genres && Array.isArray(movie.genres) && movie.genres.length > 0) {
      const genres = movie.genres.slice(0, 3).join(', ')
      badges.push(`<span class="metadata-badge badge-genre"><i class="fas fa-film"></i>${genres}</span>`)
    }
    
    const durationMinutes = movie.duration || movie.runtime
    if (durationMinutes) {
      const hours = Math.floor(durationMinutes / 60)
      const mins = durationMinutes % 60
      const runtime = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`
      badges.push(`<span class="metadata-badge badge-runtime"><i class="fas fa-clock"></i>${runtime}</span>`)
    }
    
    return badges.length > 0 ? `<div class="watch-card-metadata">${badges.join('')}</div>` : ''
  }

  renderWatchCardStreamingButton(movie) {
    // Get streaming services in the format: { subscription: [], free: [] }
    let streamingServices = { subscription: [], free: [] }
    
    if (movie.streamingServices) {
      if (movie.streamingServices.subscription || movie.streamingServices.free) {
        // Already in correct format
        streamingServices = {
          subscription: movie.streamingServices.subscription || [],
          free: movie.streamingServices.free || []
        }
      } else if (Array.isArray(movie.streamingServices)) {
        // Old array format - treat as subscription
        streamingServices.subscription = movie.streamingServices
      }
    }
    
    // Filter out Plex from subscription services
    const plexLibraryName = window.PLEX_LIBRARY_NAME || 'Plex'
    streamingServices.subscription = streamingServices.subscription.filter(
      s => s.name !== plexLibraryName
    )
    
    const hasSubscription = streamingServices.subscription.length > 0
    const hasFree = streamingServices.free.length > 0
    
    return `
      <div class="service-dropdown">
        <button class="service-dropdown-btn ${!hasSubscription ? 'disabled' : ''}" type="button" ${!hasSubscription ? 'disabled' : ''} data-guid="${movie.guid}" data-type="subscription">
          SUBSCRIPTION
        </button>
        ${hasSubscription ? `
          <div class="service-dropdown-menu" data-guid="${movie.guid}" data-type="subscription">
            ${this.renderServiceItems(streamingServices.subscription, movie.streamingLink)}
          </div>
        ` : ''}
      </div>
      
      <div class="service-dropdown">
        <button class="service-dropdown-btn ${!hasFree ? 'disabled' : ''}" type="button" ${!hasFree ? 'disabled' : ''} data-guid="${movie.guid}" data-type="free">
          FREE
        </button>
        ${hasFree ? `
          <div class="service-dropdown-menu" data-guid="${movie.guid}" data-type="free">
            ${this.renderServiceItems(streamingServices.free, movie.streamingLink)}
          </div>
        ` : ''}
      </div>
    `
  }
  
  renderServiceItems(services, streamingLink) {
    if (!services || services.length === 0) {
      return '<div class="service-item">None available</div>'
    }
    
    const basePath = document.body.dataset.basePath || ''
    
    if (streamingLink) {
      return `
        <a href="${streamingLink}" target="_blank" rel="noopener noreferrer" class="service-link-wrapper">
          ${services.map(s => {
            const logoUrl = s.logo_path 
              ? (s.logo_path.startsWith('/assets/') 
                  ? `${basePath}${s.logo_path}` 
                  : `https://image.tmdb.org/t/p/original${s.logo_path}`)
              : null
            
            return `<div class="service-item">
              ${logoUrl ? `<img src="${logoUrl}" alt="${s.name}" class="service-logo">` : ''}
              <span>${s.name}</span>
            </div>`
          }).join('')}
        </a>
      `
    }
    
    return services.map(s => {
      const logoUrl = s.logo || s.logo_path
      const serviceName = s.name || s.provider_name || 'Unknown'
      
      return `
        <div class="service-item">
          ${logoUrl ? `<img src="${logoUrl}" alt="${serviceName}" class="service-logo">` : ''}
          <span>${serviceName}</span>
        </div>
      `
    }).join('')
  }

  renderWatchCardPlexButton(movie) {
    const basePath = document.body.dataset.basePath
    const plexLibraryName = window.PLEX_LIBRARY_NAME || 'Plex'
    
    // Check if movie is in Plex
    const plexAvailable = movie.plexAvailable || movie.inPlex || movie.type === 'movie'
    const jellyseerrRequested = movie.jellyseerrRequested || movie.requested || false
    
    // Extract TMDb ID from guid
    const tmdbId = movie.guid ? movie.guid.match(/tmdb:\/\/(\d+)/)?.[1] : null
    
    if (plexAvailable && movie.key) {
      return `
        <div class="plex-status">
          <i class="fas fa-check-circle"></i> ${plexLibraryName}
        </div>
      `
    }
    
    if (jellyseerrRequested) {
      return `
        <button class="add-to-plex-btn requested" disabled>
          <i class="fas fa-clock"></i> Requested
        </button>
      `
    }
    
    if (tmdbId) {
      return `
        <button class="add-to-plex-btn" data-movie-id="${tmdbId}">
          <i class="fas fa-plus"></i> ADD TO PLEX
        </button>
      `
    }
    
    return ''
  }

  attachEventListeners() {
    // Streaming dropdown toggles - handles both subscription and free buttons
    document.querySelectorAll('.matches-list .service-dropdown-btn:not(.disabled)').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const dropdown = btn.nextElementSibling
        if (!dropdown) return
        
        const isOpen = dropdown.classList.contains('show')
        
        // Close all dropdowns
        document.querySelectorAll('.matches-list .service-dropdown-menu').forEach(m => {
          m.classList.remove('show')
        })
        document.querySelectorAll('.matches-list .service-dropdown-btn').forEach(b => {
          b.classList.remove('open')
        })
        
        // Toggle this dropdown
        if (!isOpen) {
          dropdown.classList.add('show')
          btn.classList.add('open')
        }
      })
    })
    
    // Close dropdowns when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.service-dropdown')) {
        document.querySelectorAll('.matches-list .service-dropdown-menu').forEach(m => m.classList.remove('show'))
        document.querySelectorAll('.matches-list .service-dropdown-btn').forEach(b => b.classList.remove('open'))
      }
    })
    
    // Mark as seen button
    document.querySelectorAll('.matches-list .move-to-seen').forEach(btn => {
      btn.addEventListener('click', () => {
        const guid = btn.dataset.guid
        this.handleMatchAction(guid, 'seen')
      })
    })
    
    // Pass button
    document.querySelectorAll('.matches-list .move-to-pass').forEach(btn => {
      btn.addEventListener('click', () => {
        const guid = btn.dataset.guid
        this.handleMatchAction(guid, 'pass')
      })
    })
    
    // Refresh button
    document.querySelectorAll('.matches-list .refresh-movie-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const card = btn.closest('.watch-card')
        const guid = card.dataset.guid
        const tmdbId = guid ? guid.match(/tmdb:\/\/(\d+)/)?.[1] : null
        
        if (!tmdbId) {
          console.error('No TMDb ID found for refresh')
          return
        }
        
        const icon = btn.querySelector('i')
        icon.classList.add('fa-spin')
        btn.disabled = true
        
        await this.refreshMovie(tmdbId, card)
        
        icon.classList.remove('fa-spin')
        btn.disabled = false
      })
    })
    
    // Add to Plex/Jellyseerr button
    document.querySelectorAll('.matches-list .add-to-plex-btn:not(.requested)').forEach(btn => {
      btn.addEventListener('click', async () => {
        const tmdbId = btn.dataset.movieId
        if (!tmdbId) {
          console.error('No TMDb ID found for movie')
          return
        }
        
        const movieTitle = btn.closest('.watch-card').querySelector('.watch-card-title-compact').textContent.trim()
        await this.requestMovie(tmdbId, movieTitle, btn)
      })
    })
  }

  async handleMatchAction(guid, action) {
    // Remove match from local view
    const matchIndex = this.matches.findIndex(m => m.movie.guid === guid)
    if (matchIndex !== -1) {
      this.matches.splice(matchIndex, 1)
      this.render()
    }
    
    // Send action to server
    try {
      const response = await fetch('/api/match-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guid,
          action,
          roomCode: sessionStorage.getItem('roomCode'),
          userName: sessionStorage.getItem('userName')
        })
      })
      
      if (!response.ok) {
        console.error('Failed to process match action')
      }
    } catch (error) {
      console.error('Error processing match action:', error)
    }
  }

  async refreshMovie(tmdbId, card) {
    try {
      // Check Plex status
      const plexResponse = await fetch(`/api/check-movie-status?tmdbId=${tmdbId}`)
      if (plexResponse.ok) {
        const plexData = await plexResponse.json()
        
        if (plexData.inPlex) {
          const actionsContainer = card.querySelector('.watch-card-actions')
          const btnToReplace = actionsContainer.querySelector('.add-to-plex-btn')
          
          if (btnToReplace) {
            const plexLibraryName = window.PLEX_LIBRARY_NAME || 'Plex'
            btnToReplace.outerHTML = `
              <div class="plex-status">
                <i class="fas fa-check-circle"></i> ${plexLibraryName}
              </div>
            `
          }
        }
      }
      
      // Refresh streaming data
      const streamingResponse = await fetch(`/api/refresh-streaming/${tmdbId}`)
      if (streamingResponse.ok) {
        const streamingData = await streamingResponse.json()
        
        // Update subscription services
        const dropdowns = card.querySelectorAll('.service-dropdown')
        const subMenu = dropdowns[0]?.querySelector('.service-dropdown-menu')
        const freeMenu = dropdowns[1]?.querySelector('.service-dropdown-menu')
        
        if (subMenu) {
          const services = (streamingData.streamingServices?.subscription || [])
            .filter(s => s.name !== (window.PLEX_LIBRARY_NAME || 'Plex'))
          subMenu.innerHTML = this.renderServiceItems(services, streamingData.streamingLink)
        }
        
        if (freeMenu) {
          const services = streamingData.streamingServices?.free || []
          freeMenu.innerHTML = this.renderServiceItems(services, streamingData.streamingLink)
        }
      }
    } catch (error) {
      console.error('Error refreshing movie:', error)
    }
  }

  async requestMovie(tmdbId, movieTitle, button) {
    if (!tmdbId) {
      alert('Cannot request this movie: No TMDb ID available')
      return
    }
    
    const icon = button.querySelector('i')
    button.disabled = true
    icon.className = 'fas fa-spinner fa-spin'
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Requesting...'
    
    try {
      const response = await fetch('/api/request-movie', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tmdbId })
      })
      
      const result = await response.json()
      
      if (result.success) {
        button.classList.add('requested')
        button.innerHTML = '<i class="fas fa-check"></i> Requested'
        
        // Show notification
        if (typeof showNotification === 'function') {
          showNotification(`"${movieTitle}" has been requested!`)
        }
        
        // Trigger Radarr cache refresh
        fetch('/api/refresh-radarr-cache', { method: 'POST' }).catch(err => 
          console.error('Failed to trigger cache refresh:', err)
        )
      } else {
        throw new Error(result.error || 'Request failed')
      }
    } catch (error) {
      console.error('Error requesting movie:', error)
      button.innerHTML = '<i class="fas fa-plus"></i> ADD TO PLEX'
      button.disabled = false
      alert(`Failed to request movie: ${error.message}`)
    }
  }
}
