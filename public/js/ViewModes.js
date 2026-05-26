// deno-lint-ignore-file
import {
  getViewMode, setViewMode,
  getPosterSize, setPosterSize,
  getTableOptions, setTableOption,
  getPosterOptions, setPosterOption,
} from './ViewPreferences.js'
import { buildRatingHtml, formatRuntime } from './features/movie-metadata.js'

// ─── Section configs ─────────────────────────────────────────────────────────

const SECTION_CONFIGS = {
  'tab-likes':           { listClass: 'likes-list',           hasRequest: true,  expandBtnId: 'toggle-expand-all-btn',                 sortWrapperId: 'watch-sort-controls-wrapper' },
  'tab-seen':            { listClass: 'seen-list',             hasRequest: true,  expandBtnId: 'toggle-expand-all-seen-btn',            sortWrapperId: 'seen-sort-controls-wrapper' },
  'tab-dislikes':        { listClass: 'dislikes-list',         hasRequest: false, expandBtnId: 'toggle-expand-all-pass-btn',            sortWrapperId: 'pass-sort-controls-wrapper' },
  'tab-recommendations': { listClass: 'recommendations-list',  hasRequest: false, expandBtnId: 'toggle-expand-all-recommendations-btn', sortWrapperId: null },
  'tab-matches':         { listClass: null,                    hasRequest: true,  expandBtnId: null,                                    sortWrapperId: null },
}

// Table column definitions in display order
const TABLE_COLUMNS = [
  { key: 'year',          label: 'Year',           sortable: true  },
  { key: 'genres',        label: 'Genres',         sortable: false },
  { key: 'contentRating', label: 'Rating',         sortable: false },
  { key: 'runtime',       label: 'Runtime',        sortable: true  },
  { key: 'imdb',          label: 'IMDb',           sortable: true  },
  { key: 'tmdb',          label: 'TMDb',           sortable: true  },
  { key: 'director',      label: 'Director',       sortable: false },
  { key: 'writers',       label: 'Writers',        sortable: false },
  { key: 'language',      label: 'Language',       sortable: false },
  { key: 'releaseDate',   label: 'Release Date',   sortable: true  },
]

// Poster option definitions
const POSTER_OPTIONS_DEF = [
  { key: 'showTitle',         label: 'Title' },
  { key: 'showYear',          label: 'Year' },
  { key: 'showContentRating', label: 'Content Rating' },
  { key: 'showGenres',        label: 'Genres' },
  { key: 'showTmdb',          label: 'TMDb Rating' },
  { key: 'showImdb',          label: 'IMDb Rating' },
  { key: 'showRuntime',       label: 'Runtime' },
  { key: 'showAvailability',  label: 'Availability' },
  { key: 'showRequest',       label: 'Request' },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getPosterUrl(movie) {
  const basePath = document.body.dataset.basePath || ''
  const raw = movie.art || movie.thumb || movie.poster || ''
  if (!raw) return ''
  if (raw.startsWith('http')) return raw
  if (raw.startsWith('/tmdb-poster/')) return basePath + raw
  return basePath + raw
}

function getMovieYear(movie) {
  return movie.year || (movie.release_date ? movie.release_date.slice(0, 4) : '')
}

function getRatingValue(movie, type) {
  if (type === 'imdb') return parseFloat(movie.rating_imdb || movie.imdbRating || 0) || null
  if (type === 'tmdb') return parseFloat(movie.rating_tmdb || movie.tmdbRating || movie.vote_average || 0) || null
  return null
}

function getGenreList(movie) {
  if (Array.isArray(movie.genres) && movie.genres.length) return movie.genres
  return []
}

function getRuntimeDisplay(movie) {
  const min = Number(movie.runtime) || Number(movie.runtimeMinutes) || null
  if (min && min > 0 && min < 1000) return formatRuntime(min)
  if (movie.duration && movie.duration > 0) return formatRuntime(Math.round(movie.duration / 60000))
  return ''
}

function isMovieAvailable(movie) {
  const services = [
    ...((movie.streamingServices?.subscription) || []),
    ...((movie.streamingServices?.free) || []),
  ]
  return services.length > 0
}

function escapeAttr(str) {
  return String(str || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ─── Detail Modal ─────────────────────────────────────────────────────────────

function showDetailModal(movie, sectionId) {
  const existing = document.getElementById('view-detail-modal-overlay')
  if (existing) existing.remove()

  const basePath = document.body.dataset.basePath || ''
  const posterUrl = getPosterUrl(movie)
  const year = getMovieYear(movie)
  const genres = getGenreList(movie)
  const runtime = getRuntimeDisplay(movie)
  const ratingHtml = buildRatingHtml(movie, basePath) || ''
  const config = SECTION_CONFIGS[sectionId] || {}
  const hasRequest = config.hasRequest

  const imdb = getRatingValue(movie, 'imdb')
  const tmdb = getRatingValue(movie, 'tmdb')

  const isInLib = movie._isInLibrary || false
  const tmdbId = movie.tmdbId || movie.tmdb_id || null
  const requestConfigured = window._requestServiceConfigured || false
  const showRequestBtn = hasRequest && !isInLib && tmdbId && requestConfigured

  const availText = isMovieAvailable(movie) ? 'Available' : 'Not Available'
  const availClass = isMovieAvailable(movie) ? 'avail-yes' : 'avail-no'

  const overlay = document.createElement('div')
  overlay.id = 'view-detail-modal-overlay'
  overlay.className = 'view-detail-modal-overlay'
  overlay.innerHTML = `
    <div class="view-detail-modal" role="dialog" aria-modal="true">
      <button class="view-detail-close" aria-label="Close" title="Close">
        <i class="fas fa-times"></i>
      </button>
      <div class="view-detail-body">
        ${posterUrl ? `<div class="view-detail-poster"><img src="${escapeAttr(posterUrl)}" alt="${escapeAttr(movie.title)}"></div>` : ''}
        <div class="view-detail-info">
          <h2 class="view-detail-title">${movie.title || ''}${year ? ` <span class="view-detail-year">(${year})</span>` : ''}</h2>
          <div class="view-detail-meta">
            ${movie.contentRating ? `<span class="metadata-badge badge-rating"><i class="fas fa-tag"></i> ${movie.contentRating}</span>` : ''}
            ${runtime ? `<span class="metadata-badge badge-runtime"><i class="fas fa-clock"></i> ${runtime}</span>` : ''}
            ${genres.length ? `<span class="metadata-badge badge-genre"><i class="fas fa-film"></i> ${genres.slice(0, 3).join(', ')}</span>` : ''}
          </div>
          ${movie.summary ? `<p class="view-detail-summary">${movie.summary}</p>` : ''}
          ${ratingHtml ? `<div class="watch-card-ratings view-detail-ratings">${ratingHtml}</div>` : ''}
          <div class="view-detail-actions">
            <button class="list-action-btn view-detail-seen" data-guid="${escapeAttr(movie.guid)}" title="Mark as Seen">
              <i class="fas fa-eye"></i><span class="list-action-label"> Seen</span>
            </button>
            <button class="list-action-btn view-detail-pass" data-guid="${escapeAttr(movie.guid)}" title="Pass">
              <i class="fas fa-thumbs-down"></i><span class="list-action-label"> Pass</span>
            </button>
            ${showRequestBtn ? `<button class="list-action-btn view-detail-request provider-pill-add" data-tmdb-id="${tmdbId}" data-title="${escapeAttr(movie.title)}" title="Request"><i class="fas fa-plus"></i><span class="list-action-label"> Request</span></button>` : ''}
            <button class="list-action-btn view-detail-refresh" data-guid="${escapeAttr(movie.guid)}" data-tmdb-id="${tmdbId || ''}" title="Refresh">
              <i class="fas fa-sync-alt"></i>
            </button>
          </div>
        </div>
      </div>
    </div>
  `

  document.body.appendChild(overlay)
  requestAnimationFrame(() => overlay.classList.add('is-open'))

  const closeModal = () => {
    overlay.classList.remove('is-open')
    overlay.addEventListener('transitionend', () => overlay.remove(), { once: true })
  }

  overlay.querySelector('.view-detail-close').addEventListener('click', closeModal)
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal() })
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', onKey) }
  }, { once: true })

  // Action buttons
  const seenBtn = overlay.querySelector('.view-detail-seen')
  const passBtn = overlay.querySelector('.view-detail-pass')
  const reqBtn  = overlay.querySelector('.view-detail-request')
  const refBtn  = overlay.querySelector('.view-detail-refresh')

  const listMap = { 'tab-likes': 'watch', 'tab-seen': 'seen', 'tab-dislikes': 'pass', 'tab-recommendations': null, 'tab-matches': null }
  const fromList = listMap[sectionId]

  seenBtn?.addEventListener('click', async () => {
    if (fromList && window.moveMovieBetweenLists) {
      await window.moveMovieBetweenLists(movie.guid, fromList, 'seen')
    }
    closeModal()
  })
  passBtn?.addEventListener('click', async () => {
    if (fromList && window.moveMovieBetweenLists) {
      await window.moveMovieBetweenLists(movie.guid, fromList, 'pass')
    }
    closeModal()
  })
  reqBtn?.addEventListener('click', () => {
    if (window.handleMovieRequest) {
      window.handleMovieRequest(parseInt(tmdbId), movie.title, reqBtn)
    }
  })
  refBtn?.addEventListener('click', async () => {
    const icon = refBtn.querySelector('i')
    refBtn.disabled = true
    icon.classList.add('fa-spin')
    try {
      const id = tmdbId || movie.guid
      const res = await fetch(`/api/refresh-movie/${encodeURIComponent(id)}`)
      if (res.ok) {
        const data = await res.json()
        if (data && movie) Object.assign(movie, data)
      }
    } catch {}
    icon.classList.remove('fa-spin')
    refBtn.disabled = false
  })
}

// ─── Table renderer ────────────────────────────────────────────────────────────

function buildTableRow(movie, sectionId, opts) {
  const year = getMovieYear(movie)
  const genres = getGenreList(movie)
  const runtime = getRuntimeDisplay(movie)
  const imdb = getRatingValue(movie, 'imdb')
  const tmdb = getRatingValue(movie, 'tmdb')
  const config = SECTION_CONFIGS[sectionId] || {}
  const hasRequest = config.hasRequest
  const isInLib = movie._isInLibrary || false
  const tmdbId = movie.tmdbId || movie.tmdb_id || null
  const requestConfigured = window._requestServiceConfigured || false
  const showRequestBtn = hasRequest && !isInLib && tmdbId && requestConfigured

  const listMap = { 'tab-likes': 'watch', 'tab-seen': 'seen', 'tab-dislikes': 'pass', 'tab-recommendations': null, 'tab-matches': null }
  const fromList = listMap[sectionId]

  const releaseDate = movie.release_date ? movie.release_date.slice(0, 10) : (year || '')
  const writers = Array.isArray(movie.writers) ? movie.writers.slice(0, 2).join(', ') : (movie.writers || '')
  const language = movie.original_language || movie.language || ''

  const tr = document.createElement('tr')
  tr.dataset.guid = movie.guid || ''
  tr._movieData = movie

  tr.innerHTML = `
    <td class="col-title vt-title">
      <span class="vt-title-text">${movie.title || ''}</span>
    </td>
    <td class="col-year vt-year">${year}</td>
    <td class="col-genres vt-genres">${genres.slice(0, 2).join(', ')}</td>
    <td class="col-contentRating vt-rating">${movie.contentRating || ''}</td>
    <td class="col-runtime vt-runtime">${runtime}</td>
    <td class="col-imdb vt-imdb">${imdb ? imdb.toFixed(1) : ''}</td>
    <td class="col-tmdb vt-tmdb">${tmdb ? tmdb.toFixed(1) : ''}</td>
    <td class="col-director vt-director">${movie.director || ''}</td>
    <td class="col-writers vt-writers">${writers}</td>
    <td class="col-language vt-language">${language}</td>
    <td class="col-releaseDate vt-releaseDate">${releaseDate}</td>
    <td class="col-actions vt-actions">
      ${fromList === 'pass' ? '' : `<button class="vt-action-btn vt-seen" data-guid="${escapeAttr(movie.guid)}" title="Mark as Seen"><i class="fas fa-eye"></i></button>`}
      ${fromList === 'seen' ? '' : `<button class="vt-action-btn vt-pass" data-guid="${escapeAttr(movie.guid)}" title="Pass"><i class="fas fa-thumbs-down"></i></button>`}
      ${showRequestBtn ? `<button class="vt-action-btn vt-request provider-pill-add" data-tmdb-id="${tmdbId}" data-title="${escapeAttr(movie.title)}" title="Request"><i class="fas fa-plus"></i></button>` : ''}
      <button class="vt-action-btn vt-refresh" data-guid="${escapeAttr(movie.guid)}" data-tmdb-id="${tmdbId || ''}" title="Refresh"><i class="fas fa-sync-alt"></i></button>
    </td>
  `

  // Wire actions
  tr.querySelector('.vt-seen')?.addEventListener('click', e => {
    e.stopPropagation()
    if (fromList && window.moveMovieBetweenLists) window.moveMovieBetweenLists(movie.guid, fromList, 'seen')
  })
  tr.querySelector('.vt-pass')?.addEventListener('click', e => {
    e.stopPropagation()
    if (fromList && window.moveMovieBetweenLists) window.moveMovieBetweenLists(movie.guid, fromList, 'pass')
  })
  tr.querySelector('.vt-request')?.addEventListener('click', e => {
    e.stopPropagation()
    if (window.handleMovieRequest) window.handleMovieRequest(parseInt(tmdbId), movie.title, e.currentTarget)
  })
  tr.querySelector('.vt-refresh')?.addEventListener('click', async e => {
    e.stopPropagation()
    const btn = e.currentTarget
    const icon = btn.querySelector('i')
    btn.disabled = true; icon.classList.add('fa-spin')
    try {
      const id = tmdbId || movie.guid
      await fetch(`/api/refresh-movie/${encodeURIComponent(id)}`)
    } catch {}
    icon.classList.remove('fa-spin'); btn.disabled = false
  })

  return tr
}

function applyTableColumnClasses(table, opts) {
  TABLE_COLUMNS.forEach(col => {
    table.classList.toggle(`col-${col.key}-on`, opts[col.key] === true)
  })
}

function buildTableView(sectionId, movies) {
  const opts = getTableOptions(sectionId)
  const wrapper = document.createElement('div')
  wrapper.className = 'view-table-wrapper'

  const table = document.createElement('table')
  table.className = 'view-table'
  applyTableColumnClasses(table, opts)

  // thead
  const thead = document.createElement('thead')
  let thHtml = '<tr><th class="col-title">Title</th>'
  TABLE_COLUMNS.forEach(col => {
    const sortIcon = col.sortable ? `<i class="fas fa-sort vt-sort-icon"></i>` : ''
    thHtml += `<th class="col-${col.key}" ${col.sortable ? `data-sort="${col.key}"` : ''}>${col.label}${sortIcon}</th>`
  })
  thHtml += '<th class="col-actions">Actions</th></tr>'
  thead.innerHTML = thHtml
  table.appendChild(thead)

  // tbody
  const tbody = document.createElement('tbody')
  movies.forEach(movie => tbody.appendChild(buildTableRow(movie, sectionId, opts)))
  table.appendChild(tbody)
  wrapper.appendChild(table)

  // Column-header sort
  let currentSortKey = null
  let sortAsc = false
  thead.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort
      if (currentSortKey === key) sortAsc = !sortAsc
      else { currentSortKey = key; sortAsc = false }

      thead.querySelectorAll('.vt-sort-icon').forEach(i => i.className = 'fas fa-sort vt-sort-icon')
      th.querySelector('.vt-sort-icon').className = `fas fa-sort-${sortAsc ? 'up' : 'down'} vt-sort-icon`

      const rows = Array.from(tbody.querySelectorAll('tr'))
      rows.sort((a, b) => {
        const ma = a._movieData, mb = b._movieData
        let va = '', vb = ''
        if (key === 'year' || key === 'releaseDate') { va = getMovieYear(ma) || '0'; vb = getMovieYear(mb) || '0'; return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va) }
        if (key === 'runtime') { va = Number(ma.runtime || ma.duration / 60000 || 0); vb = Number(mb.runtime || mb.duration / 60000 || 0) }
        else if (key === 'imdb') { va = getRatingValue(ma, 'imdb') || 0; vb = getRatingValue(mb, 'imdb') || 0 }
        else if (key === 'tmdb') { va = getRatingValue(ma, 'tmdb') || 0; vb = getRatingValue(mb, 'tmdb') || 0 }
        else { va = String(ma[key] || ''); vb = String(mb[key] || ''); return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va) }
        return sortAsc ? va - vb : vb - va
      })
      rows.forEach(r => tbody.appendChild(r))
    })
  })

  return wrapper
}

// ─── Poster renderer ────────────────────────────────────────────────────────────

function buildPosterCard(movie, sectionId) {
  const opts = getPosterOptions(sectionId)
  const size = getPosterSize(sectionId)
  const posterUrl = getPosterUrl(movie)
  const year = getMovieYear(movie)
  const genres = getGenreList(movie)
  const runtime = getRuntimeDisplay(movie)
  const imdb = getRatingValue(movie, 'imdb')
  const tmdb = getRatingValue(movie, 'tmdb')
  const available = isMovieAvailable(movie)

  const config = SECTION_CONFIGS[sectionId] || {}
  const hasRequest = config.hasRequest
  const isInLib = movie._isInLibrary || false
  const tmdbId = movie.tmdbId || movie.tmdb_id || null
  const requestConfigured = window._requestServiceConfigured || false
  const showRequestBtn = hasRequest && !isInLib && tmdbId && requestConfigured

  const card = document.createElement('div')
  card.className = 'poster-card'
  card.dataset.guid = movie.guid || ''

  const infoRows = []
  if (opts.showTitle) {
    infoRows.push(`<div class="poster-card-title">${movie.title || ''}${opts.showYear && year ? ` <span class="poster-card-year">(${year})</span>` : ''}</div>`)
  }
  if (opts.showContentRating && movie.contentRating) {
    infoRows.push(`<div class="poster-card-field poster-field-cr">${movie.contentRating}</div>`)
  }
  if (opts.showGenres && genres.length) {
    infoRows.push(`<div class="poster-card-field poster-field-genres">${genres.slice(0, 2).join(', ')}</div>`)
  }
  if (opts.showRuntime && runtime) {
    infoRows.push(`<div class="poster-card-field poster-field-runtime">${runtime}</div>`)
  }
  if (opts.showImdb && imdb) {
    infoRows.push(`<div class="poster-card-field poster-field-rating"><span class="pc-rating-label">IMDb</span> ${imdb.toFixed(1)}</div>`)
  }
  if (opts.showTmdb && tmdb) {
    infoRows.push(`<div class="poster-card-field poster-field-rating"><span class="pc-rating-label">TMDb</span> ${tmdb.toFixed(1)}</div>`)
  }
  if (opts.showAvailability) {
    infoRows.push(`<div class="poster-card-field poster-field-avail ${available ? 'avail-yes' : 'avail-no'}">${available ? 'Available' : 'Not Available'}</div>`)
  }
  if (opts.showRequest && showRequestBtn) {
    infoRows.push(`<button class="poster-card-request-btn provider-pill-add" data-tmdb-id="${tmdbId}" data-title="${escapeAttr(movie.title)}"><i class="fas fa-plus"></i> Request</button>`)
  }

  card.innerHTML = `
    <div class="poster-card-img-wrap">
      ${posterUrl ? `<img src="${escapeAttr(posterUrl)}" alt="${escapeAttr(movie.title)}" loading="lazy">` : '<div class="poster-card-no-img"><i class="fas fa-film"></i></div>'}
    </div>
    ${infoRows.length ? `<div class="poster-card-info">${infoRows.join('')}</div>` : ''}
  `

  card.querySelector('.poster-card-img-wrap')?.addEventListener('click', () => showDetailModal(movie, sectionId))
  card.querySelector('.poster-card-info')?.addEventListener('click', e => {
    if (!e.target.closest('.poster-card-request-btn')) showDetailModal(movie, sectionId)
  })
  card.querySelector('.poster-card-request-btn')?.addEventListener('click', e => {
    e.stopPropagation()
    if (window.handleMovieRequest) window.handleMovieRequest(parseInt(tmdbId), movie.title, e.currentTarget)
  })

  return card
}

function buildPosterGrid(sectionId, movies) {
  const size = getPosterSize(sectionId)
  const grid = document.createElement('div')
  grid.className = `view-poster-grid poster-size-${size}`
  movies.forEach(movie => grid.appendChild(buildPosterCard(movie, sectionId)))
  return grid
}

// ─── Options panel ────────────────────────────────────────────────────────────

function buildOptionsPanel(sectionId, onChanged) {
  const panel = document.createElement('div')
  panel.className = 'view-options-popover'
  panel.setAttribute('hidden', '')

  const renderPanel = () => {
    const mode = getViewMode(sectionId)
    const tableOpts = getTableOptions(sectionId)
    const posterOpts = getPosterOptions(sectionId)
    const size = getPosterSize(sectionId)

    let html = ''

    if (mode === 'poster') {
      html += `
        <div class="vop-section">
          <div class="vop-label">Poster Size</div>
          <div class="vop-size-btns">
            <button class="vop-size-btn${size === 'small' ? ' active' : ''}" data-size="small">S</button>
            <button class="vop-size-btn${size === 'medium' ? ' active' : ''}" data-size="medium">M</button>
            <button class="vop-size-btn${size === 'large' ? ' active' : ''}" data-size="large">L</button>
          </div>
        </div>
        <div class="vop-section vop-toggles">
          <div class="vop-label">Show Below Poster</div>
          ${POSTER_OPTIONS_DEF.map(opt => `
            <label class="vop-toggle-row">
              <span>${opt.label}</span>
              <div class="vop-toggle${posterOpts[opt.key] ? ' on' : ''}" data-pkey="${opt.key}">
                <div class="vop-toggle-thumb"></div>
              </div>
            </label>
          `).join('')}
        </div>
      `
    } else if (mode === 'table') {
      html += `
        <div class="vop-section vop-toggles">
          <div class="vop-label">Columns</div>
          ${TABLE_COLUMNS.map(col => `
            <label class="vop-toggle-row">
              <span>${col.label}</span>
              <div class="vop-toggle${tableOpts[col.key] ? ' on' : ''}" data-tkey="${col.key}">
                <div class="vop-toggle-thumb"></div>
              </div>
            </label>
          `).join('')}
        </div>
      `
    } else {
      html += `<div class="vop-section"><p class="vop-hint">No options for Overview mode.</p></div>`
    }

    panel.innerHTML = html

    // Size buttons
    panel.querySelectorAll('.vop-size-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        setPosterSize(sectionId, btn.dataset.size)
        onChanged()
        renderPanel()
      })
    })

    // Poster toggles
    panel.querySelectorAll('[data-pkey]').forEach(tog => {
      tog.addEventListener('click', () => {
        const key = tog.dataset.pkey
        const val = !getPosterOptions(sectionId)[key]
        setPosterOption(sectionId, key, val)
        tog.classList.toggle('on', val)
        onChanged()
      })
    })

    // Table toggles
    panel.querySelectorAll('[data-tkey]').forEach(tog => {
      tog.addEventListener('click', () => {
        const key = tog.dataset.tkey
        const val = !getTableOptions(sectionId)[key]
        setTableOption(sectionId, key, val)
        tog.classList.toggle('on', val)
        onChanged()
      })
    })
  }

  renderPanel()
  panel._refresh = renderPanel
  return panel
}

// ─── View mode selector UI ────────────────────────────────────────────────────

function buildViewModeSelector(sectionId, onModeChange) {
  const container = document.createElement('div')
  container.className = 'view-mode-controls'

  const selectorWrap = document.createElement('div')
  selectorWrap.className = 'view-mode-selector'

  const modes = [
    { id: 'poster',   icon: 'fas fa-th-large', title: 'Poster View' },
    { id: 'table',    icon: 'fas fa-list',      title: 'Table View' },
    { id: 'overview', icon: 'fas fa-align-justify', title: 'Overview' },
  ]

  const currentMode = getViewMode(sectionId)
  modes.forEach(m => {
    const btn = document.createElement('button')
    btn.className = 'view-mode-btn' + (m.id === currentMode ? ' active' : '')
    btn.dataset.mode = m.id
    btn.title = m.title
    btn.innerHTML = `<i class="${m.icon}"></i>`
    btn.addEventListener('click', () => {
      if (getViewMode(sectionId) === m.id) return
      setViewMode(sectionId, m.id)
      selectorWrap.querySelectorAll('.view-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === m.id))
      optionsPanel._refresh()
      onModeChange(m.id)
    })
    selectorWrap.appendChild(btn)
  })

  container.appendChild(selectorWrap)

  // Options button + panel
  const optionsAnchor = document.createElement('div')
  optionsAnchor.className = 'view-options-anchor'

  const optionsBtn = document.createElement('button')
  optionsBtn.className = 'view-options-btn watch-list-icon-btn'
  optionsBtn.title = 'View Options'
  optionsBtn.innerHTML = '<i class="fas fa-sliders-h"></i>'

  const optionsPanel = buildOptionsPanel(sectionId, () => onModeChange(getViewMode(sectionId)))

  optionsBtn.addEventListener('click', e => {
    e.stopPropagation()
    const hidden = optionsPanel.hasAttribute('hidden')
    // Close any other open panels
    document.querySelectorAll('.view-options-popover:not([hidden])').forEach(p => {
      if (p !== optionsPanel) p.setAttribute('hidden', '')
    })
    if (hidden) {
      optionsPanel.removeAttribute('hidden')
      optionsPanel._refresh()
    } else {
      optionsPanel.setAttribute('hidden', '')
    }
  })

  document.addEventListener('click', e => {
    if (!optionsAnchor.contains(e.target)) {
      optionsPanel.setAttribute('hidden', '')
    }
  })

  optionsAnchor.appendChild(optionsBtn)
  optionsAnchor.appendChild(optionsPanel)
  container.appendChild(optionsAnchor)

  return container
}

// ─── Get movie list from a section ───────────────────────────────────────────

function getMoviesFromSection(sectionId) {
  const config = SECTION_CONFIGS[sectionId]
  if (!config) return []

  if (sectionId === 'tab-matches') {
    // Collect from all match movie cards
    const cards = document.querySelectorAll('.js-matches-friends-list .watch-card')
    return Array.from(cards).map(c => c._movieData).filter(Boolean)
  }

  const listEl = document.querySelector(`.${config.listClass}`)
  if (!listEl) return []
  return Array.from(listEl.querySelectorAll('.watch-card'))
    .map(c => c._movieData)
    .filter(Boolean)
}

// ─── Apply view mode ─────────────────────────────────────────────────────────

function _applyViewMode(sectionId) {
  const mode = getViewMode(sectionId)
  const config = SECTION_CONFIGS[sectionId] || {}

  // Containers
  const section = document.getElementById(sectionId)
  if (!section) return

  let watchList, altContainer, expandBtn, sortWrapper

  if (sectionId === 'tab-matches') {
    watchList = section.querySelector('.js-matches-friends-list')
    altContainer = section.querySelector('.matches-view-alt')
    expandBtn = null
    sortWrapper = null
  } else {
    watchList = config.listClass ? section.querySelector(`.${config.listClass}`) : null
    altContainer = section.querySelector('.view-alt-container')
    expandBtn = config.expandBtnId ? document.getElementById(config.expandBtnId) : null
    sortWrapper = section.querySelector('.sort-controls-wrapper')
  }

  const isOverview = mode === 'overview'

  // Show/hide original list
  if (watchList) watchList.style.display = isOverview ? '' : 'none'

  // Expand/collapse btn only relevant in overview
  if (expandBtn) expandBtn.style.display = isOverview ? '' : 'none'

  // Sort dropdown only hidden in table mode (column-header sort takes over)
  if (sortWrapper) sortWrapper.style.display = mode === 'table' ? 'none' : ''

  // Clear and rebuild alt container
  if (altContainer) {
    altContainer.innerHTML = ''
    if (!isOverview) {
      const movies = getMoviesFromSection(sectionId)
      if (mode === 'table') {
        altContainer.appendChild(buildTableView(sectionId, movies))
      } else if (mode === 'poster') {
        altContainer.appendChild(buildPosterGrid(sectionId, movies))
      }
      altContainer.style.display = ''
    } else {
      altContainer.style.display = 'none'
    }
  }
}

// ─── Public: init a section ───────────────────────────────────────────────────

export function applyViewMode(sectionId) {
  _applyViewMode(sectionId)
}

export function initViewMode(sectionId) {
  const section = document.getElementById(sectionId)
  if (!section) return

  // Create alt container inside the watch-list-container
  if (sectionId === 'tab-matches') {
    const friendsSection = section.querySelector('.matches-friends-section')
    if (friendsSection && !friendsSection.querySelector('.matches-view-alt')) {
      const alt = document.createElement('div')
      alt.className = 'matches-view-alt'
      alt.style.display = 'none'
      friendsSection.appendChild(alt)
    }
  } else {
    const listContainer = section.querySelector('.watch-list-container')
    if (listContainer && !listContainer.querySelector('.view-alt-container')) {
      const alt = document.createElement('div')
      alt.className = 'view-alt-container'
      alt.style.display = 'none'
      listContainer.insertBefore(alt, listContainer.firstChild)
    }
  }

  // Inject view-mode selector into sort-controls
  const sortControls = sectionId === 'tab-matches'
    ? section.querySelector('.matches-view-mode-row')
    : section.querySelector('.sort-controls')

  if (sortControls && !sortControls.querySelector('.view-mode-controls')) {
    const selector = buildViewModeSelector(sectionId, () => _applyViewMode(sectionId))
    sortControls.appendChild(selector)
  }

  // Apply initial view mode
  _applyViewMode(sectionId)
}

// ─── Public: called when a new card is added ──────────────────────────────────

export function viewModeAddItem(sectionId, movie) {
  const mode = getViewMode(sectionId)
  if (mode === 'overview') return // overview uses watch-card directly

  const section = document.getElementById(sectionId)
  if (!section) return

  const altContainer = section.querySelector('.view-alt-container, .matches-view-alt')
  if (!altContainer || altContainer.style.display === 'none') return

  if (mode === 'table') {
    const tbody = altContainer.querySelector('tbody')
    if (tbody) tbody.appendChild(buildTableRow(movie, sectionId, getTableOptions(sectionId)))
  } else if (mode === 'poster') {
    const grid = altContainer.querySelector('.view-poster-grid')
    if (grid) grid.appendChild(buildPosterCard(movie, sectionId))
  }
}

// ─── Public: remove an item from alt views ────────────────────────────────────

export function viewModeRemoveItem(sectionId, guid) {
  const section = document.getElementById(sectionId)
  if (!section) return
  const altContainer = section.querySelector('.view-alt-container, .matches-view-alt')
  if (!altContainer) return
  altContainer.querySelector(`[data-guid="${CSS.escape(guid)}"]`)?.remove()
}
