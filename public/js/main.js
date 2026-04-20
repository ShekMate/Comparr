// /public/js/main.js
// deno-lint-ignore-file

import { ComparrAPI } from './ComparrAPI.js'
import CardView from './CardView.js?v=4'
import { MatchesView } from './MatchesView.js'
import { buildRatingHtml, formatRuntime } from './features/movie-metadata.js'

// Global API reference so functions outside main() can access it
let api

// Attach access password to same-origin API calls so protected endpoints can authorize.
const nativeFetch = window.fetch.bind(window)
let csrfToken = ''
let csrfTokenPromise = null

const isStateChangingMethod = method =>
  ['POST', 'PUT', 'PATCH', 'DELETE'].includes(
    String(method || 'GET').toUpperCase()
  )

const getCsrfToken = async () => {
  if (csrfToken) return csrfToken
  if (csrfTokenPromise) return csrfTokenPromise
  csrfTokenPromise = nativeFetch('/api/csrf-token', { method: 'GET' })
    .then(async res => {
      if (!res.ok) throw new Error('Failed to initialize CSRF token')
      const payload = await res.json().catch(() => ({}))
      csrfToken = String(payload?.csrfToken || '')
      return csrfToken
    })
    .finally(() => {
      csrfTokenPromise = null
    })
  return csrfTokenPromise
}

window.fetch = async (input, init = {}) => {
  try {
    const requestUrl =
      typeof input === 'string' || input instanceof URL
        ? new URL(String(input), window.location.origin)
        : new URL(input.url, window.location.origin)
    const isSameOrigin = requestUrl.origin === window.location.origin
    const isApiPath = requestUrl.pathname.includes('/api/')
    if (
      !isSameOrigin ||
      !isApiPath ||
      requestUrl.pathname === '/api/csrf-token'
    ) {
      return nativeFetch(input, init)
    }

    const headers = new Headers(
      init.headers || (input instanceof Request ? input.headers : undefined)
    )
    const method = String(
      init.method || (input instanceof Request ? input.method : 'GET')
    )
    if (isStateChangingMethod(method) && !headers.has('x-csrf-token')) {
      const token = await getCsrfToken()
      if (token) {
        headers.set('x-csrf-token', token)
      }
    }

    return nativeFetch(input, {
      ...init,
      headers,
    })
  } catch {
    return nativeFetch(input, init)
  }
}

const applyI18nCssVariables = () => {
  const root = document.documentElement
  const body = document.body
  if (!root || !body?.dataset) return

  const i18nCssVars = {
    '--i18n-no-matches': body.dataset.i18nNoMatches || '',
    '--i18n-loading': body.dataset.i18nLoading || '',
    '--i18n-exhausted-cards': body.dataset.i18nExhaustedCards || '',
  }

  for (const [name, value] of Object.entries(i18nCssVars)) {
    if (!value) continue
    root.style.setProperty(name, `'${String(value).replace(/'/g, "\\'")}'`)
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', applyI18nCssVariables, {
    once: true,
  })
} else {
  applyI18nCssVariables()
}

// ===== ADD THESE HELPER FUNCTIONS HERE =====

// --- Normalize any legacy poster paths to our canonical local proxy
function normalizePoster(u) {
  if (!u) return ''
  // Strip known local prefixes so we can inspect the core path
  let core = u
  if (core.startsWith('/tmdb-poster/')) core = core.slice('/tmdb-poster'.length)
  if (core.startsWith('/poster/')) core = core.slice('/poster'.length)

  // Detect raw Plex thumb IDs like "/74101/thumb/1760426051" and avoid proxying them as TMDb posters
  if (/^\/\d+\/thumb\/\d+/.test(core)) return ''

  if (u.startsWith('/cached-poster/') || u.startsWith('/tmdb-poster/')) return u // already good
  if (u.startsWith('/poster/'))
    return '/tmdb-poster/' + u.slice('/poster/'.length) // legacy -> canonical
  if (u.startsWith('http://') || u.startsWith('https://')) return u // full CDN URL
  return '/tmdb-poster' + (u.startsWith('/') ? u : '/' + u) // raw TMDB path
}

const preloadedPosterUrls = new Set()

function getPosterUrlForPreload(movie) {
  const normalized = normalizePoster(
    movie?.art || movie?.posterPath || movie?.poster_path || ''
  )
  if (!normalized) return ''
  if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
    return normalized
  }
  return `${document.body?.dataset?.basePath || ''}${normalized}`
}

function preloadPosterForMovie(movie) {
  const url = getPosterUrlForPreload(movie)
  if (!url || preloadedPosterUrls.has(url)) return

  const img = new Image()
  img.decoding = 'async'
  img.src = url
  img.onload = () => preloadedPosterUrls.add(url)
}

// ===== END OF HELPER FUNCTIONS =====

// ===== FUNNY LOADING MESSAGES =====
const funnyLoadingMessages = [
  "Checking if it's better than the book...",
  "Convincing directors to release the director's cut...",
  'Asking Michael Bay to add more explosions...',
  'Waiting for post-credits scene...',
  'Rewinding VHS tapes...',
  'Adjusting the tracking on the VCR...',
  'Pretending to understand avant-garde cinema...',
  'Counting plot holes...',
  'Checking if Nicolas Cage is in this...',
  'Adjusting brightness for that one dark scene...',
  "Hoping the trailer didn't spoil everything...",
  'Adjusting volume for sudden explosions...',
  'Generating unnecessary slow motion...',
  'Cueing emotional music swell...',
  'Warming up the plot twist...',
  'Setting up completely avoidable problem...',
  'Ensuring the villain explains the plan...',
  "Checking if it's in stock at Blockbuster...",
]

// Get a random loading message
function getRandomLoadingMessage() {
  const randomIndex = Math.floor(Math.random() * funnyLoadingMessages.length)
  return funnyLoadingMessages[randomIndex]
}
// ===== END OF FUNNY LOADING MESSAGES =====

// ===== DROPDOWN BUTTON TEXT UPDATE FUNCTIONS =====
// Helper function to get display names for various filter types
const filterDisplayNames = {
  // Genres
  28: 'Action',
  12: 'Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  14: 'Fantasy',
  36: 'History',
  27: 'Horror',
  10402: 'Music',
  9648: 'Mystery',
  10749: 'Romance',
  878: 'Science Fiction',
  10770: 'TV Movie',
  53: 'Thriller',
  10752: 'War',
  37: 'Western',

  // Languages
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese',
  hi: 'Hindi',
  ar: 'Arabic',
  ru: 'Russian',
  nl: 'Dutch',
  sv: 'Swedish',
  no: 'Norwegian',

  // Countries
  US: 'United States',
  GB: 'United Kingdom',
  CA: 'Canada',
  AU: 'Australia',
  FR: 'France',
  DE: 'Germany',
  ES: 'Spain',
  IT: 'Italy',
  JP: 'Japan',
  KR: 'South Korea',
  CN: 'China',
  IN: 'India',
  BR: 'Brazil',
  MX: 'Mexico',
  NL: 'Netherlands',
  SE: 'Sweden',
  NO: 'Norway',
  DK: 'Denmark',
}

const DEFAULT_YEAR_MIN = 1895
const DEFAULT_VOTE_COUNT = 0
const DEFAULT_LANGUAGES = [] // Start with no language filter to show all movies
const SWIPE_DEFAULTS_STORAGE_KEY = 'comparrSwipeFilterDefaults'
const DISPLAY_PREFERENCES_STORAGE_PREFIX = 'comparrDisplayPreferences'

function getDisplayPreferencesStorageKey() {
  const userName =
    sessionStorage.getItem('userName') ||
    localStorage.getItem('personalUser') ||
    localStorage.getItem('user') ||
    'default-user'
  const roomCode =
    sessionStorage.getItem('roomCode') ||
    localStorage.getItem('personalRoomCode') ||
    localStorage.getItem('roomCode') ||
    'default-room'
  return `${DISPLAY_PREFERENCES_STORAGE_PREFIX}:${roomCode}:${userName}`
}

function getDefaultDisplayPreferences() {
  return {
    showSeenList: false,
    showPassList: false,
  }
}

function loadDisplayPreferences() {
  const defaults = getDefaultDisplayPreferences()
  try {
    const raw = localStorage.getItem(getDisplayPreferencesStorageKey())
    if (!raw) return defaults
    const parsed = JSON.parse(raw)
    return {
      showSeenList:
        typeof parsed?.showSeenList === 'boolean'
          ? parsed.showSeenList
          : defaults.showSeenList,
      showPassList:
        typeof parsed?.showPassList === 'boolean'
          ? parsed.showPassList
          : defaults.showPassList,
    }
  } catch (err) {
    console.warn('Failed to load display preferences:', err)
    return defaults
  }
}

function saveDisplayPreferences(preferences) {
  try {
    localStorage.setItem(
      getDisplayPreferencesStorageKey(),
      JSON.stringify(preferences)
    )
  } catch (err) {
    console.warn('Failed to save display preferences:', err)
  }
}

function applyDisplayPreferencesToNavigation(preferences) {
  const showSeenList = preferences?.showSeenList === true
  const showPassList = preferences?.showPassList === true

  document.querySelectorAll('[data-tab="tab-seen"]').forEach(el => {
    el.style.display = showSeenList ? '' : 'none'
  })
  document.querySelectorAll('[data-tab="tab-dislikes"]').forEach(el => {
    el.style.display = showPassList ? '' : 'none'
  })

  const seenPanel = document.getElementById('tab-seen')
  const passPanel = document.getElementById('tab-dislikes')
  if (seenPanel && !showSeenList) {
    seenPanel.hidden = !showSeenList
  }
  if (passPanel && !showPassList) {
    passPanel.hidden = !showPassList
  }

  const activePanel = document.querySelector('.tab-panel:not([hidden])')
  const activePanelId = activePanel?.id
  const activePanelHiddenByPreference =
    (activePanelId === 'tab-seen' && !showSeenList) ||
    (activePanelId === 'tab-dislikes' && !showPassList)

  if (activePanelHiddenByPreference) {
    const swipeButtons = document.querySelectorAll('[data-tab="tab-swipe"]')
    swipeButtons.forEach(button => button.classList.add('is-active'))
    const swipePanel = document.getElementById('tab-swipe')
    document.querySelectorAll('.tab-panel').forEach(panel => {
      panel.hidden = panel.id !== 'tab-swipe'
    })
    if (swipePanel) {
      swipePanel.hidden = false
    }
  }
}

// Update dropdown button text based on selected items
function updateDropdownButtonText(
  buttonId,
  selectedItems,
  placeholderText,
  mapFunction = null
) {
  const button = document.getElementById(buttonId)
  if (!button) return

  const arrow = '<span class="dropdown-arrow">&#9660;</span>'

  if (!selectedItems || selectedItems.length === 0) {
    button.innerHTML = `${placeholderText} ${arrow}`
    return
  }

  // Map items to display names if provided
  const displayItems = mapFunction
    ? selectedItems.map(mapFunction)
    : selectedItems

  if (displayItems.length === 1) {
    button.innerHTML = `${displayItems[0]} ${arrow}`
  } else if (displayItems.length === 2) {
    button.innerHTML = `${displayItems[0]}, ${displayItems[1]} ${arrow}`
  } else {
    button.innerHTML = `${displayItems.length} selected ${arrow}`
  }
}

// Update genre dropdown button
function updateGenreButton(selectedGenres) {
  updateDropdownButtonText(
    'genre-dropdown-toggle',
    selectedGenres,
    'Select Genres',
    genreId => filterDisplayNames[genreId] || 'Unknown'
  )
}

// Update language dropdown button
function updateLanguageButton(selectedLanguages) {
  updateDropdownButtonText(
    'language-dropdown-toggle',
    selectedLanguages,
    'Select Languages',
    langCode => filterDisplayNames[langCode] || langCode.toUpperCase()
  )
}

// Update country dropdown button
function updateCountryButton(selectedCountries) {
  updateDropdownButtonText(
    'country-dropdown-toggle',
    selectedCountries,
    'Select Countries',
    countryCode => filterDisplayNames[countryCode] || countryCode
  )
}

// Watch filter modal button updates
function updateWatchGenreButton(selectedGenres) {
  updateDropdownButtonText(
    'watch-genre-toggle',
    selectedGenres,
    'Select Genres',
    genreId => filterDisplayNames[genreId] || 'Unknown'
  )
}

function updateWatchLanguageButton(selectedLanguages) {
  updateDropdownButtonText(
    'watch-language-toggle',
    selectedLanguages,
    'Select Languages',
    langCode => filterDisplayNames[langCode] || langCode.toUpperCase()
  )
}

function updateWatchCountryButton(selectedCountries) {
  updateDropdownButtonText(
    'watch-country-toggle',
    selectedCountries,
    'Select Countries',
    countryCode => filterDisplayNames[countryCode] || countryCode
  )
}

// Update content rating dropdown button
function updateContentRatingButton(selectedRatings) {
  updateDropdownButtonText(
    'rating-dropdown-toggle',
    selectedRatings,
    'Select Ratings',
    rating => rating
  )
}

function cloneFilterStateValue(value) {
  if (!value || typeof value !== 'object') {
    return createDefaultSwipeFilterState()
  }
  return JSON.parse(JSON.stringify(value))
}

function createDefaultSwipeFilterState() {
  return {
    yearRange: { min: DEFAULT_YEAR_MIN, max: new Date().getFullYear() },
    genres: [],
    contentRatings: [],
    availability: getDefaultAvailabilityState(),
    showPlexOnly: false,
    languages: [...DEFAULT_LANGUAGES],
    countries: [],
    imdbRating: 0.0,
    tmdbRating: 0.0,
    runtimeRange: { min: 0, max: 300 },
    voteCount: DEFAULT_VOTE_COUNT,
    sortBy: 'popularity.desc',
  }
}

function normalizeFilterStateForDefaults(raw) {
  if (!raw || typeof raw !== 'object') return createDefaultSwipeFilterState()

  const currentYear = new Date().getFullYear()
  const normalized = {
    yearRange: {
      min: Number.isFinite(raw?.yearRange?.min)
        ? raw.yearRange.min
        : DEFAULT_YEAR_MIN,
      max: Number.isFinite(raw?.yearRange?.max)
        ? raw.yearRange.max
        : currentYear,
    },
    genres: Array.isArray(raw?.genres)
      ? raw.genres.map(v => parseInt(v, 10)).filter(Number.isFinite)
      : [],
    contentRatings: Array.isArray(raw?.contentRatings)
      ? raw.contentRatings.map(v => String(v))
      : [],
    availability: normalizeAvailabilityState(raw?.availability),
    showPlexOnly: Boolean(raw?.showPlexOnly),
    languages: Array.isArray(raw?.languages)
      ? raw.languages.map(v => String(v))
      : [...DEFAULT_LANGUAGES],
    countries: Array.isArray(raw?.countries)
      ? raw.countries.map(v => String(v))
      : [],
    imdbRating: Number.isFinite(raw?.imdbRating) ? raw.imdbRating : 0,
    tmdbRating: Number.isFinite(raw?.tmdbRating) ? raw.tmdbRating : 0,
    runtimeRange: {
      min: Number.isFinite(raw?.runtimeRange?.min) ? raw.runtimeRange.min : 0,
      max: Number.isFinite(raw?.runtimeRange?.max) ? raw.runtimeRange.max : 300,
    },
    voteCount: Number.isFinite(raw?.voteCount) ? raw.voteCount : 0,
    sortBy: typeof raw?.sortBy === 'string' ? raw.sortBy : 'popularity.desc',
  }

  normalized.showPlexOnly = deriveShowPlexOnlyFromAvailability(
    normalized.availability,
    normalized.showPlexOnly
  )

  return normalized
}

function loadSavedSwipeFilterDefaults() {
  try {
    const raw = localStorage.getItem(SWIPE_DEFAULTS_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return normalizeFilterStateForDefaults(parsed)
  } catch (err) {
    console.warn('Failed to load saved swipe defaults:', err)
    return null
  }
}

// Watch filter modal content rating button update
function updateWatchContentRatingButton(selectedRatings) {
  updateDropdownButtonText(
    'watch-rating-toggle',
    selectedRatings,
    'Select Ratings',
    rating => rating
  )
}

function initializePasswordVisibilityToggles() {
  document.querySelectorAll('input[type="password"]').forEach(input => {
    if (input.dataset.passwordToggleBound === 'true') return

    const wrapper = document.createElement('div')
    wrapper.className = 'password-visibility-field'

    const parent = input.parentElement
    if (!parent) return

    parent.insertBefore(wrapper, input)
    wrapper.appendChild(input)

    const toggle = document.createElement('button')
    toggle.type = 'button'
    toggle.className = 'password-visibility-toggle'
    toggle.setAttribute('aria-label', 'Show value')
    toggle.setAttribute('aria-pressed', 'false')
    toggle.innerHTML = '<i class="fas fa-eye-slash" aria-hidden="true"></i>'

    toggle.addEventListener('click', () => {
      const isHidden = input.type === 'password'
      input.type = isHidden ? 'text' : 'password'
      toggle.setAttribute('aria-label', isHidden ? 'Hide value' : 'Show value')
      toggle.setAttribute('aria-pressed', isHidden ? 'true' : 'false')
      toggle.innerHTML = isHidden
        ? '<i class="fas fa-eye" aria-hidden="true"></i>'
        : '<i class="fas fa-eye-slash" aria-hidden="true"></i>'
    })

    wrapper.appendChild(toggle)
    input.dataset.passwordToggleBound = 'true'
  })
}
// ===== END DROPDOWN BUTTON TEXT UPDATE FUNCTIONS =====

/* --------------------- tabs --------------------- */
function initTabs() {
  // Get both navigation containers (mobile tabbar and desktop sidebar)
  const sidebar = document.querySelector('.sidebar')
  const tabbar = document.querySelector('.tabbar')
  const panels = document.querySelectorAll('.tab-panel')

  if (!sidebar && !tabbar) return

  // Get all navigation buttons from both containers
  const sidebarButtons = sidebar
    ? sidebar.querySelectorAll('[data-tab]:not(.sidebar-subitem)')
    : []
  const tabbarButtons = tabbar
    ? tabbar.querySelectorAll('[data-tab]:not(.mobile-settings-item)')
    : []
  const allButtons = [...sidebarButtons, ...tabbarButtons]

  applyDisplayPreferencesToNavigation(loadDisplayPreferences())

  // Hide Compare tab for guests (no cross-user comparison available).
  // Auth users always see it, even in personal mode.
  if (document.body.dataset.userType === 'guest') {
    document.querySelectorAll('[data-tab="tab-matches"]').forEach(node => {
      node.style.display = 'none'
    })
    const comparePanel = document.getElementById('tab-matches')
    if (comparePanel) comparePanel.hidden = true
  }

  // Mobile menu dropdown support
  const mobileMenuDropdown = document.querySelector('.mobile-menu-dropdown')
  const mobileMenuToggle = document.querySelector('.mobile-menu-toggle')
  const mobileMenuItems = document.querySelectorAll(
    '.mobile-menu-dropdown .mobile-menu-item[data-tab]'
  )
  const mobileSubmenuToggles = document.querySelectorAll(
    '.mobile-menu-dropdown .dropdown-submenu-toggle'
  )
  const mobileSubmenus = document.querySelectorAll(
    '.mobile-menu-dropdown .dropdown-submenu'
  )
  const mobileSettingsItems = document.querySelectorAll('.mobile-settings-item')
  const settingsToggle = document.querySelector('.sidebar-settings-toggle')
  const settingsWrapper = document.querySelector('.sidebar-settings')
  const settingsSubitems = document.querySelectorAll('.sidebar-subitem')

  // PREVENT DUPLICATE EVENT LISTENERS
  const initMarker = sidebar || tabbar
  if (initMarker.dataset.initialized) {
    return // Already initialized, don't add duplicate listeners
  }

  const activate = id => {
    // Update all buttons in both sidebar and tabbar
    allButtons.forEach(b =>
      b.classList.toggle('is-active', b.dataset.tab === id)
    )
    mobileMenuItems.forEach(item =>
      item.classList.toggle('active', item.dataset.tab === id)
    )
    panels.forEach(p => {
      p.hidden = p.id !== id
    })

    if (mobileMenuToggle) {
      mobileMenuToggle.classList.toggle('is-active', id === 'tab-settings')
    }
  }

  const closeMobileMenu = () => {
    mobileMenuDropdown?.classList.remove('show')
    mobileSubmenus.forEach(submenu => submenu.classList.remove('show'))
  }

  mobileMenuToggle?.addEventListener('click', e => {
    e.stopPropagation()
    mobileMenuDropdown?.classList.toggle('show')
  })

  mobileSubmenuToggles.forEach(toggle => {
    toggle.addEventListener('click', e => {
      e.stopPropagation()
      const submenu = toggle.closest('.dropdown-submenu')
      if (!submenu) return
      mobileSubmenus.forEach(other => {
        if (other !== submenu) other.classList.remove('show')
      })
      submenu.classList.toggle('show')
    })
  })

  mobileMenuDropdown
    ?.querySelector('.dropdown-menu')
    ?.addEventListener('click', e => {
      e.stopPropagation()
    })

  document.addEventListener('click', closeMobileMenu)

  // Tab switching handler
  const handleTabClick = tabId => {
    activate(tabId)

    // Handle Watch list auto-refresh
    if (tabId === 'tab-likes') {
      applyCurrentWatchListSort()
      startWatchListAutoRefresh()
      setTimeout(refreshWatchListStatus, 500)
      // Reset expand/collapse button state
      if (typeof resetExpandCollapseButton === 'function') {
        resetExpandCollapseButton()
      }
    } else if (tabId === 'tab-dislikes') {
      applyCurrentPassListSort()
    } else if (tabId === 'tab-seen') {
      if (typeof window._renderDeferredSeen === 'function') {
        window._renderDeferredSeen()
      } else {
        applyCurrentSeenListSort()
      }
    } else if (tabId === 'tab-matches') {
      if (typeof window.refreshMatchesList === 'function') {
        window.refreshMatchesList()
      }
      if (typeof window.initCompareTab === 'function') {
        window.initCompareTab()
      }
    } else if (tabId === 'tab-settings') {
      if (typeof window.initSettingsTab === 'function') {
        window.initSettingsTab()
      }
    } else if (tabId === 'tab-stats') {
      if (typeof window.refreshStatsTab === 'function') {
        window.refreshStatsTab()
      }
    } else if (tabId === 'tab-recommendations') {
      if (typeof window.refreshRecommendationsTab === 'function') {
        window.refreshRecommendationsTab()
      }
    } else {
      stopWatchListAutoRefresh()
    }
  }

  settingsToggle?.addEventListener('click', () => {
    settingsWrapper?.classList.toggle('is-open')
    const expanded = settingsWrapper?.classList.contains('is-open')
    if (settingsToggle) {
      settingsToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false')
    }
  })

  const settingsTitle = document.getElementById('settings-title')
  const settingsSections = document.querySelectorAll('.settings-section')

  const setActiveSettingsSection = (targetId, titleText, options = {}) => {
    const { highlightMobileItem = true } = options
    const adminSectionIds = new Set([
      'settings-core',
      'settings-personal-media',
      'settings-metadata',
      'settings-request-services',
      'settings-security',
    ])

    currentSettingsTarget = targetId
    clearSettingsStatusAfterDelay()

    settingsSections.forEach(section => {
      const isAdminCompositeTarget =
        targetId === 'settings-admin' && adminSectionIds.has(section.id)
      const isActive = section.id === targetId || isAdminCompositeTarget
      section.toggleAttribute('hidden', !isActive)
    })
    settingsSubitems.forEach(el =>
      el.classList.toggle('is-active', el.dataset.settingsTarget === targetId)
    )
    mobileSettingsItems.forEach(el => {
      el.classList.toggle(
        'active',
        highlightMobileItem && el.dataset.settingsTarget === targetId
      )
    })
    if (settingsTitle && titleText) {
      settingsTitle.textContent = titleText
    }

    applyAdminSettingsTabVisibility()

    if (targetId === 'settings-defaults') {
      enterDefaultsInlineEditor()
    } else {
      exitDefaultsInlineEditor()
    }

    syncSettingsFooterActions()
  }

  settingsSubitems.forEach(item => {
    item.addEventListener('click', () => {
      const targetId = item.dataset.settingsTarget
      const titleText = item.dataset.settingsTitle
      if (!targetId) return
      setActiveSettingsSection(targetId, titleText)
    })
  })

  mobileSettingsItems.forEach(item => {
    item.addEventListener('click', () => {
      const targetId = item.dataset.settingsTarget
      const titleText = item.dataset.settingsTitle
      if (!targetId) return
      handleTabClick('tab-settings')
      setActiveSettingsSection(targetId, titleText)
      mobileSettingsItems.forEach(el =>
        el.classList.toggle('active', el.dataset.settingsTarget === targetId)
      )
      closeMobileMenu()
    })
  })

  // Attach click handlers to all buttons (sidebar and tabbar)
  allButtons.forEach(btn =>
    btn.addEventListener('click', () => {
      handleTabClick(btn.dataset.tab)
      if (
        btn.dataset.tab !== 'tab-settings' &&
        settingsWrapper?.classList.contains('is-open')
      ) {
        settingsWrapper?.classList.remove('is-open')
        settingsToggle?.setAttribute('aria-expanded', 'false')
      }
      closeMobileMenu()
    })
  )

  // Mark as initialized
  initMarker.dataset.initialized = 'true'

  // Activate first tab by default
  if (allButtons[0]) activate(allButtons[0].dataset.tab)
  if (settingsSubitems[0]) {
    const firstTarget = settingsSubitems[0].dataset.settingsTarget
    const firstTitle = settingsSubitems[0].dataset.settingsTitle
    if (firstTarget) {
      setActiveSettingsSection(firstTarget, firstTitle, {
        highlightMobileItem: false,
      })
    }
  }

  // Handle refresh button click
  const refreshBtn = document.getElementById('refresh-watch-btn')
  if (refreshBtn && !refreshBtn.dataset.initialized) {
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.disabled = true
      const icon = refreshBtn.querySelector('i')
      icon.classList.add('fa-spin')

      await refreshWatchListStatus()

      icon.classList.remove('fa-spin')
      refreshBtn.disabled = false
    })

    refreshBtn.dataset.initialized = 'true'
  }
}

function sortWatchList(sortBy) {
  console.log('🔧 sortWatchList called with:', sortBy)

  const likesList = document.querySelector('.likes-list')
  if (!likesList) {
    console.warn('⚠️ .likes-list not found!')
    return
  }

  const cards = Array.from(likesList.querySelectorAll('.watch-card'))
  console.log('🔍 Found cards:', cards.length)

  // Store original order for date sorting
  if (!likesList.dataset.originalOrder) {
    likesList.dataset.originalOrder = cards.map(c => c.dataset.guid).join(',')
  }

  // Parse sortBy into field and direction
  let sortField, sortDirection
  if (sortBy.includes('-')) {
    // New format: "field-direction"
    const parts = sortBy.split('-')
    sortField = parts[0]
    sortDirection = parts[1]
  } else {
    // Old format: keep for backwards compatibility
    sortField = sortBy
    sortDirection = 'desc'
  }

  cards.sort((a, b) => {
    const titleA = a
      .querySelector('.watch-card-title-compact')
      .textContent.trim()
    const titleB = b
      .querySelector('.watch-card-title-compact')
      .textContent.trim()

    const yearA = parseInt(
      a.querySelector('.watch-card-year').textContent.match(/\d+/)?.[0] || 0
    )
    const yearB = parseInt(
      b.querySelector('.watch-card-year').textContent.match(/\d+/)?.[0] || 0
    )

    // Extract all three ratings
    const getRatings = card => {
      const ratingEl = card.querySelector('.watch-card-ratings')
      if (!ratingEl) return { imdb: 0, rt: 0, tmdb: 0 }

      const innerHTML = ratingEl.innerHTML

      // Extract IMDb rating: <img src="..." alt="IMDb"> 7.5
      const imdbMatch = innerHTML.match(/imdb\.svg[^>]*>\s*([\d.]+)/i)
      const imdb = imdbMatch ? parseFloat(imdbMatch[1]) : 0

      // Extract RT rating: <img src="..." alt="RT"> 85%
      const rt = 0

      // Extract TMDb rating: <img src="..." alt="TMDb"> 7.5
      const tmdbMatch = innerHTML.match(/tmdb\.svg[^>]*>\s*([\d.]+)/i)
      const tmdb = tmdbMatch ? parseFloat(tmdbMatch[1]) : 0

      return { imdb, rt, tmdb }
    }

    const ratingsA = getRatings(a)
    const ratingsB = getRatings(b)

    // Get popularity and vote count from data attributes
    const popularityA = parseFloat(a.dataset.popularity || 0)
    const popularityB = parseFloat(b.dataset.popularity || 0)
    const votesA = parseInt(a.dataset.voteCount || 0)
    const votesB = parseInt(b.dataset.voteCount || 0)

    let result = 0

    // Determine sort based on field
    switch (sortField) {
      case 'title':
        result = titleA.localeCompare(titleB)
        break
      case 'year':
      case 'release_date':
        result = yearA - yearB
        break
      case 'imdb':
        result = ratingsA.imdb - ratingsB.imdb
        break
      case 'rt':
        result = ratingsA.rt - ratingsB.rt
        break
      case 'tmdb':
        result = ratingsA.tmdb - ratingsB.tmdb
        break
      case 'popularity':
        result = popularityA - popularityB
        break
      case 'vote_count':
        result = votesA - votesB
        break
      case 'date':
        // Use original insertion order
        const originalOrder = likesList.dataset.originalOrder.split(',')
        const indexA = originalOrder.indexOf(a.dataset.guid)
        const indexB = originalOrder.indexOf(b.dataset.guid)
        result = indexA - indexB
        break
      default:
        result = 0
    }

    // Apply direction (asc = normal, desc = reverse)
    return sortDirection === 'asc' ? result : -result
  })

  // CRITICAL FIX: Remove all cards first, then re-add in sorted order
  cards.forEach(card => card.remove())
  cards.forEach(card => likesList.appendChild(card))

  console.log('✅ Sort complete!')
}

/* --------------------- settings --------------------- */
let settingsDirty = false
let settingsStatusTimeoutId = null

function setSettingsStatus(message) {
  const status = document.querySelector('.settings-status')
  if (status) {
    status.textContent = message
    if (!message) {
      status.classList.remove('is-success', 'is-error', 'is-pulsing')
    }
  }
}

function pulseSettingsStatus(type = 'info') {
  const status = document.querySelector('.settings-status')
  if (!status) return

  status.classList.remove('is-success', 'is-error', 'is-pulsing')
  if (type === 'success') {
    status.classList.add('is-success')
  } else if (type === 'error') {
    status.classList.add('is-error')
  }

  // Force reflow so the pulse animation can retrigger each time.
  void status.offsetWidth
  status.classList.add('is-pulsing')
}

function clearSettingsStatusAfterDelay(delayMs = 0) {
  if (settingsStatusTimeoutId) {
    clearTimeout(settingsStatusTimeoutId)
    settingsStatusTimeoutId = null
  }

  if (!delayMs) {
    setSettingsStatus('')
    return
  }

  settingsStatusTimeoutId = setTimeout(() => {
    setSettingsStatus('')
    settingsStatusTimeoutId = null
  }, delayMs)
}

function clearCachedAdminPassword() {
  // no-op: admin password auth was removed
}

function parseApiErrorMessage(data, fallback = 'Request failed.') {
  if (typeof data?.message === 'string' && data.message.trim()) {
    return data.message
  }
  if (typeof data?.error === 'string' && data.error.trim()) {
    return data.error
  }
  return fallback
}

function setSettingsDirty(isDirty) {
  settingsDirty = Boolean(isDirty)
  if (settingsDirty) {
    setSettingsStatus('You have unsaved changes.')
    pulseSettingsStatus('info')
  }
  syncSettingsFooterActions()
}

function hydrateDisplaySettingsForm() {
  displayPreferences = loadDisplayPreferences()
  const showSeenListInput = document.getElementById(
    'setting-display-show-seen-list'
  )
  const showPassListInput = document.getElementById(
    'setting-display-show-pass-list'
  )

  if (showSeenListInput) {
    showSeenListInput.setAttribute(
      'aria-pressed',
      displayPreferences.showSeenList === true ? 'true' : 'false'
    )
    showSeenListInput.textContent =
      displayPreferences.showSeenList === true
        ? 'Hide Seen List'
        : 'Show Seen List'
  }
  if (showPassListInput) {
    showPassListInput.setAttribute(
      'aria-pressed',
      displayPreferences.showPassList === true ? 'true' : 'false'
    )
    showPassListInput.textContent =
      displayPreferences.showPassList === true
        ? 'Hide Pass List'
        : 'Show Pass List'
  }
}

function collectDisplaySettingsForm() {
  const showSeenListInput = document.getElementById(
    'setting-display-show-seen-list'
  )
  const showPassListInput = document.getElementById(
    'setting-display-show-pass-list'
  )

  return {
    showSeenList: showSeenListInput
      ? showSeenListInput.getAttribute('aria-pressed') === 'true'
      : false,
    showPassList: showPassListInput
      ? showPassListInput.getAttribute('aria-pressed') === 'true'
      : false,
  }
}

function initializeDisplaySettingsToggleButtons() {
  const toggleButtons = [
    {
      id: 'setting-display-show-seen-list',
      enabledLabel: 'Hide Seen List',
      disabledLabel: 'Show Seen List',
    },
    {
      id: 'setting-display-show-pass-list',
      enabledLabel: 'Hide Pass List',
      disabledLabel: 'Show Pass List',
    },
  ]

  toggleButtons.forEach(({ id, enabledLabel, disabledLabel }) => {
    const button = document.getElementById(id)
    if (!button || button.dataset.displayToggleBound === 'true') return

    button.addEventListener('click', () => {
      const enabled = button.getAttribute('aria-pressed') !== 'true'
      button.setAttribute('aria-pressed', enabled ? 'true' : 'false')
      button.textContent = enabled ? enabledLabel : disabledLabel
      setSettingsDirty(true)
    })

    button.dataset.displayToggleBound = 'true'
  })
}

function saveDisplaySettingsForm() {
  const nextPreferences = collectDisplaySettingsForm()
  displayPreferences = nextPreferences
  saveDisplayPreferences(nextPreferences)
  applyDisplayPreferencesToNavigation(nextPreferences)
}

let settingsAccessState = {
  canAccess: false,
  requiresAdminPassword: false,
}
let hasAdminSettingsAccess = false
let currentSettingsTarget = 'settings-availability'
let activeAdminSettingsTab = 'settings-core'
let displayPreferences = loadDisplayPreferences()

function getAdminHeaders() {
  return {}
}

async function fetchSettingsAccess() {
  try {
    const res = await fetch('/api/settings-access')
    if (!res.ok) return { canAccess: false, requiresAdminPassword: false }
    const data = await res.json()
    return {
      canAccess: Boolean(data?.canAccess),
      requiresAdminPassword: Boolean(data?.requiresAdminPassword),
    }
  } catch (err) {
    console.warn('Settings access check failed:', err)
    return { canAccess: false, requiresAdminPassword: false }
  }
}

async function ensureAdminAccess(forcePrompt = false) {
  // Always refresh access state so we never act on stale data (e.g. after
  // setup/admin state changes, requiresAdminPassword could
  // still be false from the initial page-load fetch).
  settingsAccessState = await fetchSettingsAccess()

  console.debug('[admin-auth] ensureAdminAccess', { forcePrompt })

  if (!settingsAccessState.canAccess) return false
  return true
}

async function loadClientConfig() {
  try {
    const res = await fetch('/api/client-config')
    if (!res.ok) return
    const data = await res.json()
    if (data?.plexLibraryName) {
      window.PLEX_LIBRARY_NAME = data.plexLibraryName
    }
    if (data?.embyLibraryName) {
      window.EMBY_LIBRARY_NAME = data.embyLibraryName
    }
    if (data?.jellyfinLibraryName) {
      window.JELLYFIN_LIBRARY_NAME = data.jellyfinLibraryName
    }
    if (data?.paidStreamingServices !== undefined) {
      window.PAID_STREAMING_SERVICES = data.paidStreamingServices
    }
    if (data?.personalMediaSources !== undefined) {
      window.PERSONAL_MEDIA_SOURCES = data.personalMediaSources
    }
    if (data?.plexConfigured !== undefined) {
      window.PLEX_CONFIGURED = Boolean(data.plexConfigured)
    }
    if (data?.embyConfigured !== undefined) {
      window.EMBY_CONFIGURED = Boolean(data.embyConfigured)
    }
    if (data?.jellyfinConfigured !== undefined) {
      window.JELLYFIN_CONFIGURED = Boolean(data.jellyfinConfigured)
    }
    if (data?.tmdbConfigured !== undefined) {
      window.TMDB_CONFIGURED = Boolean(data.tmdbConfigured)
    }
    if (data?.setupWizardCompleted !== undefined) {
      window.SETUP_WIZARD_COMPLETED = Boolean(data.setupWizardCompleted)
    }
    if (data?.accessPasswordSet !== undefined) {
      window.ACCESS_PASSWORD_SET = Boolean(data.accessPasswordSet)
    }
    if (data?.userAuthEnabled !== undefined) {
      window.USER_AUTH_ENABLED = Boolean(data.userAuthEnabled)
    } else {
      // Plex auth is mandatory; default true if older payload omits this field.
      window.USER_AUTH_ENABLED = true
    }
    if (data?.plexRestrictToServer !== undefined) {
      window.PLEX_RESTRICT_TO_SERVER = Boolean(data.plexRestrictToServer)
    }
    if (data?.userHasServerAccess !== undefined) {
      window.USER_HAS_SERVER_ACCESS = Boolean(data.userHasServerAccess)
    }
    updateHostManagedSubscriptionServiceOptions()
  } catch (err) {
    console.warn('Client config fetch failed:', err)
  }
}

const FREE_STREAMING_SERVICE_OPTIONS = [
  'tubi',
  'pluto-tv',
  'freevee',
  'roku-channel',
  'crackle',
]

const USER_ONBOARDING_VERSION = 'v1'
const USER_ONBOARDING_STORAGE_PREFIX = 'comparrUserOnboarding'
const USER_SUBSCRIPTIONS_STORAGE_PREFIX = 'comparrUserSubscriptions'

const getUserOnboardingStorageKey = userId =>
  `${USER_ONBOARDING_STORAGE_PREFIX}:${USER_ONBOARDING_VERSION}:${userId}`

const getUserSubscriptionsStorageKey = userId =>
  `${USER_SUBSCRIPTIONS_STORAGE_PREFIX}:${userId}`

function loadUserSubscriptions(userId) {
  if (!userId) return []
  try {
    const raw = localStorage.getItem(getUserSubscriptionsStorageKey(userId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map(v => String(v).trim()).filter(Boolean)
  } catch {
    return []
  }
}

function saveUserSubscriptions(userId, subscriptions) {
  if (!userId) return
  const normalized = Array.from(
    new Set((subscriptions || []).map(v => String(v).trim()).filter(Boolean))
  )
  localStorage.setItem(
    getUserSubscriptionsStorageKey(userId),
    JSON.stringify(normalized)
  )
}

<<<<<<< codex/task-title-ucuzdd
function applyUserSubscriptions(services) {
  const normalized = Array.isArray(services)
    ? Array.from(
        new Set(services.map(v => String(v).trim()).filter(Boolean))
      )
    : []

  const availability = normalizeAvailabilityState(window.filterState?.availability, {
    enforceSelection: false,
  })
  const { paidServices, personalSources } = getAvailableSubscriptionOptions()
  const availableSet = new Set([...paidServices, ...personalSources])
  const nextSelected = normalized.filter(service => availableSet.has(service))

  availability.subscriptionServices = nextSelected
  availability.paidSubscriptions = nextSelected.some(service =>
    paidServices.includes(service)
  )
  availability.roomPersonalMedia = nextSelected.some(service =>
    personalSources.includes(service)
  )

  if (nextSelected.length === 0) {
    availability.paidSubscriptions = false
    availability.roomPersonalMedia = false
    if (!availability.freeStreaming) {
      availability.anywhere = true
    }
  } else {
    availability.anywhere = false
  }

  window.filterState = window.filterState || {}
  window.filterState.availability = availability
  updateSwipeAvailabilityUI()
}

=======
>>>>>>> dev
async function maybeRunUserOnboardingWizard(currentUser) {
  if (!currentUser?.id) return

  const completionKey = getUserOnboardingStorageKey(currentUser.id)
  if (localStorage.getItem(completionKey) === 'complete') return

  const { paidServices = [], personalSources = [] } =
    getAvailableSubscriptionOptions()
  const allOptions = [...paidServices, ...personalSources]
  const existingSubs = loadUserSubscriptions(currentUser.id)
  const existingDisplayPrefs = loadDisplayPreferences()

  await new Promise(resolve => {
    const modal = document.createElement('div')
    modal.className = 'first-run-guide-modal is-visible'
    modal.style.zIndex = '1300'
    modal.innerHTML = `
      <div class="first-run-guide-content" style="max-width:640px">
        <h3 id="user-onboarding-title" style="margin-bottom:0.4rem">Welcome to Comparr</h3>
        <p id="user-onboarding-copy" class="first-run-guide-instruction" style="margin-bottom:1rem"></p>
        <div id="user-onboarding-body"></div>
        <div class="first-run-guide-actions" style="margin-top:1rem">
          <button type="button" id="user-onboarding-back" class="submit-button first-run-guide-secondary">Back</button>
          <button type="button" id="user-onboarding-skip" class="submit-button first-run-guide-secondary">Skip</button>
          <button type="button" id="user-onboarding-next" class="submit-button">Next</button>
        </div>
      </div>
    `
    document.body.appendChild(modal)

    const steps = ['preferences', 'subscriptions', 'friends']
    let idx = 0
    const state = {
      showSeenList: existingDisplayPrefs.showSeenList !== false,
      showPassList: existingDisplayPrefs.showPassList !== false,
      subscriptions: existingSubs.length ? existingSubs : paidServices,
    }

    const title = modal.querySelector('#user-onboarding-title')
    const copy = modal.querySelector('#user-onboarding-copy')
    const body = modal.querySelector('#user-onboarding-body')
    const backBtn = modal.querySelector('#user-onboarding-back')
    const skipBtn = modal.querySelector('#user-onboarding-skip')
    const nextBtn = modal.querySelector('#user-onboarding-next')

    const render = () => {
      const step = steps[idx]
      backBtn.hidden = idx === 0
      nextBtn.textContent = idx === steps.length - 1 ? 'Finish' : 'Next'

      if (step === 'preferences') {
        title.textContent = 'Step 1: Display Preferences'
        copy.textContent = 'Choose which personal lists you want visible.'
        body.innerHTML = `
          <label class="first-run-user-auth-row">
            <input type="checkbox" id="user-onboarding-seen" ${
              state.showSeenList ? 'checked' : ''
            } />
            <div><strong>Show Seen list</strong></div>
          </label>
          <label class="first-run-user-auth-row">
            <input type="checkbox" id="user-onboarding-pass" ${
              state.showPassList ? 'checked' : ''
            } />
            <div><strong>Show Pass list</strong></div>
          </label>
        `
        return
      }

      if (step === 'subscriptions') {
        title.textContent = 'Step 2: My Subscriptions'
        copy.textContent =
          'Pick the services you want pre-selected while filtering.'
        body.innerHTML = allOptions.length
          ? allOptions
              .map(
                option => `<label class="first-run-user-auth-row">
              <input type="checkbox" class="user-onboarding-sub" value="${option}" ${
                  state.subscriptions.includes(option) ? 'checked' : ''
                } />
              <div><strong>${option}</strong></div>
            </label>`
              )
              .join('')
          : `<p class="first-run-guide-instruction">No host-managed subscriptions are available yet.</p>`
        return
      }

      title.textContent = 'Step 3: Connect Friends'
      copy.textContent =
        'Use your invite code and add friends in the Compare tab to unlock shared matching.'
      body.innerHTML = `
        <p class="first-run-guide-instruction">Open <strong>Compare</strong> to add or accept friend invites.</p>
        <p class="first-run-guide-instruction">You can update all of these preferences later in Settings.</p>
      `
    }

    const saveAndFinish = async () => {
      saveDisplayPreferences({
        showSeenList: state.showSeenList,
        showPassList: state.showPassList,
      })
      applyDisplayPreferencesToNavigation(loadDisplayPreferences())
      saveUserSubscriptions(currentUser.id, state.subscriptions)
<<<<<<< codex/task-title-ucuzdd
      applyUserSubscriptions(state.subscriptions)
=======
>>>>>>> dev

      try {
        await fetch('/api/profile/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            defaultFilters: JSON.stringify({
              onboardingCompleted: true,
              subscriptions: state.subscriptions,
            }),
          }),
        })
      } catch {
        // non-fatal: onboarding completion is still tracked locally
      }

      localStorage.setItem(completionKey, 'complete')
      modal.remove()
      resolve()
    }

    backBtn.addEventListener('click', () => {
      idx = Math.max(0, idx - 1)
      render()
    })

    skipBtn.addEventListener('click', async () => {
      localStorage.setItem(completionKey, 'complete')
      modal.remove()
      resolve()
    })

    nextBtn.addEventListener('click', async () => {
      const step = steps[idx]
      if (step === 'preferences') {
        state.showSeenList = Boolean(
          body.querySelector('#user-onboarding-seen')?.checked
        )
        state.showPassList = Boolean(
          body.querySelector('#user-onboarding-pass')?.checked
        )
      } else if (step === 'subscriptions') {
        state.subscriptions = Array.from(
          body.querySelectorAll('.user-onboarding-sub:checked')
        ).map(input => String(input.value))
      }

      if (idx === steps.length - 1) {
        await saveAndFinish()
        return
      }
      idx += 1
      render()
    })

    render()
  })
}

function getDefaultAvailabilityState() {
  return {
    anywhere: true,
    roomPersonalMedia: false,
    paidSubscriptions: false,
    freeStreaming: false,
    subscriptionServices: [],
    freeStreamingServices: [],
  }
}

function normalizeAvailabilityState(value, options = {}) {
  const { enforceSelection = true, enforceAnywhereExclusivity = true } = options
  const fallback = getDefaultAvailabilityState()
  if (!value || typeof value !== 'object') {
    return fallback
  }

  const state = {
    anywhere: Boolean(value.anywhere),
    roomPersonalMedia: Boolean(value.roomPersonalMedia),
    paidSubscriptions: Boolean(value.paidSubscriptions),
    freeStreaming: Boolean(value.freeStreaming),
    subscriptionServices: Array.isArray(value.subscriptionServices)
      ? value.subscriptionServices
          .map(service => String(service).trim())
          .filter(Boolean)
      : [],
    freeStreamingServices: Array.isArray(value.freeStreamingServices)
      ? value.freeStreamingServices
          .map(service => String(service).trim())
          .filter(Boolean)
      : [],
  }

  state.subscriptionServices = Array.from(new Set(state.subscriptionServices))
  state.freeStreamingServices = Array.from(new Set(state.freeStreamingServices))

  if (
    enforceSelection &&
    !state.anywhere &&
    !state.roomPersonalMedia &&
    !state.paidSubscriptions &&
    !state.freeStreaming
  ) {
    state.anywhere = true
  }

  if (enforceAnywhereExclusivity && state.anywhere) {
    state.roomPersonalMedia = false
    state.paidSubscriptions = false
    state.freeStreaming = false
    state.subscriptionServices = []
    state.freeStreamingServices = []
  }

  if (!state.freeStreaming) {
    state.freeStreamingServices = []
  }

  return state
}

function deriveShowPlexOnlyFromAvailability(availability) {
  const normalized = normalizeAvailabilityState(availability)
  return (
    !normalized.anywhere &&
    normalized.roomPersonalMedia &&
    !normalized.paidSubscriptions &&
    !normalized.freeStreaming
  )
}

function syncSettingsFooterActions() {
  const defaultsResetButton = document.getElementById('settings-defaults-reset')

  if (defaultsResetButton) {
    defaultsResetButton.hidden = currentSettingsTarget !== 'settings-defaults'
  }

  // Hide Save Changes on the Reset sub-tab — there are no settings to save there.
  const saveBtn = document.querySelector('.settings-save-btn')
  if (saveBtn) {
    saveBtn.hidden =
      currentSettingsTarget === 'settings-admin' &&
      activeAdminSettingsTab === 'settings-reset'
  }
}

function applyAdminSettingsTabVisibility() {
  const adminControls = document.getElementById('settings-admin-controls')
  const tabsContainer = document.getElementById('settings-admin-tabs')
  if (!tabsContainer) return

  const shouldShow =
    currentSettingsTarget === 'settings-admin' && hasAdminSettingsAccess
  adminControls?.toggleAttribute('hidden', !shouldShow)
  tabsContainer.toggleAttribute('hidden', !shouldShow)

  if (!shouldShow) return

  const tabs = Array.from(
    tabsContainer.querySelectorAll('[data-admin-tab-target]')
  )
  if (tabs.length === 0) return

  const hasActive = tabs.some(
    tab => tab.dataset.adminTabTarget === activeAdminSettingsTab
  )
  if (!hasActive) {
    activeAdminSettingsTab = tabs[0].dataset.adminTabTarget || 'settings-core'
  }

  tabs.forEach(tab => {
    const target = tab.dataset.adminTabTarget || ''
    tab.classList.toggle('is-active', target === activeAdminSettingsTab)
  })

  document.querySelectorAll('[data-admin-tab-panel]').forEach(panel => {
    panel.toggleAttribute('hidden', panel.id !== activeAdminSettingsTab)
  })

  updateAdvancedSettingsToggleVisibility()
}

function initializeAdminSettingsTabs() {
  const tabsContainer = document.getElementById('settings-admin-tabs')
  if (!tabsContainer || tabsContainer.dataset.boundAdminTabs === 'true') return

  tabsContainer.querySelectorAll('[data-admin-tab-target]').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.adminTabTarget
      if (!target) return
      clearSettingsStatusAfterDelay()
      activeAdminSettingsTab = target
      applyAdminSettingsTabVisibility()
      syncSettingsFooterActions()
      if (target === 'settings-reset') {
        initializeResetTab()
        loadUserHistory()
      }
    })
  })

  tabsContainer.dataset.boundAdminTabs = 'true'
}

// ─── Reset Tab Logic ──────────────────────────────────────────

function openResetModal({
  title,
  body,
  confirmLabel,
  confirmClass,
  onConfirm,
}) {
  const overlay = document.getElementById('reset-modal-overlay')
  const titleEl = document.getElementById('reset-modal-title')
  const bodyEl = document.getElementById('reset-modal-body')
  const input = document.getElementById('reset-modal-input')
  const confirmBtn = document.getElementById('reset-modal-confirm')
  const cancelBtn = document.getElementById('reset-modal-cancel')
  const iconEl = document.getElementById('reset-modal-icon')

  if (!overlay) return

  titleEl.textContent = title
  bodyEl.textContent = body
  confirmBtn.textContent = confirmLabel
  confirmBtn.className = `reset-modal__confirm${
    confirmClass ? ' ' + confirmClass : ''
  }`
  iconEl.className = `reset-modal__icon${
    confirmClass?.includes('warn') ? ' reset-modal__icon--warn' : ''
  }`
  input.value = ''
  confirmBtn.disabled = true
  overlay.hidden = false
  setTimeout(() => input.focus(), 80)

  const onInput = () => {
    const valid = input.value.trim().toUpperCase() === 'YES'
    confirmBtn.disabled = !valid
    input.classList.toggle('is-valid', valid)
  }

  const cleanup = () => {
    input.removeEventListener('input', onInput)
    confirmBtn.removeEventListener('click', onConfirmClick)
    cancelBtn.removeEventListener('click', onCancel)
    overlay.removeEventListener('click', onOverlayClick)
    overlay.hidden = true
  }

  const onConfirmClick = async () => {
    if (input.value.trim().toUpperCase() !== 'YES') return
    cleanup()
    await onConfirm()
  }

  const onCancel = () => cleanup()
  const onOverlayClick = e => {
    if (e.target === overlay) cleanup()
  }

  input.addEventListener('input', onInput)
  confirmBtn.addEventListener('click', onConfirmClick)
  cancelBtn.addEventListener('click', onCancel)
  overlay.addEventListener('click', onOverlayClick)
}

async function handleResetSettings() {
  openResetModal({
    title: 'Reset All Settings?',
    body:
      'This will clear ALL settings and integrations. Your browser will refresh to the Setup Wizard. User names and room codes will be preserved. Type "YES" and click Reset to confirm.',
    confirmLabel: 'Reset',
    confirmClass: '',
    onConfirm: async () => {
      const base = document.body.dataset.basePath || ''
      try {
        const res = await fetch(`${base}/api/admin/reset-settings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAdminHeaders() },
        })
        if (!res.ok) throw new Error('Request failed')
        // Clear all localStorage that relates to settings/state
        const keysToRemove = []
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i)
          if (k) keysToRemove.push(k)
        }
        keysToRemove.forEach(k => localStorage.removeItem(k))
        sessionStorage.clear()
        window.location.reload()
      } catch (err) {
        setSettingsStatus(`Failed to reset: ${err?.message || err}`)
        pulseSettingsStatus('error')
      }
    },
  })
}

let userHistoryData = []

async function loadUserHistory() {
  const listEl = document.getElementById('user-history-list')
  if (!listEl) return
  listEl.innerHTML =
    '<div class="user-history-empty"><i class="fas fa-circle-notch fa-spin"></i> Loading…</div>'
  const base = document.body.dataset.basePath || ''

  const doFetch = async () => {
    const res = await fetch(`${base}/api/admin/user-history`, {
      headers: { ...getAdminHeaders() },
    })
    const data = await res.json()
    return { res, data }
  }

  try {
    let { res, data } = await doFetch()

    // The Reset tab is only reachable after the admin click-guard has
    // authenticated the session, so a 403 here means the session password is
    // missing or stale — not that we need to prompt from scratch.  Show a
    // clear error rather than wiping the session and re-prompting unexpectedly.
    if (res.status === 403) {
      console.warn('[admin-auth] loadUserHistory got 403')
      listEl.innerHTML = `<div class="user-history-empty"><i class="fas fa-exclamation-circle"></i> Admin access required. Please close and re-open Admin Settings.</div>`
      return
    }

    if (!data.success) throw new Error(data.message || 'Failed to load')
    userHistoryData = data.rooms || []
    renderUserHistory(userHistoryData, listEl)
  } catch (err) {
    listEl.innerHTML = `<div class="user-history-empty"><i class="fas fa-exclamation-circle"></i> ${
      err?.message || 'Failed to load history'
    }</div>`
  }
}

function renderUserHistory(rooms, listEl) {
  if (!rooms.length) {
    listEl.innerHTML =
      '<div class="user-history-empty"><i class="fas fa-check-circle"></i> No user history found.</div>'
    return
  }
  listEl.innerHTML = ''
  rooms.forEach(room => {
    const roomEl = document.createElement('div')
    roomEl.className = 'user-history-room'
    roomEl.dataset.roomCode = room.roomCode

    const header = document.createElement('div')
    header.className = 'user-history-room-header'

    const roomCb = document.createElement('input')
    roomCb.type = 'checkbox'
    roomCb.className = 'user-history-room-checkbox'
    roomCb.dataset.room = room.roomCode

    const roomLabel = document.createElement('span')
    roomLabel.className = 'user-history-room-label'
    roomLabel.textContent = room.roomCode

    const roomCount = document.createElement('span')
    roomCount.className = 'user-history-room-count'
    roomCount.textContent = `${room.users.length} user${
      room.users.length !== 1 ? 's' : ''
    }`

    const toggleIcon = document.createElement('i')
    toggleIcon.className = 'fas fa-chevron-down user-history-room-toggle'

    header.appendChild(roomCb)
    header.appendChild(roomLabel)
    header.appendChild(roomCount)
    header.appendChild(toggleIcon)

    const usersEl = document.createElement('div')
    usersEl.className = 'user-history-users'
    room.users.forEach(userName => {
      const userEl = document.createElement('div')
      userEl.className = 'user-history-user'

      const userCb = document.createElement('input')
      userCb.type = 'checkbox'
      userCb.className = 'user-history-user-checkbox'
      userCb.dataset.room = room.roomCode
      userCb.dataset.user = userName

      const userNameEl = document.createElement('span')
      userNameEl.className = 'user-history-user-name'
      userNameEl.textContent = userName

      userEl.appendChild(userCb)
      userEl.appendChild(userNameEl)
      usersEl.appendChild(userEl)
    })

    // Toggle expand/collapse
    header.addEventListener('click', e => {
      if (e.target === roomCb) return
      roomEl.classList.toggle('is-expanded')
    })

    // Room checkbox cascades to users
    roomCb.addEventListener('change', () => {
      usersEl.querySelectorAll('.user-history-user-checkbox').forEach(cb => {
        cb.checked = roomCb.checked
      })
    })

    // User checkbox affects room checkbox state
    usersEl.addEventListener('change', () => {
      const userCbs = Array.from(
        usersEl.querySelectorAll('.user-history-user-checkbox')
      )
      const allChecked = userCbs.every(cb => cb.checked)
      const anyChecked = userCbs.some(cb => cb.checked)
      roomCb.checked = allChecked
      roomCb.indeterminate = !allChecked && anyChecked
    })

    roomEl.appendChild(header)
    roomEl.appendChild(usersEl)
    listEl.appendChild(roomEl)
  })
}

function getSelectedHistory() {
  const listEl = document.getElementById('user-history-list')
  if (!listEl) return null

  const roomCheckboxes = listEl.querySelectorAll(
    '.user-history-room-checkbox:checked'
  )
  // If all rooms fully selected, use clearAll
  const totalRooms = listEl.querySelectorAll('.user-history-room-checkbox')
    .length
  if (roomCheckboxes.length === totalRooms && totalRooms > 0) {
    // Verify all users are also checked
    const allUserCbs = listEl.querySelectorAll('.user-history-user-checkbox')
    const allUserChecked = Array.from(allUserCbs).every(cb => cb.checked)
    if (allUserChecked || allUserCbs.length === 0) return { clearAll: true }
  }

  const rooms = []
  listEl.querySelectorAll('.user-history-room').forEach(roomEl => {
    const roomCode = roomEl.dataset.roomCode
    const roomCb = roomEl.querySelector('.user-history-room-checkbox')
    const userCbs = Array.from(
      roomEl.querySelectorAll('.user-history-user-checkbox')
    )
    const checkedUsers = userCbs
      .filter(cb => cb.checked)
      .map(cb => cb.dataset.user)
    if (roomCb.checked || checkedUsers.length > 0) {
      const entry = { roomCode }
      if (!roomCb.checked || roomCb.indeterminate) {
        entry.users = checkedUsers
      }
      rooms.push(entry)
    }
  })
  return rooms.length ? { rooms } : null
}

function isCurrentSessionCleared(selection) {
  const currentUser =
    sessionStorage.getItem('userName') ||
    localStorage.getItem('personalUser') ||
    localStorage.getItem('user')
  const currentRoom =
    sessionStorage.getItem('roomCode') ||
    localStorage.getItem('personalRoomCode') ||
    localStorage.getItem('roomCode')
  if (!currentUser || !currentRoom) return false
  if (selection.clearAll) return true
  if (!selection.rooms) return false
  const matchingRoom = selection.rooms.find(
    r => r.roomCode?.toUpperCase() === currentRoom.toUpperCase()
  )
  if (!matchingRoom) return false
  // Room-level clear (no specific users listed) covers everyone in the room
  if (!matchingRoom.users) return true
  return matchingRoom.users.some(
    u => u.toLowerCase() === currentUser.toLowerCase()
  )
}

async function handleClearUserHistory() {
  const selection = getSelectedHistory()
  if (!selection) {
    setSettingsStatus('Select at least one room or user to clear.')
    pulseSettingsStatus('error')
    return
  }

  const isAll = selection.clearAll
  openResetModal({
    title: 'Clear User History?',
    body: isAll
      ? 'This will permanently delete all user history across all rooms. This cannot be undone.'
      : 'This will permanently delete the selected user history. This cannot be undone.',
    confirmLabel: 'Clear',
    confirmClass: 'reset-modal__confirm--warn',
    onConfirm: async () => {
      const base = document.body.dataset.basePath || ''
      try {
        const res = await fetch(`${base}/api/admin/clear-user-history`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAdminHeaders() },
          body: JSON.stringify(selection),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data?.message || `Server error ${res.status}`)
        }
        setSettingsStatus('User history cleared successfully.')
        pulseSettingsStatus('success')
        if (isCurrentSessionCleared(selection)) {
          localStorage.removeItem('user')
          localStorage.removeItem('roomCode')
          localStorage.removeItem('personalUser')
          localStorage.removeItem('personalRoomCode')
          sessionStorage.clear()
          window.location.reload()
          return
        }
        await loadUserHistory()
      } catch (err) {
        const msg = `Failed to clear: ${err?.message || err}`
        setSettingsStatus(msg)
        pulseSettingsStatus('error')
        alert(msg)
      }
    },
  })
}

function initializeResetTab() {
  const resetBtn = document.getElementById('reset-settings-btn')
  const clearBtn = document.getElementById('clear-user-history-btn')
  const selectAll = document.getElementById('user-history-select-all')
  const deselectAll = document.getElementById('user-history-deselect-all')
  const refresh = document.getElementById('user-history-refresh')

  if (resetBtn && !resetBtn.dataset.boundReset) {
    resetBtn.addEventListener('click', handleResetSettings)
    resetBtn.dataset.boundReset = 'true'
  }
  if (clearBtn && !clearBtn.dataset.boundClear) {
    clearBtn.addEventListener('click', handleClearUserHistory)
    clearBtn.dataset.boundClear = 'true'
  }
  if (selectAll && !selectAll.dataset.boundSelect) {
    selectAll.addEventListener('click', () => {
      document
        .querySelectorAll(
          '.user-history-room-checkbox, .user-history-user-checkbox'
        )
        .forEach(cb => {
          cb.checked = true
          cb.indeterminate = false
        })
    })
    selectAll.dataset.boundSelect = 'true'
  }
  if (deselectAll && !deselectAll.dataset.boundDeselect) {
    deselectAll.addEventListener('click', () => {
      document
        .querySelectorAll(
          '.user-history-room-checkbox, .user-history-user-checkbox'
        )
        .forEach(cb => {
          cb.checked = false
          cb.indeterminate = false
        })
    })
    deselectAll.dataset.boundDeselect = 'true'
  }
  if (refresh && !refresh.dataset.boundRefresh) {
    refresh.addEventListener('click', loadUserHistory)
    refresh.dataset.boundRefresh = 'true'
  }
}

// ─────────────────────────────────────────────────────────────

function updateAdminOnlySettingsVisibility() {
  const canSeeAdmin = hasAdminSettingsAccess

  document.querySelectorAll('[data-admin-only]').forEach(el => {
    el.toggleAttribute('hidden', !canSeeAdmin)
  })

  applyAdminSettingsTabVisibility()
}

function toggleSettingsVisibility(canAccess) {
  initializePaidStreamingServicesControl()
  initializePersonalMediaSourcesControl()

  const settingsButtons = document.querySelectorAll('[data-tab="tab-settings"]')
  settingsButtons.forEach(btn => {
    btn.style.display = canAccess ? '' : 'none'
  })
  const settingsWrapper = document.querySelector('.sidebar-settings')
  if (settingsWrapper) {
    settingsWrapper.style.display = canAccess ? '' : 'none'
  }

  const settingsPanel = document.getElementById('tab-settings')
  if (!canAccess) {
    settingsPanel?.setAttribute('hidden', '')
    settingsPanel?.classList.remove('is-active')
    const activeSettings = document.querySelector(
      '[data-tab="tab-settings"].is-active'
    )
    if (activeSettings) {
      document.querySelector('[data-tab="tab-swipe"]')?.click()
    }
  }
}

function collectPersonalMediaSourcesSetting() {
  const selectedSources = Array.from(
    document.querySelectorAll('[data-personal-media-source]:checked')
  )
    .map(input => input.value)
    .filter(Boolean)

  return JSON.stringify(selectedSources)
}

function hydratePersonalMediaSourcesSetting(rawValue) {
  let parsedSources = []

  if (typeof rawValue === 'string' && rawValue.trim()) {
    try {
      const parsed = JSON.parse(rawValue)
      if (Array.isArray(parsed)) {
        parsedSources = parsed.map(value => String(value).toLowerCase())
      }
    } catch {
      parsedSources = []
    }
  }

  document.querySelectorAll('[data-personal-media-source]').forEach(input => {
    input.checked = parsedSources.includes(input.value)
  })

  const hiddenInput = document.getElementById('setting-personal-media-sources')
  if (hiddenInput) {
    hiddenInput.value = JSON.stringify(parsedSources)
  }

  const summary = document.getElementById(
    'setting-personal-media-sources-summary'
  )
  if (summary) {
    summary.textContent =
      parsedSources.length > 0
        ? `${parsedSources.length} source${
            parsedSources.length === 1 ? '' : 's'
          } selected`
        : 'Select Sources'
  }

  window.PERSONAL_MEDIA_SOURCES = JSON.stringify(parsedSources)
  updateHostManagedSubscriptionServiceOptions()
  updatePersonalMediaSourceConfigVisibility(parsedSources)
}

function updatePersonalMediaSourceConfigVisibility(selectedSources = []) {
  const selected = new Set(
    Array.isArray(selectedSources)
      ? selectedSources.map(value => String(value).toLowerCase())
      : []
  )

  document.querySelectorAll('[data-personal-media-config]').forEach(section => {
    const source = String(
      section.dataset.personalMediaConfig || ''
    ).toLowerCase()
    const shouldShow = source ? selected.has(source) : false
    section.toggleAttribute('hidden', !shouldShow)
  })

  document
    .querySelectorAll('[data-required-when-source-selected]')
    .forEach(field => {
      const requiredSource = String(
        field.dataset.requiredWhenSourceSelected || ''
      ).toLowerCase()
      const isRequired = selected.has(requiredSource)
      field.required = isRequired
      field.setAttribute('aria-required', isRequired ? 'true' : 'false')
    })

  // Keep advanced visibility in sync when sections are dynamically revealed.
  applyAdvancedSettingsVisibility()
}

function applyAdvancedSettingsVisibility(forceValue) {
  const toggle = document.getElementById('settings-show-advanced')
  const shouldShow =
    typeof forceValue === 'boolean'
      ? forceValue
      : Boolean(toggle && toggle.getAttribute('aria-pressed') === 'true')

  document.querySelectorAll('[data-advanced-setting]').forEach(field => {
    field.toggleAttribute('hidden', !shouldShow)
  })

  return shouldShow
}

function updateAdvancedSettingsToggleVisibility() {
  const toolbar = document.querySelector('#settings-controls .settings-toolbar')
  const toggle = document.getElementById('settings-show-advanced')
  if (!toolbar || !toggle) return

  const activeSection = document.querySelector(
    '.settings-section:not([hidden])'
  )
  const hasAdvancedSettings = Boolean(
    activeSection?.querySelector('[data-advanced-setting]')
  )

  toolbar.toggleAttribute('hidden', !hasAdvancedSettings)
}

function parseArraySetting(rawValue) {
  if (Array.isArray(rawValue)) {
    return rawValue
      .map(entry => String(entry).trim().toLowerCase())
      .filter(Boolean)
  }

  const trimmed = String(rawValue || '').trim()
  if (!trimmed) return []

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) {
        return parsed
          .map(entry => String(entry).trim().toLowerCase())
          .filter(Boolean)
      }
    } catch {
      return []
    }
  }

  // Backward compatibility for pre-upgrade CSV storage.
  return trimmed
    .split(',')
    .map(entry => entry.trim().toLowerCase())
    .filter(Boolean)
}

function collectPaidStreamingServicesSetting() {
  const selected = Array.from(
    document.querySelectorAll('[data-paid-streaming-service]:checked')
  )
    .map(input => input.value)
    .filter(Boolean)

  return JSON.stringify(selected)
}

function hydratePaidStreamingServicesSetting(rawValue) {
  const selectedValues = parseArraySetting(rawValue)
  const selectedSet = new Set(selectedValues)

  document.querySelectorAll('[data-paid-streaming-service]').forEach(input => {
    input.checked = selectedSet.has(input.value)
  })

  const hiddenInput = document.getElementById('setting-paid-streaming-services')
  if (hiddenInput) {
    hiddenInput.value = JSON.stringify(selectedValues)
  }

  const summary = document.getElementById(
    'setting-paid-streaming-services-summary'
  )
  if (summary) {
    summary.textContent =
      selectedValues.length > 0
        ? `${selectedValues.length} service${
            selectedValues.length === 1 ? '' : 's'
          } selected`
        : 'Select Subscriptions'
  }
}

function initializePersonalMediaSourcesControl() {
  const toggle = document.getElementById(
    'setting-personal-media-sources-toggle'
  )
  const list = document.getElementById('setting-personal-media-sources-list')

  const closeDropdown = () => {
    toggle?.classList.remove('open')
    list?.classList.remove('active')
    toggle?.setAttribute('aria-expanded', 'false')
  }

  const updateSelection = () => {
    const selectedRaw = collectPersonalMediaSourcesSetting()
    hydratePersonalMediaSourcesSetting(selectedRaw)
  }

  if (toggle && list && toggle.dataset.boundPersonalMediaToggle !== 'true') {
    toggle.addEventListener('click', e => {
      e.stopPropagation()
      const isOpen = list.classList.contains('active')
      if (isOpen) {
        closeDropdown()
      } else {
        toggle.classList.add('open')
        list.classList.add('active')
        toggle.setAttribute('aria-expanded', 'true')
      }
    })
    toggle.dataset.boundPersonalMediaToggle = 'true'
  }

  if (list && list.dataset.boundPersonalMediaList !== 'true') {
    list.addEventListener('click', e => e.stopPropagation())
    list.dataset.boundPersonalMediaList = 'true'
  }

  if (document.body.dataset.boundPersonalMediaOutside !== 'true') {
    document.addEventListener('click', e => {
      if (
        !e.target.closest('#setting-personal-media-sources-toggle') &&
        !e.target.closest('#setting-personal-media-sources-list')
      ) {
        closeDropdown()
      }
    })
    document.body.dataset.boundPersonalMediaOutside = 'true'
  }

  document.querySelectorAll('[data-personal-media-source]').forEach(input => {
    if (input.dataset.boundPersonalMediaChange === 'true') {
      return
    }
    input.addEventListener('change', updateSelection)
    input.dataset.boundPersonalMediaChange = 'true'
  })
}

function validateConditionalPersonalMediaSettings() {
  const selectedSources = Array.from(
    document.querySelectorAll('[data-personal-media-source]:checked')
  ).map(input => String(input.value || '').toLowerCase())

  const selectedSet = new Set(selectedSources)
  const requiredFields = Array.from(
    document.querySelectorAll('[data-required-when-source-selected]')
  )

  for (const field of requiredFields) {
    const requiredSource = String(
      field.dataset.requiredWhenSourceSelected || ''
    ).toLowerCase()
    if (!selectedSet.has(requiredSource)) {
      field.setCustomValidity('')
      continue
    }

    const value = String(field.value || '').trim()
    if (!value) {
      field.setCustomValidity(
        `This field is required when ${requiredSource} is selected.`
      )
      field.reportValidity()
      return false
    }

    field.setCustomValidity('')
  }

  return true
}

function initializePaidStreamingServicesControl() {
  const toggle = document.getElementById(
    'setting-paid-streaming-services-toggle'
  )
  const list = document.getElementById('setting-paid-streaming-services-list')

  const closeDropdown = () => {
    toggle?.classList.remove('open')
    list?.classList.remove('active')
    toggle?.setAttribute('aria-expanded', 'false')
  }

  const updateSelection = () => {
    const selectedCsv = collectPaidStreamingServicesSetting()
    hydratePaidStreamingServicesSetting(selectedCsv)
  }

  if (toggle && list && toggle.dataset.boundPaidStreamingToggle !== 'true') {
    toggle.addEventListener('click', e => {
      e.stopPropagation()
      const isOpen = list.classList.contains('active')
      if (isOpen) {
        closeDropdown()
      } else {
        toggle.classList.add('open')
        list.classList.add('active')
        toggle.setAttribute('aria-expanded', 'true')
      }
    })
    toggle.dataset.boundPaidStreamingToggle = 'true'
  }

  if (list && list.dataset.boundPaidStreamingList !== 'true') {
    list.addEventListener('click', e => e.stopPropagation())
    list.dataset.boundPaidStreamingList = 'true'
  }

  if (document.body.dataset.boundPaidStreamingOutside !== 'true') {
    document.addEventListener('click', e => {
      if (
        !e.target.closest('#setting-paid-streaming-services-toggle') &&
        !e.target.closest('#setting-paid-streaming-services-list')
      ) {
        closeDropdown()
      }
    })
    document.body.dataset.boundPaidStreamingOutside = 'true'
  }

  document.querySelectorAll('[data-paid-streaming-service]').forEach(input => {
    if (input.dataset.boundPaidStreamingChange === 'true') {
      return
    }
    input.addEventListener('change', updateSelection)
    input.dataset.boundPaidStreamingChange = 'true'
  })
}

function initializeAdvancedSettingsToggle() {
  const toggle = document.getElementById('settings-show-advanced')
  if (!toggle || toggle.dataset.boundAdvancedToggle === 'true') return

  const stored = localStorage.getItem('settingsShowAdvanced')
  const shouldShow = stored === 'true'

  toggle.setAttribute('aria-pressed', shouldShow ? 'true' : 'false')
  toggle.textContent = shouldShow ? 'Advanced' : 'Basic'
  applyAdvancedSettingsVisibility(shouldShow)

  toggle.addEventListener('click', () => {
    const enabled = toggle.getAttribute('aria-pressed') !== 'true'
    toggle.setAttribute('aria-pressed', enabled ? 'true' : 'false')
    toggle.textContent = enabled ? 'Advanced' : 'Basic'
    localStorage.setItem('settingsShowAdvanced', enabled ? 'true' : 'false')
    applyAdvancedSettingsVisibility(enabled)
  })

  toggle.dataset.boundAdvancedToggle = 'true'
}

function isValidUrl(value) {
  try {
    new URL(String(value || '').trim())
    return true
  } catch {
    return false
  }
}

function initializeIntegrationTestButtons() {
  const mappings = {
    plex: { url: 'setting-plex-url', key: 'setting-plex-token' },
    emby: { url: 'setting-emby-url', key: 'setting-emby-api-key' },
    jellyfin: {
      url: 'setting-jellyfin-url',
      key: 'setting-jellyfin-api-key',
    },
    radarr: { url: 'setting-radarr-url', key: 'setting-radarr-api-key' },
    seerr: {
      url: 'setting-seerr-url',
      key: 'setting-seerr-api-key',
    },
    tmdb: { key: 'setting-tmdb-key' },
  }

  const targetLabels = {
    plex: 'Plex',
    emby: 'Emby',
    jellyfin: 'Jellyfin',
    radarr: 'Radarr',
    seerr: 'Seerr',
    tmdb: 'TMDB',
  }

  document.querySelectorAll('[data-test-target]').forEach(button => {
    if (button.dataset.boundTestButton === 'true') return

    button.addEventListener('click', () => {
      const target = button.dataset.testTarget
      const config = mappings[target]
      if (!config) return
      const targetLabel = targetLabels[target] || target

      clearSettingsStatusAfterDelay()

      const urlValue = config.url
        ? document.getElementById(config.url)?.value || ''
        : ''
      const keyValue = document.getElementById(config.key)?.value || ''

      if (config.url && !isValidUrl(urlValue)) {
        setSettingsStatus(
          `⚠️ ${targetLabel} URL looks invalid. Please check and try again.`
        )
        return
      }

      if (!String(keyValue).trim()) {
        setSettingsStatus(`⚠️ ${targetLabel} API key/token is empty.`)
        return
      }

      setSettingsStatus(`Testing ${targetLabel} connection...`)

      fetch('/api/settings-test', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...getAdminHeaders() },
        body: JSON.stringify({
          target,
          url: urlValue,
          token: keyValue,
        }),
      })
        .then(async res => {
          const data = await res
            .json()
            .catch(() => ({ ok: false, message: '' }))

          if (res.ok && data?.ok) {
            setSettingsStatus(`✅ ${targetLabel} connection successful.`)
            clearSettingsStatusAfterDelay(5000)
            return
          }

          if (res.status === 403) {
            const message = parseApiErrorMessage(
              data,
              'Admin authorization is required for integration connection tests.'
            )
            clearCachedAdminPassword()
            hasAdminSettingsAccess = false
            updateAdminOnlySettingsVisibility()
            setSettingsStatus(
              `⚠️ ${targetLabel} connection test blocked by admin auth: ${message}`
            )
            clearSettingsStatusAfterDelay(7000)
            return
          }

          const message = parseApiErrorMessage(
            data,
            `Connection failed (${res.status}).`
          )
          setSettingsStatus(
            `⚠️ ${targetLabel} connection test failed: ${message}`
          )
          clearSettingsStatusAfterDelay(7000)
        })
        .catch(err => {
          setSettingsStatus(
            `⚠️ ${targetLabel} connection test failed: ${err?.message || err}`
          )
          clearSettingsStatusAfterDelay(7000)
        })
    })

    button.dataset.boundTestButton = 'true'
  })
}

function getAdminSelectedRequestServiceType() {
  const selected = document.querySelector(
    'input[name="admin-request-service-type"]:checked'
  )
  return selected?.value || 'seerr'
}

function setAdminSelectedRequestServiceType(type) {
  const normalizedType = type === 'seerr' ? 'seerr' : 'seerr'
  const radio = document.querySelector(
    `input[name="admin-request-service-type"][value="${normalizedType}"]`
  )
  if (radio) radio.checked = true
}

function inferRequestServiceTypeFromSettingsValues() {
  const hasSeerr = Boolean(
    document.getElementById('setting-seerr-url')?.value?.trim() &&
      document.getElementById('setting-seerr-api-key')?.value?.trim()
  )

  if (hasSeerr) return 'seerr'
  return 'seerr'
}

function normalizeRequestServiceSettingsForSelection(settings) {
  // Only Seerr is supported — nothing to normalize
}

function collectSettingsForm() {
  const settings = {}
  document.querySelectorAll('[data-setting-key]').forEach(el => {
    const key = el.dataset.settingKey
    if (!key) return

    if (el.closest('[data-admin-section]') && !hasAdminSettingsAccess) return
    if (key === 'PAID_STREAMING_SERVICES') {
      settings[key] = collectPaidStreamingServicesSetting()
      return
    }
    if (el.type === 'checkbox') {
      settings[key] = el.checked ? 'true' : 'false'
      return
    }
    if (el.multiple) {
      settings[key] = Array.from(el.selectedOptions)
        .map(option => option.value)
        .join(',')
      return
    }
    settings[key] = el.value
  })

  if (hasAdminSettingsAccess) {
    settings.PERSONAL_MEDIA_SOURCES = collectPersonalMediaSourcesSetting()
  }

  return settings
}

async function hydrateSettingsForm({ _retryCount = 0 } = {}) {
  const MAX_RETRIES = 1
  try {
    const res = await fetch('/api/settings', {
      headers: { ...getAdminHeaders() },
    })
    if (res.status === 401) {
      return false
    }
    if (!res.ok) {
      throw new Error(`Settings fetch failed: ${res.status}`)
    }
    const data = await res.json()
    const settings = data?.settings || {}

    console.debug(
      '[admin-auth] hydrateSettingsForm: isAdmin=',
      data?.isAdmin,
      'hasAdminSettingsAccess=',
      hasAdminSettingsAccess,
      'retryCount=',
      _retryCount
    )

    // If the server says admin auth failed but the frontend believes it has
    // admin access, clear the access flag and require a fresh entry through the
    // regular access guard.
    if (
      data?.isAdmin === false &&
      hasAdminSettingsAccess &&
      _retryCount < MAX_RETRIES
    ) {
      clearCachedAdminPassword()
      hasAdminSettingsAccess = false
      settingsHydratedWithAdminAccess = false
      updateAdminOnlySettingsVisibility()
      return false
    }

    document.querySelectorAll('[data-setting-key]').forEach(el => {
      const key = el.dataset.settingKey
      if (!key) return
      const value = settings[key]
      if (value === undefined || value === null) return
      if (key === 'PAID_STREAMING_SERVICES') {
        hydratePaidStreamingServicesSetting(value)
      } else if (el.type === 'checkbox') {
        el.checked = value === 'true'
      } else if (el.multiple) {
        const selectedValues = String(value)
          .split(',')
          .map(entry => entry.trim().toLowerCase())
          .filter(Boolean)
        const selectedSet = new Set(selectedValues)
        Array.from(el.options).forEach(option => {
          option.selected = selectedSet.has(option.value)
        })
      } else {
        el.value = value
        // ACCESS_PASSWORD is redacted to '' by the server (the hash is never
        // sent to the client). When a password is already set, show a helpful
        // placeholder so the field doesn't appear empty/unconfigured.
        if (key === 'ACCESS_PASSWORD' && !String(value).trim()) {
          el.placeholder = window.ACCESS_PASSWORD_SET
            ? '(configured — enter new password to change)'
            : '(optional)'
        }
      }
    })

    hydratePaidStreamingServicesSetting(settings.PAID_STREAMING_SERVICES)

    let personalMediaSources = settings.PERSONAL_MEDIA_SOURCES
    if (!personalMediaSources || personalMediaSources === '[]') {
      const autoSources = []
      if (settings.PLEX_URL && settings.PLEX_TOKEN) autoSources.push('plex')
      if (settings.EMBY_URL && settings.EMBY_API_KEY) autoSources.push('emby')
      if (settings.JELLYFIN_URL && settings.JELLYFIN_API_KEY)
        autoSources.push('jellyfin')
      if (autoSources.length > 0)
        personalMediaSources = JSON.stringify(autoSources)
    }
    hydratePersonalMediaSourcesSetting(personalMediaSources)
    setAdminSelectedRequestServiceType(
      inferRequestServiceTypeFromSettingsValues()
    )
    setSettingsDirty(false)
    clearSettingsStatusAfterDelay()
    return data?.isAdmin === true
  } catch (err) {
    if (err?.message && String(err.message).includes('403')) {
      clearCachedAdminPassword()
      hasAdminSettingsAccess = false
      updateAdminOnlySettingsVisibility()
      setSettingsStatus('Admin access was rejected. Please try again.')
    }
    console.warn('Failed to hydrate settings form:', err)
    return false
  }
}

async function saveSettingsForm() {
  setSettingsStatus('Saving settings...')
  try {
    if (!validateConditionalPersonalMediaSettings()) {
      setSettingsStatus(
        'Please fill all required fields for selected personal media sources.'
      )
      return
    }

    const settings = collectSettingsForm()
    normalizeRequestServiceSettingsForSelection(settings)
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...getAdminHeaders() },
      body: JSON.stringify({ settings }),
    })
    if (!res.ok) {
      let serverError = `Settings save failed: ${res.status}`
      try {
        const errorData = await res.json()
        if (errorData?.details && typeof errorData.details === 'object') {
          const details = Object.entries(errorData.details)
            .map(([key, message]) => `${key}: ${message}`)
            .join(' | ')
          serverError = details || serverError
        } else {
          serverError = parseApiErrorMessage(errorData, serverError)
        }
      } catch {
        // ignore parse errors and use fallback message
      }

      if (res.status === 403) {
        clearCachedAdminPassword()
        hasAdminSettingsAccess = false
        updateAdminOnlySettingsVisibility()
      }

      throw new Error(serverError)
    }
    const data = await res.json()
    if (data?.settings?.PLEX_LIBRARY_NAME) {
      window.PLEX_LIBRARY_NAME = data.settings.PLEX_LIBRARY_NAME
    }
    if (data?.settings?.PAID_STREAMING_SERVICES !== undefined) {
      window.PAID_STREAMING_SERVICES = data.settings.PAID_STREAMING_SERVICES
    }
    if (data?.settings?.PERSONAL_MEDIA_SOURCES !== undefined) {
      window.PERSONAL_MEDIA_SOURCES = data.settings.PERSONAL_MEDIA_SOURCES
    }
    await loadClientConfig()
    document.dispatchEvent(new CustomEvent('comparr:source-config-updated'))
    updateHostManagedSubscriptionServiceOptions()
    updateSwipeAvailabilityUI()
    setSettingsStatus(
      'Settings saved. Caches are refreshing in the background.'
    )
    pulseSettingsStatus('success')
    clearSettingsStatusAfterDelay(5000)
    setSettingsDirty(false)
  } catch (err) {
    console.error('Failed to save settings:', err)
    setSettingsStatus(
      `Failed to save settings: ${err?.message || 'Unknown error.'}`
    )
    pulseSettingsStatus('error')
  }
}

let settingsUiHydrated = false
let settingsHydratedWithAdminAccess = false

function hasConfiguredPersonalMediaSource() {
  return Boolean(
    window.PLEX_CONFIGURED ||
      window.EMBY_CONFIGURED ||
      window.JELLYFIN_CONFIGURED
  )
}

function hasConfiguredMovieSource() {
  return hasConfiguredPersonalMediaSource() || Boolean(window.TMDB_CONFIGURED)
}

function createFirstRunGuideModal() {
  const existing = document.getElementById('first-run-guide-modal')
  if (existing) return existing

  const modal = document.createElement('section')
  modal.id = 'first-run-guide-modal'
  modal.className = 'first-run-guide-modal'
  modal.innerHTML = `
    <div class="first-run-guide-card" role="dialog" aria-modal="true" aria-labelledby="first-run-guide-title">
      <h2 id="first-run-guide-title">Hi, there 👋</h2>
      <p class="first-run-guide-copy" id="first-run-guide-copy">What movies do you want to swipe through?</p>
      <div class="first-run-guide-body" id="first-run-guide-body"></div>
      <p id="first-run-guide-requirements" class="first-run-guide-requirements"></p>
      <p id="first-run-guide-status" class="first-run-guide-status"></p>
      <div class="first-run-guide-actions">
        <button type="button" class="submit-button first-run-guide-secondary" id="first-run-back" hidden>Back</button>
        <button type="button" class="submit-button first-run-guide-secondary" id="first-run-skip" hidden>Skip</button>
        <button type="button" class="submit-button" id="first-run-save" hidden>Save</button>
        <button type="button" class="submit-button" id="first-run-next">Next</button>
      </div>
    </div>
  `

  document.body.appendChild(modal)

  const body = modal.querySelector('#first-run-guide-body')
  const title = modal.querySelector('#first-run-guide-title')
  const copy = modal.querySelector('#first-run-guide-copy')
  const requirements = modal.querySelector('#first-run-guide-requirements')
  const status = modal.querySelector('#first-run-guide-status')
  const backButton = modal.querySelector('#first-run-back')
  const skipButton = modal.querySelector('#first-run-skip')
  const saveButton = modal.querySelector('#first-run-save')
  const nextButton = modal.querySelector('#first-run-next')

  const tmdbRegistrationUrl = 'https://www.themoviedb.org/settings/api'
  const requirementCopyByFlow = {
    'personal-only':
      '*Requires at least one valid Plex, Emby, or Jellyfin connection. Optional: provide a TMDb API Key for additional movie metadata and an enhanced user experience.',
    'tmdb-only': `Requires a TMDb API Key. Get your free API Key <a href="${tmdbRegistrationUrl}" target="_blank" rel="noopener noreferrer">here</a>.`,
    combined: `*Requires at least one valid Plex, Emby, or Jellyfin connection and a TMDb API Key. Get your free API Key <a href="${tmdbRegistrationUrl}" target="_blank" rel="noopener noreferrer">here</a>.`,
  }
  const tmdbOnlyRegistrationCopy = `Get your free API Key <a href="${tmdbRegistrationUrl}" target="_blank" rel="noopener noreferrer">here</a>.`

  const flowOptionsMarkup = `
    <div class="first-run-guide-options">
      <button type="button" class="first-run-guide-option" data-flow="tmdb-only">
        <strong>My Paid / Free Streaming Subscriptions Only.</strong>
      </button>
      <button type="button" class="first-run-guide-option" data-flow="personal-only">
        <strong>My Plex, Emby, and/or Jellyfin Libraries Only.*</strong>
      </button>
      <button type="button" class="first-run-guide-option" data-flow="combined">
        <strong>My Plex, Emby, and/or Jellyfin Libraries + My Paid / Free Streaming Subscriptions.*</strong>
      </button>
    </div>
  `

  const selectedState = {
    flow: '',
    security: {
      accessPassword: '',
    },
    sources: [],
    subscriptions: [],
    validatedTargets: {},
    requestServices: {
      requestServiceType: 'seerr',
      radarrUrl: '',
      radarrApiKey: '',
      seerrUrl: '',
      seerrApiKey: '',
    },
    defaultsLastSavedSnapshot: '',
    adminLoggedIn: false,
    adminLoginUser: null,
  }
  const history = []
  const WIZARD_PROGRESS_STORAGE_KEY = 'comparr-wizard-progress-v1'

  const persistWizardProgress = () => {
    try {
      sessionStorage.setItem(
        WIZARD_PROGRESS_STORAGE_KEY,
        JSON.stringify({ history, selectedState })
      )
    } catch {
      // ignore storage errors
    }
  }

  const clearWizardProgress = () => {
    try {
      sessionStorage.removeItem(WIZARD_PROGRESS_STORAGE_KEY)
    } catch {
      // ignore storage errors
    }
  }

  const restoreWizardProgress = () => {
    try {
      const raw = sessionStorage.getItem(WIZARD_PROGRESS_STORAGE_KEY)
      if (!raw) return false
      const parsed = JSON.parse(raw)
      const restoredHistory = Array.isArray(parsed?.history)
        ? parsed.history
        : []
      const restoredState =
        parsed?.selectedState && typeof parsed.selectedState === 'object'
          ? parsed.selectedState
          : null
      if (!restoredHistory.length || !restoredState) return false
      history.splice(0, history.length, ...restoredHistory)
      Object.assign(selectedState, restoredState)
      return true
    } catch {
      return false
    }
  }

  const requestFieldIds = {
    requestServiceType: 'first-run-request-service-type',
    radarrUrl: 'first-run-radarr-url',
    radarrApiKey: 'first-run-radarr-api-key',
    seerrUrl: 'first-run-seerr-url',
    seerrApiKey: 'first-run-seerr-api-key',
  }

  const setWizardStatus = (message = '', tone = 'info') => {
    if (!status) return
    status.textContent = message
    status.dataset.tone = message ? tone : ''
  }

  const renderRequirementCopy = flow => {
    if (!requirements) return
    if (!flow || !requirementCopyByFlow[flow]) {
      requirements.innerHTML = ''
      requirements.hidden = true
      return
    }
    requirements.innerHTML =
      requirementCopyByFlow[flow] || requirementCopyByFlow['personal-only']
    requirements.hidden = false
  }

  const syncInputValue = (inputId, value) => {
    const input = document.getElementById(inputId)
    if (input) {
      input.value = value
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }
  }

  const saveSettingsSubset = async updates => {
    const apiBase = document.body.dataset.basePath || ''
    const headers = {
      'content-type': 'application/json',
      ...getAdminHeaders(),
    }

    const res = await fetch(`${apiBase}/api/settings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ settings: updates }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(parseApiErrorMessage(data, 'Failed to save settings.'))
    }
  }

  const runConnectionTest = async (target, url, token) => {
    const apiBase = document.body.dataset.basePath || ''
    const res = await fetch(`${apiBase}/api/settings-test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...getAdminHeaders() },
      body: JSON.stringify({ target, url, token }),
    })
    const data = await res.json().catch(() => ({ ok: false }))
    if (!res.ok || !data?.ok) {
      throw new Error(data?.message || `Failed to connect to ${target}.`)
    }
  }

  const serviceMeta = {
    plex: {
      label: 'Plex',
      requiredLabel: 'Plex URL and Plex token are required.',
      settings: { url: 'PLEX_URL', token: 'PLEX_TOKEN' },
      inputIds: { url: 'setting-plex-url', token: 'setting-plex-token' },
    },
    emby: {
      label: 'Emby',
      requiredLabel: 'Emby URL and Emby API key are required.',
      settings: { url: 'EMBY_URL', token: 'EMBY_API_KEY' },
      inputIds: { url: 'setting-emby-url', token: 'setting-emby-api-key' },
    },
    jellyfin: {
      label: 'Jellyfin',
      requiredLabel: 'Jellyfin URL and Jellyfin API key are required.',
      settings: { url: 'JELLYFIN_URL', token: 'JELLYFIN_API_KEY' },
      inputIds: {
        url: 'setting-jellyfin-url',
        token: 'setting-jellyfin-api-key',
      },
    },
  }

  const setSelectedFlow = flow => {
    selectedState.flow = flow
    body
      ?.querySelectorAll('.first-run-guide-option')
      .forEach(btn =>
        btn.classList.toggle('is-selected', btn.dataset.flow === flow)
      )
    renderRequirementCopy(flow)
    setWizardStatus('')
  }

  const updateActionButtons = screen => {
    backButton.hidden = history.length <= 1 || screen.type === 'setup-complete'
    skipButton.hidden = !['security', 'user-auth', 'requests'].includes(
      screen.type
    )
    saveButton.hidden = screen.type !== 'defaults'
    nextButton.disabled =
      screen.type === 'admin-login' && !selectedState.adminLoggedIn
    skipButton.disabled = false
    if (screen.type === 'setup-complete') {
      nextButton.textContent = 'Start Swiping'
    } else if (screen.type === 'defaults') {
      nextButton.textContent = 'Finish'
    } else {
      nextButton.textContent = 'Next'
    }
  }

  const withButtonLoading = async (button, label, action) => {
    if (!button) return action()
    if (button.dataset.loading === 'true') return null
    const originalHtml = button.innerHTML
    const wasDisabled = button.disabled
    button.dataset.loading = 'true'
    button.disabled = true
    button.classList.add('is-loading')
    button.innerHTML = `<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> ${label}`

    try {
      return await action()
    } finally {
      button.dataset.loading = 'false'
      button.classList.remove('is-loading')
      button.innerHTML = originalHtml
      button.disabled = wasDisabled
    }
  }

  const persistRequestInputs = () => {
    Object.entries(requestFieldIds).forEach(([key, id]) => {
      if (key === 'requestServiceType') {
        selectedState.requestServices[key] = 'seerr'
        return
      }
      selectedState.requestServices[key] =
        body.querySelector(`#${id}`)?.value?.trim() || ''
    })
  }

  const hasAnyRequestInput = () =>
    Object.entries(selectedState.requestServices).some(
      ([key, value]) => key !== 'requestServiceType' && Boolean(value)
    )

  const getCurrentDefaultsSnapshot = () =>
    JSON.stringify(normalizeFilterStateForDefaults(window.filterState))

  const hasUnsavedDefaultsChanges = () => {
    if (swipeFilterMode !== 'defaults' || !window.filterState) return false
    return (
      getCurrentDefaultsSnapshot() !== selectedState.defaultsLastSavedSnapshot
    )
  }

  const promptDefaultsUnsavedChanges = () =>
    new Promise(resolve => {
      const overlay = document.createElement('div')
      overlay.className = 'first-run-guide-confirm-overlay'
      overlay.innerHTML = `
        <div class="first-run-guide-confirm-card" role="dialog" aria-modal="true">
          <p>Defaults selections were not saved.</p>
          <div class="first-run-guide-actions">
            <button type="button" class="submit-button first-run-guide-secondary" data-action="cancel">Cancel</button>
            <button type="button" class="submit-button" data-action="continue">Continue Anyways</button>
          </div>
        </div>
      `
      overlay
        .querySelector('[data-action="cancel"]')
        ?.addEventListener('click', () => {
          overlay.remove()
          resolve(false)
        })
      overlay
        .querySelector('[data-action="continue"]')
        ?.addEventListener('click', () => {
          overlay.remove()
          resolve(true)
        })
      modal.appendChild(overlay)
    })

  const enterDefaultsInWizard = () => {
    body.innerHTML = '<div id="first-run-defaults-inline-editor"></div>'
    const container = body.querySelector('#first-run-defaults-inline-editor')
    if (!swipeFilterModal || !container) return

    swipeFilterMode = 'defaults'
    liveSwipeFilterStateRef = window.filterState
    const baseState =
      loadSavedSwipeFilterDefaults() ||
      normalizeFilterStateForDefaults(liveSwipeFilterStateRef)
    window.filterState = cloneFilterStateValue(baseState)

    container.appendChild(swipeFilterModal)
    swipeFilterModal.classList.add('active', 'inline-defaults-mode')
    swipeFilterOverlay?.classList.remove('active')
    updateSwipeFilterModalModeUI()
    syncSwipeFilterModalWithState()

    selectedState.defaultsLastSavedSnapshot = getCurrentDefaultsSnapshot()
  }

  const leaveDefaultsEditor = () => {
    if (swipeFilterMode !== 'defaults') return
    if (liveSwipeFilterStateRef) {
      window.filterState = liveSwipeFilterStateRef
      liveSwipeFilterStateRef = null
    }
    swipeFilterMode = 'live'
    updateSwipeFilterModalModeUI()
    exitDefaultsInlineEditor()
  }

  const saveDefaultsFromWizard = () => {
    if (swipeFilterMode !== 'defaults' || !window.filterState) {
      enterDefaultsInWizard()
    }
    if (swipeFilterMode !== 'defaults' || !window.filterState) {
      setWizardStatus(
        'Defaults editor is not ready yet. Please try again.',
        'error'
      )
      return false
    }
    const normalized = normalizeFilterStateForDefaults(window.filterState)
    if (!normalized) {
      setWizardStatus(
        'Could not save defaults. Please review your filters.',
        'error'
      )
      return false
    }
    const snapshot = JSON.stringify(normalized)
    localStorage.setItem(SWIPE_DEFAULTS_STORAGE_KEY, snapshot)
    selectedState.defaultsLastSavedSnapshot = snapshot
    document.dispatchEvent(
      new CustomEvent('comparr:wizard-defaults-saved', { detail: { snapshot } })
    )
    setWizardStatus('✅ Default filters saved.', 'success')
    return true
  }

  const renderScreen = screen => {
    if (!body || !copy || !title) return
    persistWizardProgress()
    setWizardStatus('')
    updateActionButtons(screen)

    if (screen.type === 'security') {
      renderRequirementCopy('')
      title.textContent = 'Security Settings'
      copy.textContent = ''

      const existingAccessPassword =
        selectedState.security.accessPassword ||
        document.getElementById('setting-access-password')?.value ||
        ''
      const accessPasswordAlreadySet =
        Boolean(existingAccessPassword) || Boolean(window.ACCESS_PASSWORD_SET)
      // Access password section: show "configured" badge + Change toggle if
      // already set, otherwise show the input directly
      const accessSection = accessPasswordAlreadySet
        ? `<div class="first-run-password-configured" id="first-run-access-configured">
            <span class="first-run-password-status-badge"><i class="fas fa-check-circle" aria-hidden="true"></i> Configured</span>
            <button type="button" class="first-run-change-password-btn" id="first-run-access-change-btn">Change →</button>
          </div>
          <div id="first-run-access-input-wrap" hidden>
            <input id="first-run-access-password" class="first-run-guide-input" type="password" placeholder="New access password" autocomplete="new-password" />
          </div>`
        : `<input id="first-run-access-password" class="first-run-guide-input" type="password" placeholder="(optional)" autocomplete="new-password" />`

      body.innerHTML = `
        <label class="first-run-guide-field-label first-run-guide-security-label">Access Password</label>
        <p class="first-run-guide-instruction">Require a password for anyone to access your Comparr instance.</p>
        ${accessSection}
      `

      // Expand access password input on Change click
      body
        .querySelector('#first-run-access-change-btn')
        ?.addEventListener('click', () => {
          body.querySelector('#first-run-access-configured').hidden = true
          body.querySelector('#first-run-access-input-wrap').hidden = false
          body.querySelector('#first-run-access-password')?.focus()
          initializePasswordVisibilityToggles()
          updateSecurityActionState()
        })

      const updateSecurityActionState = () => {
        const accessPassword =
          body.querySelector('#first-run-access-password')?.value?.trim() || ''
        const hasTypedPassword = Boolean(accessPassword)
        const hasPassword = hasTypedPassword || accessPasswordAlreadySet
        nextButton.disabled = !hasPassword
        skipButton.disabled = hasTypedPassword
      }

      body
        .querySelector('#first-run-access-password')
        ?.addEventListener('input', updateSecurityActionState)
      initializePasswordVisibilityToggles()
      updateSecurityActionState()
      return
    }

    if (screen.type === 'flow') {
      title.textContent = 'Hi, there 👋'
      copy.textContent = 'What movies do you want to swipe through?'
      body.innerHTML = flowOptionsMarkup
      body.querySelectorAll('.first-run-guide-option').forEach(option => {
        option.addEventListener('click', () =>
          setSelectedFlow(option.dataset.flow || '')
        )
      })
      if (selectedState.flow) {
        setSelectedFlow(selectedState.flow)
      } else {
        renderRequirementCopy('')
      }
      return
    }

    if (screen.type === 'sources') {
      renderRequirementCopy('')
      title.textContent = 'Personal Media Sources'
      copy.textContent = 'Choose your personal media sources.'
      body.innerHTML = `
        <div class="first-run-guide-checkboxes">
          <label><input type="checkbox" value="plex" ${
            selectedState.sources.includes('plex') ? 'checked' : ''
          }/> Plex</label>
          <label><input type="checkbox" value="emby" ${
            selectedState.sources.includes('emby') ? 'checked' : ''
          }/> Emby</label>
          <label><input type="checkbox" value="jellyfin" ${
            selectedState.sources.includes('jellyfin') ? 'checked' : ''
          }/> Jellyfin</label>
        </div>
      `
      return
    }

    if (screen.type === 'service') {
      renderRequirementCopy('')
      const meta = serviceMeta[screen.target]
      if (!meta) return
      title.textContent = meta.label
      copy.textContent = ''
      body.innerHTML = `
        <label class="first-run-guide-field-label">${meta.label} URL</label>
        <input id="first-run-${
          screen.target
        }-url" class="first-run-guide-input" type="url" placeholder="http://localhost" value="${
        document.getElementById(meta.inputIds.url)?.value || ''
      }" />
        <label class="first-run-guide-field-label">${meta.label} ${
        screen.target === 'plex' ? 'Token' : 'API Key'
      }</label>
        <input id="first-run-${
          screen.target
        }-token" class="first-run-guide-input" type="text" value="${
        document.getElementById(meta.inputIds.token)?.value || ''
      }" />
        <button type="button" class="submit-button first-run-guide-test-button" id="first-run-test-${
          screen.target
        }">Test Connection</button>
      `
      body
        .querySelector(`#first-run-test-${screen.target}`)
        ?.addEventListener('click', async event => {
          const testButton = event.currentTarget
          await withButtonLoading(testButton, 'Testing...', async () => {
            const url =
              body.querySelector(`#first-run-${screen.target}-url`)?.value || ''
            const token =
              body.querySelector(`#first-run-${screen.target}-token`)?.value ||
              ''
            if (!isValidUrl(url) || !token.trim()) {
              setWizardStatus(meta.requiredLabel, 'error')
              return
            }
            try {
              setWizardStatus(`Testing ${meta.label} connection...`)
              await runConnectionTest(screen.target, url, token)
              selectedState.validatedTargets[screen.target] = true
              setWizardStatus(
                `✅ ${meta.label} connection successful.`,
                'success'
              )
            } catch (err) {
              selectedState.validatedTargets[screen.target] = false
              setWizardStatus(
                err?.message || `Failed to connect to ${meta.label}.`,
                'error'
              )
            }
          })
        })
      return
    }

    if (screen.type === 'tmdb') {
      renderRequirementCopy('')
      title.textContent = 'TMDb API Key'
      const isTmdbRequired = selectedState.flow !== 'personal-only'
      copy.innerHTML = isTmdbRequired
        ? tmdbOnlyRegistrationCopy
        : `Optional: ${tmdbOnlyRegistrationCopy}`
      body.innerHTML = `
        <label class="first-run-guide-field-label">TMDb API Key</label>
        <input id="first-run-tmdb-key" class="first-run-guide-input" type="text" value="${
          document.getElementById('setting-tmdb-key')?.value || ''
        }" />
        <button type="button" class="submit-button first-run-guide-test-button" id="first-run-test-tmdb">Test Connection</button>
      `
      body
        .querySelector('#first-run-test-tmdb')
        ?.addEventListener('click', async event => {
          const testButton = event.currentTarget
          await withButtonLoading(testButton, 'Testing...', async () => {
            const token = body.querySelector('#first-run-tmdb-key')?.value || ''
            if (!token.trim()) {
              setWizardStatus('TMDb API key is required.', 'error')
              return
            }
            try {
              setWizardStatus('Testing TMDb connection...')
              await runConnectionTest('tmdb', '', token)
              selectedState.validatedTargets.tmdb = true
              setWizardStatus('✅ TMDb connection successful.', 'success')
            } catch (err) {
              selectedState.validatedTargets.tmdb = false
              setWizardStatus(
                err?.message || 'Failed to connect to TMDb.',
                'error'
              )
            }
          })
        })
      return
    }

    if (screen.type === 'subscriptions') {
      renderRequirementCopy('')
      title.textContent = 'Subscription Services'
      copy.textContent = 'Choose the streaming subscriptions you have.'
      const subscriptionOptions = Array.from(
        document.querySelectorAll(
          '#setting-paid-streaming-services-list .settings-checkbox-option input[type="checkbox"][value]'
        )
      )
      const selectedSet = new Set(selectedState.subscriptions)
      body.innerHTML = `
        <div class="first-run-guide-checkboxes">
          ${subscriptionOptions
            .map(input => {
              const value = String(input.value || '').trim()
              if (!value) return ''
              const option = input.closest('.settings-checkbox-option')
              if (option?.dataset?.hostManagedPersonalService) return ''
              const labelText = option?.textContent?.trim() || value
              return `<label><input type="checkbox" value="${value}" data-first-run-paid-streaming-service="true" ${
                selectedSet.has(value) ? 'checked' : ''
              }/> ${labelText}</label>`
            })
            .join('')}
        </div>
      `
      return
    }

    if (screen.type === 'requests') {
      renderRequirementCopy('')
      title.textContent = 'Movie Requests (optional)'
      copy.textContent =
        'Integrate Radarr and Seerr to enable movie requests for titles not in your media sources.'
      body.innerHTML = `
        <label class="first-run-guide-field-label">Radarr URL</label>
        <input id="${requestFieldIds.radarrUrl}" class="first-run-guide-input" type="url" placeholder="http://localhost" value="${selectedState.requestServices.radarrUrl}" />
        <label class="first-run-guide-field-label">Radarr API Key</label>
        <input id="${requestFieldIds.radarrApiKey}" class="first-run-guide-input" type="text" value="${selectedState.requestServices.radarrApiKey}" />
        <button type="button" class="submit-button first-run-guide-test-button" id="first-run-test-radarr">Test Radarr Connection</button>
        <label class="first-run-guide-field-label">Seerr URL</label>
        <input id="${requestFieldIds.seerrUrl}" class="first-run-guide-input" type="url" placeholder="http://localhost" value="${selectedState.requestServices.seerrUrl}" />
        <label class="first-run-guide-field-label">Seerr API Key</label>
        <input id="${requestFieldIds.seerrApiKey}" class="first-run-guide-input" type="text" value="${selectedState.requestServices.seerrApiKey}" />
        <button type="button" class="submit-button first-run-guide-test-button" id="first-run-test-seerr">Test Seerr Connection</button>
      `
      body
        .querySelector('#first-run-test-radarr')
        ?.addEventListener('click', async event => {
          const testButton = event.currentTarget
          await withButtonLoading(testButton, 'Testing...', async () => {
            const url =
              body.querySelector(`#${requestFieldIds.radarrUrl}`)?.value || ''
            const token =
              body.querySelector(`#${requestFieldIds.radarrApiKey}`)?.value ||
              ''
            if (!isValidUrl(url) || !token.trim()) {
              setWizardStatus('Radarr URL and API Key are required.', 'error')
              return
            }
            try {
              setWizardStatus('Testing Radarr connection...')
              await runConnectionTest('radarr', url, token)
              setWizardStatus('✅ Radarr connection successful.', 'success')
            } catch (err) {
              setWizardStatus(
                err?.message || 'Failed to connect to Radarr.',
                'error'
              )
            }
          })
        })
      body
        .querySelector('#first-run-test-seerr')
        ?.addEventListener('click', async event => {
          const testButton = event.currentTarget
          await withButtonLoading(testButton, 'Testing...', async () => {
            const url =
              body.querySelector(`#${requestFieldIds.seerrUrl}`)?.value || ''
            const token =
              body.querySelector(`#${requestFieldIds.seerrApiKey}`)?.value || ''
            if (!isValidUrl(url) || !token.trim()) {
              setWizardStatus('Seerr URL and API Key are required.', 'error')
              return
            }
            try {
              setWizardStatus('Testing Seerr connection...')
              await runConnectionTest('seerr', url, token)
              setWizardStatus('✅ Seerr connection successful.', 'success')
            } catch (err) {
              setWizardStatus(
                err?.message || 'Failed to connect to Seerr.',
                'error'
              )
            }
          })
        })
      return
    }

    if (screen.type === 'defaults') {
      renderRequirementCopy('')
      title.textContent = 'Default Filters (optional)'
      copy.textContent =
        'Set default filters for the movies shown in your swipe screen.'
      enterDefaultsInWizard()
      return
    }

    if (screen.type === 'user-auth') {
      renderRequirementCopy('')
      title.textContent = 'User Authentication'
      copy.textContent =
        "Let users sign in with their Plex, Jellyfin, or Emby account. Once your media server is configured, you'll sign in to claim admin access."

      const currentPlexRestrict =
        window.PLEX_RESTRICT_TO_SERVER === true ||
        window.PLEX_RESTRICT_TO_SERVER === 'true'
      const plexConfigured = Boolean(window.PLEX_CONFIGURED)
      const plexRestrictRow = plexConfigured
        ? `<label class="first-run-user-auth-row">
            <input type="checkbox" id="first-run-plex-restrict" ${
              currentPlexRestrict ? 'checked' : ''
            } />
            <div>
              <strong>Restrict to this Plex server</strong>
              <p class="first-run-guide-instruction">Only allow users who are members of your Plex server to log in.</p>
            </div>
          </label>`
        : ''

      body.innerHTML = `
        <p class="first-run-guide-instruction" style="margin-bottom:0.75rem">
          Plex authentication is always enabled. Every user must sign in with Plex before using Comparr.
        </p>
        ${plexRestrictRow}
        <p id="first-run-user-auth-note" class="first-run-guide-instruction" style="margin-top:0.75rem">
          You can always change these settings later under Settings → Security &amp; Access.
        </p>
      `
      return
    }

    if (screen.type === 'admin-login') {
      renderRequirementCopy('')
      title.textContent = 'Claim Admin Access'
      copy.textContent =
        'Sign in with your media server account to be set as the admin. As the person setting this up, that should be you.'

      if (selectedState.adminLoggedIn) {
        body.textContent = ''
        const msg = document.createElement('p')
        msg.className = 'first-run-guide-instruction'
        msg.style.color = '#86efac'
        msg.style.fontWeight = '600'
        msg.textContent = `✓ Signed in as ${
          selectedState.adminLoginUser?.username || 'you'
        }. Click Next to continue.`
        body.appendChild(msg)
        return
      }

      body.innerHTML = `
        <div class="first-run-admin-login-btns">
          <button type="button" class="plex-signin-btn server-signin-btn server-signin-btn--plex js-wizard-admin-plex-btn">
            Sign in with <img src="/assets/logos/plex_logo_button.png" alt="Plex" class="media-logo-img" />
          </button>
          <p class="user-auth-status js-wizard-admin-plex-status" hidden></p>
        </div>
      `

      const handleAdminLoggedIn = user => {
        window.COMPARR_USER = user
        selectedState.adminLoggedIn = true
        selectedState.adminLoginUser = user
        persistWizardProgress()
        body.textContent = ''
        const msg = document.createElement('p')
        msg.className = 'first-run-guide-instruction'
        msg.style.color = '#86efac'
        msg.style.fontWeight = '600'
        msg.textContent = `✓ Signed in as ${user.username}. Click Next to continue.`
        body.appendChild(msg)
        nextButton.disabled = false
      }

      // ── Plex PIN flow ────────────────────────────────────────────
      const plexBtn = body.querySelector('.js-wizard-admin-plex-btn')
      const plexStatus = body.querySelector('.js-wizard-admin-plex-status')

      plexBtn?.addEventListener('click', async () => {
        plexBtn.disabled = true
        if (plexStatus) {
          plexStatus.textContent = 'Opening Plex login…'
          plexStatus.hidden = false
        }

        let pollTimer = null
        let popup = null
        let popupClosedAt = null

        const cleanupPoll = () => {
          if (pollTimer) clearInterval(pollTimer)
          pollTimer = null
          if (popup && !popup.closed) popup.close()
        }

        try {
          const { pinId, authUrl } = await api.requestPlexPin()
          popup = window.open(
            'about:blank',
            '_blank',
            'width=800,height=700,left=100,top=100'
          )

          if (!popup || popup === window || popup.closed) {
            if (plexStatus)
              plexStatus.textContent =
                'Popup blocked. Please allow popups and try again.'
            plexBtn.disabled = false
            return
          }
          popup.location.href = authUrl

          if (plexStatus)
            plexStatus.textContent = 'Waiting for Plex approval…'

          pollTimer = setInterval(async () => {
            try {
              const result = await api.pollPlexPin(pinId)
              if (result.status === 'success') {
                cleanupPoll()
                handleAdminLoggedIn(result.user)
              } else if (
                result.status === 'expired' ||
                result.status === 'denied'
              ) {
                cleanupPoll()
                plexBtn.disabled = false
                if (plexStatus)
                  plexStatus.textContent =
                    result.status === 'denied'
                      ? result.error || 'Access denied.'
                      : 'Plex login expired. Please try again.'
              } else if (popup.closed) {
                if (!popupClosedAt) {
                  popupClosedAt = Date.now()
                  if (plexStatus) plexStatus.textContent = 'Verifying login…'
                }
                if (Date.now() - popupClosedAt >= 6000) {
                  cleanupPoll()
                  plexBtn.disabled = false
                  if (plexStatus) plexStatus.textContent = 'Login cancelled.'
                }
              }
            } catch {
              /* ignore transient poll errors */
            }
          }, 2000)
        } catch (err) {
          cleanupPoll()
          plexBtn.disabled = false
          if (plexStatus)
            plexStatus.textContent =
              err.message || 'Could not start Plex login.'
        }
      })

      return
    }

    if (screen.type === 'setup-complete') {
      renderRequirementCopy('')
      title.textContent = 'Setup Complete'
      copy.textContent =
        "You're all set. Visit the settings tab in your navigation menu to further customize and edit your current settings."
      body.innerHTML = ''
    }
  }

  const getNextScreen = async () => {
    const current = history[history.length - 1] || { type: 'security' }

    if (current.type === 'security') {
      const accessPasswordInput = body.querySelector(
        '#first-run-access-password'
      )

      // A field is "changed" only when it was explicitly revealed via the
      // Change toggle (or was never configured, so always visible) AND has a value
      const accessChangeActive =
        body.querySelector('#first-run-access-input-wrap')?.hidden === false ||
        !window.ACCESS_PASSWORD_SET

      const newAccessPassword =
        accessChangeActive && accessPasswordInput?.value
          ? accessPasswordInput.value
          : null

      // Build the save payload — only include keys that actually changed
      const settingsToSave = {}
      if (newAccessPassword !== null) {
        settingsToSave.ACCESS_PASSWORD = newAccessPassword
        syncInputValue('setting-access-password', newAccessPassword)
        selectedState.security.accessPassword = newAccessPassword
      } else if (!window.ACCESS_PASSWORD_SET) {
        // Field shown but left blank — save empty (user opted for no password)
        settingsToSave.ACCESS_PASSWORD = ''
        syncInputValue('setting-access-password', '')
        selectedState.security.accessPassword = ''
      }

      // Nothing actually changed — just advance
      if (Object.keys(settingsToSave).length === 0) {
        return { type: 'user-auth' }
      }

      try {
        await saveSettingsSubset(settingsToSave)
        // If an access password was just set, immediately verify it so the
        // browser gets a session cookie. Without this, every subsequent wizard
        // step would be blocked by the access-password middleware.
        if (newAccessPassword) {
          await api.verifyAccessPassword(newAccessPassword).catch(() => {})
        }
      } catch (err) {
        setWizardStatus(
          err?.message || 'Failed to save security settings.',
          'error'
        )
        return null
      }

      return { type: 'user-auth' }
    }

    if (current.type === 'user-auth') {
      const plexRestrictEl = body.querySelector('#first-run-plex-restrict')

      const plexRestrict = plexRestrictEl?.checked ?? false

      const settingsToSave = {}
      if (plexRestrictEl) {
        settingsToSave.PLEX_RESTRICT_TO_SERVER = plexRestrict ? 'true' : 'false'
      }

      try {
        await saveSettingsSubset(settingsToSave)
        window.USER_AUTH_ENABLED = true
        if (plexRestrictEl) window.PLEX_RESTRICT_TO_SERVER = plexRestrict
      } catch (err) {
        setWizardStatus(
          err?.message || 'Failed to save authentication settings.',
          'error'
        )
        return null
      }

      return { type: 'flow' }
    }

    if (current.type === 'flow') {
      if (!selectedState.flow) {
        setWizardStatus('Please select one option to continue.', 'error')
        return null
      }
      return selectedState.flow === 'tmdb-only'
        ? { type: 'tmdb' }
        : { type: 'sources' }
    }

    if (current.type === 'sources') {
      const checked = Array.from(
        body.querySelectorAll('input[type="checkbox"]:checked')
      ).map(el => el.value)
      if (!checked.length) {
        setWizardStatus('Select at least one source to continue.', 'error')
        return null
      }
      selectedState.sources = checked
      try {
        await saveSettingsSubset({
          PERSONAL_MEDIA_SOURCES: JSON.stringify(checked),
        })
      } catch (err) {
        setWizardStatus(err?.message || 'Failed to save sources.', 'error')
        return null
      }
      return { type: 'service', target: checked[0], index: 0 }
    }

    if (current.type === 'service') {
      const meta = serviceMeta[current.target]
      const url =
        body.querySelector(`#first-run-${current.target}-url`)?.value || ''
      const token =
        body.querySelector(`#first-run-${current.target}-token`)?.value || ''
      if (!isValidUrl(url) || !token.trim()) {
        setWizardStatus(meta.requiredLabel, 'error')
        return null
      }
      if (!selectedState.validatedTargets[current.target]) {
        setWizardStatus(
          `Please test ${meta.label} connection before continuing.`,
          'error'
        )
        return null
      }
      syncInputValue(meta.inputIds.url, url)
      syncInputValue(meta.inputIds.token, token)
      try {
        await saveSettingsSubset({
          [meta.settings.url]: url,
          [meta.settings.token]: token,
        })
      } catch (err) {
        setWizardStatus(err?.message || 'Failed to save settings.', 'error')
        return null
      }
      const nextIndex = current.index + 1
      if (nextIndex < selectedState.sources.length) {
        return {
          type: 'service',
          target: selectedState.sources[nextIndex],
          index: nextIndex,
        }
      }
      const userAuthEnabled =
        window.USER_AUTH_ENABLED === true || window.USER_AUTH_ENABLED === 'true'
      const canUseAdminSignIn = selectedState.sources.includes('plex')
      if (userAuthEnabled && canUseAdminSignIn) {
        try {
          const { user } = await api.getAuthUser()
          if (user) {
            selectedState.adminLoggedIn = true
            selectedState.adminLoginUser = user
            window.COMPARR_USER = user
            return selectedState.flow === 'combined'
              ? { type: 'tmdb' }
              : { type: 'setup-complete' }
          }
        } catch {
          // no auth session yet
        }
        return { type: 'admin-login' }
      }
      return selectedState.flow === 'combined'
        ? { type: 'tmdb' }
        : { type: 'setup-complete' }
    }

    if (current.type === 'admin-login') {
      if (!selectedState.adminLoggedIn) {
        try {
          const { user } = await api.getAuthUser()
          if (user) {
            selectedState.adminLoggedIn = true
            selectedState.adminLoginUser = user
            window.COMPARR_USER = user
          }
        } catch {
          // no auth session yet
        }
      }
      if (!selectedState.adminLoggedIn) {
        setWizardStatus('Please sign in to continue.', 'error')
        return null
      }
      return selectedState.flow === 'combined'
        ? { type: 'tmdb' }
        : { type: 'setup-complete' }
    }

    if (current.type === 'tmdb') {
      const tmdbKey = body.querySelector('#first-run-tmdb-key')?.value || ''
      if (!tmdbKey.trim()) {
        setWizardStatus('TMDb API key is required.', 'error')
        return null
      }
      if (!selectedState.validatedTargets.tmdb) {
        setWizardStatus(
          'Please test TMDb connection before finishing.',
          'error'
        )
        return null
      }
      syncInputValue('setting-tmdb-key', tmdbKey)
      try {
        await saveSettingsSubset({ TMDB_API_KEY: tmdbKey })
      } catch (err) {
        setWizardStatus(
          err?.message || 'Failed to save TMDb settings.',
          'error'
        )
        return null
      }
      if (
        selectedState.flow === 'tmdb-only' ||
        selectedState.flow === 'combined'
      ) {
        return { type: 'subscriptions' }
      }
      return { type: 'setup-complete' }
    }

    if (current.type === 'subscriptions') {
      const selectedSubscriptions = Array.from(
        body.querySelectorAll(
          'input[data-first-run-paid-streaming-service="true"]:checked'
        )
      )
        .map(input => String(input.value || '').trim())
        .filter(Boolean)

      selectedState.subscriptions = selectedSubscriptions
      const serializedSubscriptions = JSON.stringify(selectedSubscriptions)
      window.PAID_STREAMING_SERVICES = serializedSubscriptions
      hydratePaidStreamingServicesSetting(serializedSubscriptions)
      try {
        await saveSettingsSubset({
          PAID_STREAMING_SERVICES: serializedSubscriptions,
        })
      } catch (err) {
        setWizardStatus(
          err?.message || 'Failed to save subscription settings.',
          'error'
        )
        return null
      }
      return { type: 'requests' }
    }

    if (current.type === 'requests') {
      persistRequestInputs()
      if (!hasAnyRequestInput()) {
        setWizardStatus(
          'Leave fields blank and click Skip, or add details to continue.',
          'error'
        )
        return null
      }

      const s = selectedState.requestServices
      if (!isValidUrl(s.radarrUrl) || !s.radarrApiKey) {
        setWizardStatus('Radarr URL and API Key are required.', 'error')
        return null
      }
      if (!s.seerrUrl && !s.seerrApiKey) {
        setWizardStatus('Add Seerr details, or click Skip.', 'error')
        return null
      }
      if (!isValidUrl(s.seerrUrl) || !s.seerrApiKey) {
        setWizardStatus('Seerr URL and API Key are both required.', 'error')
        return null
      }

      try {
        await saveSettingsSubset({
          RADARR_URL: s.radarrUrl,
          RADARR_API_KEY: s.radarrApiKey,
          SEERR_URL: s.seerrUrl,
          SEERR_API_KEY: s.seerrApiKey,
        })
      } catch (err) {
        setWizardStatus(
          err?.message || 'Failed to save request settings.',
          'error'
        )
        return null
      }

      await loadClientConfig().catch(() => {})
      return { type: 'defaults' }
    }

    if (current.type === 'defaults') {
      if (hasUnsavedDefaultsChanges()) {
        const shouldContinue = await promptDefaultsUnsavedChanges()
        if (!shouldContinue) return null
      }
      leaveDefaultsEditor()
      return { type: 'setup-complete' }
    }

    if (current.type === 'setup-complete') {
      try {
        await saveSettingsSubset({
          SETUP_WIZARD_COMPLETED: 'true',
        })
      } catch (err) {
        setWizardStatus(
          err?.message || 'Failed to finish setup. Please try again.',
          'error'
        )
        return null
      }
      await loadClientConfig()
      // Force settings form to re-hydrate so admin settings reflect wizard values
      settingsHydratedWithAdminAccess = false
      if (settingsUiHydrated) {
        const adminSuccess = await hydrateSettingsForm()
        settingsHydratedWithAdminAccess = Boolean(adminSuccess)
      }
      clearWizardProgress()
      document.dispatchEvent(new CustomEvent('comparr:source-config-updated'))
      return { type: 'complete' }
    }

    return null
  }

  const startWizard = () => {
    const configuredSources = parseArraySetting(
      document.getElementById('setting-personal-media-sources')?.value ||
        window.PERSONAL_MEDIA_SOURCES
    )
    const fallbackSources = []
    if (window.PLEX_CONFIGURED) fallbackSources.push('plex')
    if (window.EMBY_CONFIGURED) fallbackSources.push('emby')
    if (window.JELLYFIN_CONFIGURED) fallbackSources.push('jellyfin')
    selectedState.sources = configuredSources.length
      ? configuredSources
      : fallbackSources

    if (selectedState.sources.length && window.TMDB_CONFIGURED) {
      selectedState.flow = 'combined'
    } else if (window.TMDB_CONFIGURED) {
      selectedState.flow = 'tmdb-only'
    } else {
      selectedState.flow = 'personal-only'
    }

    selectedState.validatedTargets = {
      plex: Boolean(window.PLEX_CONFIGURED),
      emby: Boolean(window.EMBY_CONFIGURED),
      jellyfin: Boolean(window.JELLYFIN_CONFIGURED),
      tmdb: Boolean(window.TMDB_CONFIGURED),
    }

    selectedState.subscriptions = parseArraySetting(
      document.getElementById('setting-paid-streaming-services')?.value ||
        window.PAID_STREAMING_SERVICES
    )
    selectedState.requestServices.radarrUrl =
      document.getElementById('setting-radarr-url')?.value?.trim() || ''
    selectedState.requestServices.radarrApiKey =
      document.getElementById('setting-radarr-api-key')?.value?.trim() || ''
    selectedState.requestServices.jellyseerrUrl =
      document.getElementById('setting-jellyseerr-url')?.value?.trim() || ''
    selectedState.requestServices.jellyseerrApiKey =
      document.getElementById('setting-jellyseerr-api-key')?.value?.trim() || ''
    selectedState.requestServices.overseerrUrl =
      document.getElementById('setting-overseerr-url')?.value?.trim() || ''
    selectedState.requestServices.overseerrApiKey =
      document.getElementById('setting-overseerr-api-key')?.value?.trim() || ''
    selectedState.requestServices.seerrUrl =
      document.getElementById('setting-seerr-url')?.value?.trim() || ''
    selectedState.requestServices.seerrApiKey =
      document.getElementById('setting-seerr-api-key')?.value?.trim() || ''
    selectedState.requestServices.requestServiceType =
      selectedState.requestServices.seerrUrl &&
      selectedState.requestServices.seerrApiKey
        ? 'seerr'
        : selectedState.requestServices.overseerrUrl &&
          selectedState.requestServices.overseerrApiKey &&
          !selectedState.requestServices.jellyseerrUrl &&
          !selectedState.requestServices.jellyseerrApiKey
        ? 'overseerr'
        : 'jellyseerr'
    selectedState.security.accessPassword =
      document.getElementById('setting-access-password')?.value || ''

    if (restoreWizardProgress()) {
      renderScreen(history[history.length - 1])
      return
    }

    // Skip security screen when an access password is already configured.
    const initial = window.ACCESS_PASSWORD_SET
      ? { type: 'flow' }
      : { type: 'security' }
    history.splice(0, history.length, initial)
    renderScreen(initial)
  }

  nextButton?.addEventListener('click', async () => {
    await withButtonLoading(nextButton, 'Loading...', async () => {
      const next = await getNextScreen()
      if (!next || next.type === 'complete') return
      history.push(next)
      persistWizardProgress()
      renderScreen(next)
    })
  })

  backButton?.addEventListener('click', () => {
    if (history.length <= 1) return
    const current = history[history.length - 1]
    if (current?.type === 'defaults') {
      leaveDefaultsEditor()
    }
    history.pop()
    persistWizardProgress()
    renderScreen(history[history.length - 1])
  })

  skipButton?.addEventListener('click', async () => {
    await withButtonLoading(skipButton, 'Loading...', async () => {
      const current = history[history.length - 1]
      if (current?.type === 'security') {
        // Skip means advance without making any changes — no save needed
        history.push({ type: 'flow' })
        persistWizardProgress()
        renderScreen({ type: 'flow' })
        return
      }

      if (current?.type !== 'requests') return
      persistRequestInputs()
      await loadClientConfig().catch(() => {})
      history.push({ type: 'defaults' })
      persistWizardProgress()
      renderScreen({ type: 'defaults' })
    })
  })

  saveButton?.addEventListener('click', async () => {
    if ((history[history.length - 1] || {}).type !== 'defaults') return
    await withButtonLoading(saveButton, 'Saving...', async () => {
      saveDefaultsFromWizard()
    })
  })

  document.addEventListener('comparr:wizard-defaults-saved', e => {
    selectedState.defaultsLastSavedSnapshot =
      e.detail?.snapshot || getCurrentDefaultsSnapshot()
    setWizardStatus('✅ Default filters saved.', 'success')
  })

  renderRequirementCopy('')
  startWizard()

  return modal
}

async function ensureInitialSourceSetup() {
  if (hasConfiguredMovieSource() && window.SETUP_WIZARD_COMPLETED) return

  const modal = createFirstRunGuideModal()
  modal?.classList.add('is-visible')

  await new Promise(resolve => {
    const handleRecheck = async () => {
      await loadClientConfig()
      if (!hasConfiguredMovieSource() || !window.SETUP_WIZARD_COMPLETED) {
        return
      }
      modal?.classList.remove('is-visible')
      document.removeEventListener(
        'comparr:source-config-updated',
        handleRecheck
      )
      resolve()
    }

    document.addEventListener('comparr:source-config-updated', handleRecheck)
  })
}

async function hydrateSettingsUiIfAuthorized() {
  if (settingsUiHydrated) {
    if (hasAdminSettingsAccess && !settingsHydratedWithAdminAccess) {
      const adminSuccess = await hydrateSettingsForm()
      settingsHydratedWithAdminAccess = Boolean(adminSuccess)
    }
    updateAdminOnlySettingsVisibility()
    return true
  }

  initializeAdvancedSettingsToggle()
  initializeAdminSettingsTabs()
  initializeIntegrationTestButtons()
  initializeDisplaySettingsToggleButtons()
  await hydrateSettingsForm()
  hydrateDisplaySettingsForm()

  document
    .querySelectorAll(
      '[data-setting-key], [data-paid-streaming-service], [data-personal-media-source], input[name="admin-request-service-type"]'
    )
    .forEach(el => {
      if (el.dataset.boundSettingsDirty === 'true') return
      el.addEventListener('change', () => setSettingsDirty(true))
      el.dataset.boundSettingsDirty = 'true'
    })

  document
    .querySelector('.settings-save-btn')
    ?.addEventListener('click', () => {
      if (currentSettingsTarget === 'settings-defaults') {
        swipeFilterApply?.click()
        return
      }
      if (currentSettingsTarget === 'settings-display') {
        saveDisplaySettingsForm()
        setSettingsStatus('Display settings saved.')
        pulseSettingsStatus('success')
        clearSettingsStatusAfterDelay(5000)
        setSettingsDirty(false)
        return
      }
      saveSettingsForm()
    })

  document
    .getElementById('settings-defaults-reset')
    ?.addEventListener('click', () => {
      swipeFilterReset?.click()
    })

  updateAdminOnlySettingsVisibility()
  syncSettingsFooterActions()
  settingsUiHydrated = true
  settingsHydratedWithAdminAccess = hasAdminSettingsAccess
  return true
}

function bindSettingsAccessGuards() {
  const settingsTriggers = document.querySelectorAll(
    '.mobile-settings-item[data-settings-target="settings-admin"], .sidebar-subitem[data-settings-target="settings-admin"]'
  )

  settingsTriggers.forEach(trigger => {
    if (trigger.dataset.boundAdminGuard === 'true') return

    trigger.addEventListener(
      'click',
      async e => {
        // ensureAdminAccess() always refreshes settingsAccessState first, so
        // stale state from page-load can never bypass the password prompt.
        const hasAccess = await ensureAdminAccess()
        if (!hasAccess) {
          e.preventDefault()
          e.stopPropagation()
          if (typeof e.stopImmediatePropagation === 'function') {
            e.stopImmediatePropagation()
          }
          setSettingsStatus('Admin access is required to open Admin settings.')
          return
        }

        hasAdminSettingsAccess = true
        updateAdminOnlySettingsVisibility()
        await hydrateSettingsUiIfAuthorized()
      },
      true
    )

    trigger.dataset.boundAdminGuard = 'true'
  })
}

async function setupSettingsUI() {
  settingsAccessState = await fetchSettingsAccess()
  toggleSettingsVisibility(settingsAccessState.canAccess)
  if (!settingsAccessState.canAccess) {
    return
  }

  hasAdminSettingsAccess = !settingsAccessState.requiresAdminPassword
  updateAdminOnlySettingsVisibility()
  bindSettingsAccessGuards()

  // During pre-login screens (normal startup after setup is complete), /api/settings
  // requires user auth and returns 401. Defer hydration until after login.
  if (window.SETUP_WIZARD_COMPLETED && !window.COMPARR_USER) {
    return
  }

  await hydrateSettingsUiIfAuthorized()
}

// Make it globally available
window.sortWatchList = sortWatchList

function sortPassList(sortBy) {
  const dislikesList = document.querySelector('.dislikes-list')
  if (!dislikesList) return

  const cards = Array.from(dislikesList.querySelectorAll('.watch-card'))

  // Store original order for date sorting
  if (!dislikesList.dataset.originalOrder) {
    dislikesList.dataset.originalOrder = cards
      .map(c => c.dataset.guid)
      .join(',')
  }

  // Parse sortBy into field and direction
  let sortField, sortDirection
  if (sortBy.includes('-')) {
    const parts = sortBy.split('-')
    sortField = parts[0]
    sortDirection = parts[1]
  } else {
    sortField = sortBy
    sortDirection = 'desc'
  }

  cards.sort((a, b) => {
    const titleA = a
      .querySelector('.watch-card-title-compact')
      .textContent.trim()
    const titleB = b
      .querySelector('.watch-card-title-compact')
      .textContent.trim()

    const yearA = parseInt(
      a.querySelector('.watch-card-year').textContent.match(/\d+/)?.[0] || 0
    )
    const yearB = parseInt(
      b.querySelector('.watch-card-year').textContent.match(/\d+/)?.[0] || 0
    )

    const getRatings = card => {
      const ratingEl = card.querySelector('.watch-card-ratings')
      if (!ratingEl) return { imdb: 0, rt: 0, tmdb: 0 }
      const innerHTML = ratingEl.innerHTML
      const imdbMatch = innerHTML.match(/imdb\.svg[^>]*>\s*([\d.]+)/i)
      const imdb = imdbMatch ? parseFloat(imdbMatch[1]) : 0
      const rt = 0
      const tmdbMatch = innerHTML.match(/tmdb\.svg[^>]*>\s*([\d.]+)/i)
      const tmdb = tmdbMatch ? parseFloat(tmdbMatch[1]) : 0
      return { imdb, rt, tmdb }
    }

    const ratingsA = getRatings(a)
    const ratingsB = getRatings(b)
    const popularityA = parseFloat(a.dataset.popularity || 0)
    const popularityB = parseFloat(b.dataset.popularity || 0)
    const votesA = parseInt(a.dataset.voteCount || 0)
    const votesB = parseInt(b.dataset.voteCount || 0)

    let result = 0
    switch (sortField) {
      case 'title':
        result = titleA.localeCompare(titleB)
        break
      case 'year':
      case 'release_date':
        result = yearA - yearB
        break
      case 'imdb':
        result = ratingsA.imdb - ratingsB.imdb
        break
      case 'rt':
        result = ratingsA.rt - ratingsB.rt
        break
      case 'tmdb':
        result = ratingsA.tmdb - ratingsB.tmdb
        break
      case 'popularity':
        result = popularityA - popularityB
        break
      case 'vote_count':
        result = votesA - votesB
        break
      case 'date':
        const originalOrder = dislikesList.dataset.originalOrder.split(',')
        result =
          originalOrder.indexOf(a.dataset.guid) -
          originalOrder.indexOf(b.dataset.guid)
        break
      default:
        result = 0
    }
    return sortDirection === 'asc' ? result : -result
  })

  cards.forEach(card => card.remove())
  cards.forEach(card => dislikesList.appendChild(card))
}
window.sortPassList = sortPassList

function sortSeenList(sortBy) {
  const seenList = document.querySelector('.seen-list')
  if (!seenList) return

  const cards = Array.from(seenList.querySelectorAll('.watch-card'))

  // Store original order for date sorting
  if (!seenList.dataset.originalOrder) {
    seenList.dataset.originalOrder = cards.map(c => c.dataset.guid).join(',')
  }

  // Parse sortBy into field and direction
  let sortField, sortDirection
  if (sortBy.includes('-')) {
    const parts = sortBy.split('-')
    sortField = parts[0]
    sortDirection = parts[1]
  } else {
    sortField = sortBy
    sortDirection = 'desc'
  }

  cards.sort((a, b) => {
    const titleA = a
      .querySelector('.watch-card-title-compact')
      .textContent.trim()
    const titleB = b
      .querySelector('.watch-card-title-compact')
      .textContent.trim()

    const yearA = parseInt(
      a.querySelector('.watch-card-year').textContent.match(/\d+/)?.[0] || 0
    )
    const yearB = parseInt(
      b.querySelector('.watch-card-year').textContent.match(/\d+/)?.[0] || 0
    )

    const getRatings = card => {
      const ratingEl = card.querySelector('.watch-card-ratings')
      if (!ratingEl) return { imdb: 0, rt: 0, tmdb: 0 }
      const innerHTML = ratingEl.innerHTML
      const imdbMatch = innerHTML.match(/imdb\.svg[^>]*>\s*([\d.]+)/i)
      const imdb = imdbMatch ? parseFloat(imdbMatch[1]) : 0
      const rt = 0
      const tmdbMatch = innerHTML.match(/tmdb\.svg[^>]*>\s*([\d.]+)/i)
      const tmdb = tmdbMatch ? parseFloat(tmdbMatch[1]) : 0
      return { imdb, rt, tmdb }
    }

    const ratingsA = getRatings(a)
    const ratingsB = getRatings(b)
    const popularityA = parseFloat(a.dataset.popularity || 0)
    const popularityB = parseFloat(b.dataset.popularity || 0)
    const votesA = parseInt(a.dataset.voteCount || 0)
    const votesB = parseInt(b.dataset.voteCount || 0)

    let result = 0
    switch (sortField) {
      case 'title':
        result = titleA.localeCompare(titleB)
        break
      case 'year':
      case 'release_date':
        result = yearA - yearB
        break
      case 'imdb':
        result = ratingsA.imdb - ratingsB.imdb
        break
      case 'rt':
        result = ratingsA.rt - ratingsB.rt
        break
      case 'tmdb':
        result = ratingsA.tmdb - ratingsB.tmdb
        break
      case 'popularity':
        result = popularityA - popularityB
        break
      case 'vote_count':
        result = votesA - votesB
        break
      case 'date':
        const originalOrder = seenList.dataset.originalOrder.split(',')
        result =
          originalOrder.indexOf(a.dataset.guid) -
          originalOrder.indexOf(b.dataset.guid)
        break
      default:
        result = 0
    }
    return sortDirection === 'asc' ? result : -result
  })

  cards.forEach(card => card.remove())
  cards.forEach(card => seenList.appendChild(card))
}
window.sortSeenList = sortSeenList

function applyCurrentWatchListSort() {
  const sortField = watchSortDropdown?.value || 'date'
  const direction = watchSortDirectionBtn?.dataset.direction || 'desc'
  window.sortWatchList(`${sortField}-${direction}`)
}

function applyCurrentPassListSort() {
  const sortField = passSortDropdown?.value || 'date'
  const direction = passSortDirectionBtn?.dataset.direction || 'desc'
  window.sortPassList(`${sortField}-${direction}`)
}

function applyCurrentSeenListSort() {
  const sortField = seenSortDropdown?.value || 'date'
  const direction = seenSortDirectionBtn?.dataset.direction || 'desc'
  window.sortSeenList(`${sortField}-${direction}`)
}

/* ------------- login (prevents page nav) -------- */
async function login(api) {
  const loginSection = document.querySelector('.login-section')
  const passwordForm = document.querySelector('.js-password-form')
  const loginForm = document.querySelector('.js-login-form')
  const modeForm = document.querySelector('.js-mode-form')
  const roomCodeInput = loginForm?.elements?.roomCode
  const generatedRoomCodeInput = loginForm?.elements?.generatedRoomCode
  const roomCodeError = document.querySelector('.js-room-code-error')
  const loginError = document.querySelector('.js-login-error')
  const roomStepInstruction = document.querySelector(
    '.js-room-step-instruction'
  )
  const roomModeTabs = [...document.querySelectorAll('.js-room-mode-tab')]
  const roomModePanels = [...document.querySelectorAll('.js-room-code-panel')]
  const loginSubmitButton = document.querySelector('.js-login-submit-button')
  const generateBtn = document.querySelector('.js-generate-room-code')
  const roomCodeLine = document.querySelector('.js-room-code-line')
  const i18nRoomExistsMessage =
    document.body.dataset.i18nRoomExistsMessage ||
    'Room Code already Exists. Try again or click Generate.'
  const i18nRoomNotFoundMessage =
    document.body.dataset.i18nRoomNotFoundMessage ||
    'Room code not found, try again or create a new one by toggling New here? to YES.'
  const loginHelperCopy = document.querySelector('.login-helper-copy')

  const passwordError = document.createElement('p')
  passwordError.className = 'password-error-message'
  passwordError.hidden = true
  passwordForm.appendChild(passwordError)

  const setPasswordError = message => {
    passwordError.textContent = message
    passwordError.hidden = !message
  }

  const setRoomCodeError = message => {
    if (!roomCodeError) return
    roomCodeError.textContent = message
    roomCodeError.hidden = !message
  }

  const setLoginError = message => {
    if (!loginError) return
    loginError.textContent = message
    loginError.hidden = !message
  }

  const promptActiveSessionTakeover = () => {
    const overlay = document.getElementById('active-session-overlay')
    const popup = document.getElementById('active-session-popup')
    const continueBtn = document.getElementById('active-session-continue-btn')
    const cancelBtn = document.getElementById('active-session-cancel-btn')

    if (!overlay || !popup || !continueBtn || !cancelBtn) {
      return Promise.resolve(
        window.confirm(
          'You already have an active session. Continue to log out all other active sessions on all devices?'
        )
      )
    }

    const closePrompt = () => {
      popup.classList.remove('active')
      overlay.classList.remove('active')
    }

    return new Promise(resolve => {
      const cleanup = () => {
        continueBtn.removeEventListener('click', onContinue)
        cancelBtn.removeEventListener('click', onCancel)
        overlay.removeEventListener('click', onCancel)
      }

      const onContinue = () => {
        cleanup()
        closePrompt()
        resolve(true)
      }

      const onCancel = () => {
        cleanup()
        closePrompt()
        if (modeForm) modeForm.style.display = 'grid'
        loginForm.style.display = 'none'
        setLoginError('')
        window.scrollTo({ top: 0, behavior: 'smooth' })
        resolve(false)
      }

      continueBtn.addEventListener('click', onContinue)
      cancelBtn.addEventListener('click', onCancel)
      overlay.addEventListener('click', onCancel)

      overlay.classList.add('active')
      popup.classList.add('active')
    })
  }

  const normalizeRoomCodeInput = value =>
    String(value || '')
      .trim()
      .toUpperCase()
      .replace(/[^0-9A-Z]/g, '')
      .slice(0, 4)

  let roomMode = 'join'
  let selectedMode = 'group'

  const getActiveRoomCode = () => {
    if (roomMode === 'create') {
      return normalizeRoomCodeInput(generatedRoomCodeInput?.value)
    }

    return normalizeRoomCodeInput(roomCodeInput?.value)
  }

  const setActiveRoomCode = code => {
    const normalized = normalizeRoomCodeInput(code)
    if (roomMode === 'create') {
      if (generatedRoomCodeInput) generatedRoomCodeInput.value = normalized
      return
    }

    if (roomCodeInput) roomCodeInput.value = normalized
  }

  const syncRoomCodeInputs = () => {
    if (roomMode === 'create') {
      if (generatedRoomCodeInput) {
        generatedRoomCodeInput.value = normalizeRoomCodeInput(
          generatedRoomCodeInput.value
        )
      }
      return
    }

    if (roomCodeInput) {
      roomCodeInput.value = normalizeRoomCodeInput(roomCodeInput.value)
    }
  }

  const getRoomStepCopy = (mode, selectedMode) => {
    const isCreate = mode === 'create'
    const isPersonalMode = selectedMode === 'personal'

    if (!isCreate) {
      return 'Room Code'
    }

    return isPersonalMode
      ? 'Create a new private room code.'
      : 'Create a new group room code.'
  }

  const setRoomMode = (mode, selectedMode = 'group') => {
    roomMode = mode === 'create' ? 'create' : 'join'
    const isJoinMode = roomMode === 'join'
    const isCreateMode = roomMode === 'create'

    roomModeTabs.forEach(tab => {
      const active = tab.dataset.roomMode === roomMode
      tab.classList.toggle('is-active', active)
      tab.setAttribute('aria-selected', active ? 'true' : 'false')
    })

    roomModePanels.forEach(panel => {
      panel.hidden = panel.dataset.roomModePanel !== roomMode
    })

    if (roomStepInstruction) {
      roomStepInstruction.textContent = getRoomStepCopy(roomMode, selectedMode)
    }

    if (loginHelperCopy) {
      loginHelperCopy.hidden = roomMode !== 'join'
    }

    if (loginSubmitButton) {
      loginSubmitButton.hidden = roomMode === 'join'
    }

    if (roomCodeInput) {
      roomCodeInput.required = isJoinMode
      roomCodeInput.disabled = !isJoinMode
    }

    if (generatedRoomCodeInput) {
      generatedRoomCodeInput.required = isCreateMode
      generatedRoomCodeInput.disabled = !isCreateMode
    }

    setRoomCodeError('')
    setLoginError('')
    syncRoomCodeInputs()
  }

  roomModeTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      setRoomMode(tab.dataset.roomMode, selectedMode)
    })
  })

  const handleRoomCodeInput = event => {
    const normalized = normalizeRoomCodeInput(event.target.value)
    event.target.value = normalized
    syncRoomCodeInputs()
    setRoomCodeError('')
    setLoginError('')
  }

  roomCodeInput?.addEventListener('input', handleRoomCodeInput)
  generatedRoomCodeInput?.addEventListener('input', handleRoomCodeInput)

  let verifiedPassword = null

  const showModeForm = () => {
    if (userAuthForm) userAuthForm.style.display = 'none'
    if (modeForm) modeForm.style.display = 'grid'
    window.scrollTo({ top: 0, behavior: 'smooth' })

    // Restore cached group credentials (skip if we have identity from auth)
    const savedUser = currentUser?.username || localStorage.getItem('user')
    const savedCode = localStorage.getItem('roomCode')
    const normalizedSavedCode = normalizeRoomCodeInput(savedCode)
    const hasMeaningfulSavedGroupCredentials =
      Boolean(savedUser && normalizedSavedCode) &&
      !(savedUser.trim() === 'Solo' && normalizedSavedCode === 'SOLO')

    if (hasMeaningfulSavedGroupCredentials) {
      loginForm.elements.name.value = savedUser
      if (roomCodeInput) roomCodeInput.value = normalizedSavedCode
    }

    setRoomMode('join', selectedMode)
  }

  const handleVerifiedPassword = accessPassword => {
    setPasswordError('')
    setLoginError('')
    verifiedPassword = accessPassword
    passwordForm.style.display = 'none'
    // User auth step will show mode form when done; if auth not needed,
    // showModeForm() is called directly after this.
  }

  const userAuthForm = document.querySelector('.js-user-auth-form')
  const userAuthPlex = document.querySelector('.js-user-auth-plex')
  const userAuthJellyfin = document.querySelector('.js-user-auth-jellyfin')
  const userAuthEmby = document.querySelector('.js-user-auth-emby')
  const plexSigninBtn = document.querySelector('.js-plex-signin-btn')
  const plexStatus = document.querySelector('.js-plex-status')
  const jellyfinSigninBtn = document.querySelector('.js-jellyfin-signin-btn')
  const jellyfinStatus = document.querySelector('.js-jellyfin-status')
  const embySigninBtn = document.querySelector('.js-emby-signin-btn')
  const embyStatus = document.querySelector('.js-emby-status')
  const credentialModal = document.querySelector('.js-user-auth-modal')
  const credentialModalClose = document.querySelector(
    '.js-user-auth-modal-close'
  )
  const credentialModalProvider = document.querySelector(
    '.js-user-auth-modal-provider'
  )
  const credentialModalForm = document.querySelector('.js-user-auth-modal-form')
  const credentialModalStatus = document.querySelector(
    '.js-user-auth-modal-status'
  )

  // Track currently logged-in user identity (populated after user auth).
  // During first-run setup, wizard admin sign-in can already establish this.
  let currentUser = window.COMPARR_USER || null
  let isGuest = false

  if (passwordForm && loginForm && modeForm) {
    passwordForm.style.display = 'flex'
    modeForm.style.display = 'none'
    loginForm.style.display = 'none'
    if (userAuthForm) userAuthForm.style.display = 'none'
  }

  let skipPasswordPrompt = false
  const shouldReturnToModeSelection =
    sessionStorage.getItem('comparrReturnToModeSelection') === '1'

  if (shouldReturnToModeSelection) {
    sessionStorage.removeItem('comparrReturnToModeSelection')
  }

  if (!skipPasswordPrompt) {
    try {
      await api.verifyAccessPassword('')
      handleVerifiedPassword('')
      skipPasswordPrompt = true
    } catch {
      // Access password is configured; show prompt.
    }
  }

  if (!skipPasswordPrompt) {
    // Handle password verification first
    await new Promise(resolve => {
      const handlePasswordSubmit = async e => {
        e.preventDefault()
        const fd = new FormData(passwordForm)
        const accessPassword = String(fd.get('accessPassword') || '')
        if (!accessPassword) return

        setPasswordError('')

        try {
          await api.verifyAccessPassword(accessPassword)
        } catch (err) {
          setPasswordError(err.message)
          return
        }

        handleVerifiedPassword(accessPassword)
        resolve()
      }
      passwordForm.addEventListener('submit', handlePasswordSubmit)
    })
  }

  // ── User auth step ────────────────────────────────────────────────────────
  // Plex login is always required. Check for an existing session first.
  try {
    const { user } = await api.getAuthUser()
    if (user) {
      currentUser = user
      window.COMPARR_USER = user
      window.USER_HAS_SERVER_ACCESS = user.hasServerAccess !== false
    }
  } catch {
    // no session
  }

  if (!currentUser) {
    // Show Plex-only login screen
    if (userAuthForm) userAuthForm.style.display = 'flex'
    if (userAuthPlex) userAuthPlex.style.display = 'flex'

    await new Promise(resolve => {
      const handleUserLoggedIn = user => {
        currentUser = user
        window.COMPARR_USER = user
        window.USER_HAS_SERVER_ACCESS = user.hasServerAccess !== false
<<<<<<< codex/task-title-ucuzdd
        loadClientConfig()
          .then(() => updateHostManagedSubscriptionServiceOptions())
          .catch(() => {})
=======
>>>>>>> dev
        resolve()
      }

      // ── Plex PIN flow ────────────────────────────────────────────────────
      if (plexSigninBtn) {
        plexSigninBtn.addEventListener('click', async () => {
          plexSigninBtn.disabled = true
          if (plexStatus) {
            plexStatus.textContent = 'Opening Plex login…'
            plexStatus.hidden = false
          }

          let pinId = null
          let popup = null
          let pollTimer = null
          let popupClosedAt = null

          const cleanupPoll = () => {
            if (pollTimer) clearInterval(pollTimer)
            pollTimer = null
            if (popup && !popup.closed) popup.close()
          }

          try {
            const { pinId: id, authUrl } = await api.requestPlexPin()
            pinId = id
            popup = window.open(
              'about:blank',
              '_blank',
              'width=800,height=700,left=100,top=100'
            )

            if (!popup || popup === window || popup.closed) {
              if (plexStatus) {
                plexStatus.textContent =
                  'Popup blocked. Please allow popups and try again.'
              }
              plexSigninBtn.disabled = false
              return
            }
            popup.location.href = authUrl

            if (plexStatus)
              plexStatus.textContent = 'Waiting for Plex approval…'

            let consecutivePollErrors = 0
            pollTimer = setInterval(async () => {
              try {
                const result = await api.pollPlexPin(pinId)
                consecutivePollErrors = 0

                // Accept either explicit success status or a user payload.
                // Some proxy/error edge-cases can strip status while still
                // returning a usable authenticated user object.
                if (result.status === 'success' || result?.user?.username) {
                  cleanupPoll()
                  if (plexStatus) plexStatus.hidden = true
                  handleUserLoggedIn(result.user)
                } else if (
                  result.status === 'expired' ||
                  result.status === 'denied'
                ) {
                  cleanupPoll()
                  plexSigninBtn.disabled = false
                  if (plexStatus) {
                    plexStatus.textContent =
                      result.status === 'denied'
                        ? result.error || 'Access denied.'
                        : 'Plex login expired. Please try again.'
                  }
                } else if (popup.closed) {
                  if (!popupClosedAt) {
                    popupClosedAt = Date.now()
                    if (plexStatus) plexStatus.textContent = 'Verifying login…'
                  }
                  if (Date.now() - popupClosedAt >= 6000) {
                    cleanupPoll()
                    plexSigninBtn.disabled = false
                    if (plexStatus) {
                      plexStatus.textContent = 'Login cancelled.'
                    }
                  }
                }
              } catch {
                consecutivePollErrors += 1

                // If the auth cookie was set but the poll response payload is
                // malformed/blocked by a proxy, /api/auth/me can still confirm
                // the session and let us continue.
                try {
                  const me = await api.getAuthUser()
                  if (me?.user) {
                    cleanupPoll()
                    if (plexStatus) plexStatus.hidden = true
                    handleUserLoggedIn(me.user)
                    return
                  }
                } catch {
                  // continue retrying below
                }

                // Keep retrying transient failures, but don't spin forever.
                if (consecutivePollErrors >= 5) {
                  cleanupPoll()
                  plexSigninBtn.disabled = false
                  if (plexStatus) {
                    plexStatus.textContent =
                      'Could not verify Plex login. Please try again.'
                    plexStatus.hidden = false
                  }
                }
              }
            }, 2000)
          } catch (err) {
            cleanupPoll()
            plexSigninBtn.disabled = false
            if (plexStatus) {
              plexStatus.textContent =
                err.message || 'Could not start Plex login.'
            }
          }
        })
      }
    })
  }

  // Update sidebar user indicator when a user identity is available
  const updateSidebarUser = user => {
    const sidebarUser = document.querySelector('.js-sidebar-user')
    if (!sidebarUser) return

    if (!user) {
      sidebarUser.hidden = true
      return
    }

    const avatarEl = sidebarUser.querySelector('.js-sidebar-user-avatar')
    const nameEl = sidebarUser.querySelector('.js-sidebar-user-name')
    const logoutBtn = sidebarUser.querySelector('.js-sidebar-user-logout')

    if (nameEl) nameEl.textContent = user.username || ''

    if (avatarEl) {
      if (user.avatarUrl) {
        // Use the avatar proxy so images load within CSP
        const base = location.pathname.replace(/\/(index\.html)?$/, '')
        avatarEl.src = `${base}/api/auth/avatar?url=${encodeURIComponent(
          user.avatarUrl
        )}`
        avatarEl.alt = user.username || ''
        avatarEl.hidden = false
        avatarEl.onerror = () => {
          avatarEl.hidden = true
        }
      } else {
        avatarEl.hidden = true
      }
    }

    if (logoutBtn) {
      logoutBtn.onclick = async () => {
        await api.logoutUser()
        await api.logoutAccessSession()
        localStorage.removeItem('user')
        localStorage.removeItem('roomCode')
        localStorage.removeItem('personalUser')
        localStorage.removeItem('personalRoomCode')
        sessionStorage.clear()
        window.location.reload()
      }
    }

    sidebarUser.hidden = false
  }

  if (currentUser) updateSidebarUser(currentUser)

  // ── Helper: compute a deterministic 4-char room code for an authenticated user.
  // Prefixed with 'U' so it never conflicts with guest hex codes (0-9,A-F only).
  const userRoomCode = id => `U${String(id).padStart(3, '0')}`

  // ── Helper: reveal the main app after a successful login, bypassing the
  // mode picker and login form entirely.
  const revealApp = async (name, code, loginApiData) => {
    if (userAuthForm) userAuthForm.style.display = 'none'
    if (modeForm) modeForm.style.display = 'none'
    if (loginForm) loginForm.style.display = 'none'

    await loginSection.animate(
      { opacity: ['1', '0'] },
      { duration: 250, easing: 'ease-in-out', fill: 'both' }
    ).finished
    loginSection.hidden = true

    localStorage.setItem('personalUser', name)
    localStorage.setItem('personalRoomCode', code)
    document.body.dataset.appMode = 'personal'
    document.body.dataset.userType = isGuest ? 'guest' : 'auth'

    document.body.scrollIntoView()

    await Promise.all(
      [...document.querySelectorAll('.rate-section')].map(node => {
        node.hidden = false
        return node.animate(
          { opacity: ['0', '1'] },
          { duration: 250, easing: 'ease-in-out', fill: 'both' }
        ).finished
      })
    )

    initTabs()
    return { ...loginApiData, user: name, roomCode: code, appMode: 'personal' }
  }

  if (currentUser) {
<<<<<<< codex/task-title-ucuzdd
    await loadClientConfig().catch(() => {})
    updateHostManagedSubscriptionServiceOptions()
    applyUserSubscriptions(loadUserSubscriptions(currentUser.id))
=======
>>>>>>> dev
    await maybeRunUserOnboardingWizard(currentUser)
  }

  // ── Auto-login: always runs after Plex auth ──────────────────────────────
  // Room code is deterministic from user ID; returned by the login response.
  if (currentUser) {
    const name = currentUser.username
    const code = currentUser.roomCode || userRoomCode(currentUser.id)

    try {
      let data
      try {
        data = await api.login(name, code, verifiedPassword)
      } catch (err) {
        if (err.code !== 'ACTIVE_SESSION_EXISTS') throw err
        data = await api.login(name, code, verifiedPassword, true)
      }
      return await revealApp(name, code, data)
    } catch (err) {
      console.warn('[auth] Auto-login failed:', err.message)
      // Re-show login screen so user can try again
      if (userAuthForm) userAuthForm.style.display = 'flex'
      if (userAuthPlex) userAuthPlex.style.display = 'flex'
      if (plexStatus) {
        plexStatus.textContent = 'Connection failed. Please try again.'
        plexStatus.hidden = false
      }
    }
  }

  // Plex login is always required — show auth screen and wait indefinitely.
  if (userAuthForm) userAuthForm.style.display = 'flex'
  if (userAuthPlex) userAuthPlex.style.display = 'flex'
  return new Promise(() => {
    /* resolved by Plex login above */
  })
}

// Given server history, append rows to Watch/Pass tab UIs.
// Replace the appendRatedRow function in main.js with this updated version

async function appendRatedRow(
  { basePath, likesList, dislikesList, seenList },
  movie,
  wantsToWatch
) {
  if (!movie) return

  if (wantsToWatch === true) {
    const cardId = `movie-${movie.guid.replace(/[^a-zA-Z0-9]/g, '-')}`

    // Extract TMDb ID or IMDb ID from guid if available
    let movieId = null
    let tmdbId = null // Separate variable for numeric TMDb ID

    if (movie.guid?.startsWith('tmdb://')) {
      movieId = movie.guid.replace('tmdb://', '')
      tmdbId = movieId // TMDb ID is the same as movieId for tmdb:// guids
    } else if (movie.guid?.includes('themoviedb://')) {
      const match = movie.guid.match(/themoviedb:\/\/(\d+)/)
      if (match) {
        movieId = match[1]
        tmdbId = match[1]
      }
    } else if (movie.guid?.includes('imdb://')) {
      const match = movie.guid.match(/imdb:\/\/(tt\d+)/)
      if (match) movieId = match[1] // This will be like "tt1234567"
    } else if (movie.imdbId) {
      movieId = movie.imdbId // Use stored IMDb ID
    }

    // Also check for TMDb ID stored directly on the movie object (from enrichment)
    if (!tmdbId && (movie.tmdbId || movie.tmdb_id)) {
      tmdbId = String(movie.tmdbId || movie.tmdb_id)
    }

    // FALLBACK: Extract TMDb ID from streamingLink if available
    if (!tmdbId && movie.streamingLink) {
      const match = movie.streamingLink.match(/themoviedb\.org\/movie\/(\d+)/)
      if (match) {
        tmdbId = match[1]
        console.log(
          `  Extracted TMDb ID ${tmdbId} from streamingLink for ${movie.title}`
        )
      }
    }

    // Create card for Watch tab
    const card = document.createElement('div')
    card.className = 'watch-card'
    card.dataset.movieId = movieId
    card.dataset.guid = movie.guid

    const normalizedTmdbId = tmdbId ? String(tmdbId) : ''
    const normalizedTitleKey = `${(movie.title || '').trim().toLowerCase()}::${
      movie.year || ''
    }`

    if (likesList) {
      const removedGuids = []
      likesList.querySelectorAll('.watch-card').forEach(existing => {
        const existingTmdb = existing.dataset.tmdbId || ''
        const existingGuid = existing.dataset.guid || ''
        const existingTitleKey = existing.dataset.titleKey || ''

        if (
          (normalizedTmdbId &&
            existingTmdb &&
            existingTmdb === normalizedTmdbId) ||
          (movie.guid && existingGuid && existingGuid === movie.guid) ||
          (normalizedTitleKey &&
            existingTitleKey &&
            existingTitleKey === normalizedTitleKey)
        ) {
          removedGuids.push(existingGuid)
          existing.remove()
        }
      })

      if (removedGuids.length > 0 && likesList.dataset.originalOrder) {
        const order = likesList.dataset.originalOrder.split(',').filter(Boolean)
        likesList.dataset.originalOrder = order
          .filter(g => !removedGuids.includes(g))
          .join(',')
      }
    }

    // Extract numeric TMDb ID for API calls
    if (movie.guid?.startsWith('tmdb://')) {
      card.dataset.tmdbId = movie.guid.replace('tmdb://', '')
    } else if (movie.guid?.includes('themoviedb://')) {
      const match = movie.guid.match(/themoviedb:\/\/(\d+)/)
      if (match) card.dataset.tmdbId = match[1]
    } else if (movie.tmdbId || movie.tmdb_id) {
      // Use TMDb ID from enrichment if available
      card.dataset.tmdbId = String(movie.tmdbId || movie.tmdb_id)
    } else if (movie.streamingLink) {
      // FALLBACK: Extract from streaming link
      const match = movie.streamingLink.match(/themoviedb\.org\/movie\/(\d+)/)
      if (match) card.dataset.tmdbId = match[1]
    }

    // Store filterable data on the card
    card.dataset.genres = JSON.stringify(movie.genre_ids || [])
    card.dataset.languages = JSON.stringify(
      movie.original_language ? [movie.original_language] : []
    )
    card.dataset.countries = JSON.stringify(
      movie.production_countries?.map(c => c.iso_3166_1) || []
    )
    card.dataset.contentRating = movie.contentRating || ''
    card.dataset.runtime = movie.runtime || ''
    card.dataset.voteCount = movie.vote_count || 0
    card.dataset.popularity = movie.popularity || 0
    card.dataset.titleKey = normalizedTitleKey

    if (normalizedTmdbId && !card.dataset.tmdbId) {
      card.dataset.tmdbId = normalizedTmdbId
    }

    const streamingServices = getStreamingServices(movie)
    const watchProviders = getWatchProviders(movie)
    const allServices = [
      ...(streamingServices.subscription || []),
      ...(streamingServices.free || []),
    ]
    const isInPersonalLibrary = allServices.some(s =>
      isPersonalLibraryService(s.name)
    )

    // Check if request service is configured
    const requestServiceConfigured = await checkRequestServiceStatus()

    // Get the streaming link (TMDb watch page with JustWatch deep links)
    const streamingLink = movie.streamingLink || null

    // DEBUG: Check if link exists
    console.log('🧩 DEBUG streamingLink:', streamingLink)
    console.log('🧩 DEBUG movie:', movie.title, movie.guid)

    const addPillHtml =
      !isInPersonalLibrary && tmdbId && requestServiceConfigured
        ? `<button class="provider-pill provider-pill-add add-to-plex-btn" data-movie-id="${movieId}">
            <i class="fas fa-plus"></i>
            <span class="provider-pill-name">Request</span>
          </button>`
        : ''

    const providerPillsHtml = watchProviders
      .map(provider => {
        const logoUrl = provider.logo_path
          ? provider.logo_path.startsWith('/assets/')
            ? `${basePath}${provider.logo_path}`
            : `https://image.tmdb.org/t/p/w92${provider.logo_path}`
          : null
        return `<span class="provider-pill">
          ${
            logoUrl
              ? `<img src="${logoUrl}" alt="${provider.name}" class="provider-pill-logo">`
              : ''
          }
          <span class="provider-pill-name">${provider.name}</span>
        </span>`
      })
      .join('')

    const whereToWatchPillsHtml =
      addPillHtml || watchProviders.length
        ? `<div class="where-to-watch">
            <div class="where-to-watch-title">Where to Watch</div>
            <div class="provider-pill-list">
              ${addPillHtml}${providerPillsHtml}
            </div>
          </div>`
        : ''

    // DEBUG: Log button rendering conditions
    console.log('🧩 Button rendering debug for', movie.title)
    console.log('  isInPersonalLibrary:', isInPersonalLibrary)
    console.log('  movieId:', movieId)
    console.log('  requestServiceConfigured:', requestServiceConfigured)

    // Get metadata for badges - use the same field names as CardView
    const genres = movie.genres || [] // Array of genre names like ["Comedy", "Horror"]
    const genreDisplay =
      genres.length > 0 ? genres.slice(0, 2).join(', ') : null

    // DEBUG: Log all possible runtime fields
    console.log('🧩 Runtime debug for', movie.title)
    console.log('  movie.runtime:', movie.runtime)
    console.log('  movie.tmdbRuntime:', movie.tmdbRuntime)
    console.log('  movie.runtimeMinutes:', movie.runtimeMinutes)
    console.log('  movie.duration:', movie.duration)

    // Try multiple runtime fields like CardView does
    const runtimeMin = (() => {
      const minuteCandidates = [
        Number(movie.runtime),
        Number(movie.tmdbRuntime),
        Number(movie.runtimeMinutes),
      ].filter(v => Number.isFinite(v) && v > 0)
      if (minuteCandidates.length && minuteCandidates[0] < 1000)
        return Math.round(minuteCandidates[0])
      if (Number.isFinite(movie.duration) && movie.duration > 0)
        return Math.round(movie.duration / 60000)
      return null
    })()
    const runtimeDisplay = runtimeMin ? formatRuntime(runtimeMin) : null

    console.log('  🧠 runtimeMin calculated:', runtimeMin)
    console.log('  🧠 runtimeDisplay:', runtimeDisplay)

    const contentRating = movie.contentRating

    // Build the metadata badges section - only show if data exists
    const metadataBadges = []

    if (contentRating) {
      metadataBadges.push(`<span class="metadata-badge badge-rating">
        <i class="fas fa-tag"></i> ${contentRating}
      </span>`)
    }

    if (genreDisplay) {
      metadataBadges.push(`<span class="metadata-badge badge-genre">
        <i class="fas fa-film"></i> ${genreDisplay}
      </span>`)
    }

    if (runtimeDisplay) {
      metadataBadges.push(`<span class="metadata-badge badge-runtime">
        <i class="fas fa-clock"></i> ${runtimeDisplay}
      </span>`)
    }

    const metadataBadgesHTML =
      metadataBadges.length > 0
        ? `<div class="watch-card-metadata">${metadataBadges.join('')}</div>`
        : ''

    card.innerHTML = `
      <!-- Collapsed header (always visible) -->
      <div class="watch-card-collapsed">
        <div class="watch-card-header-compact">
          <div class="watch-card-title-compact">
            ${movie.title} <span class="watch-card-year">(${
      movie.year || 'N/A'
    })</span>
          </div>
          <button class="list-action-btn refresh-movie-btn header-refresh-btn" data-movie-id="${
            tmdbId || movieId || ''
          }" title="Refresh ratings and status">
            <i class="fas fa-sync-alt"></i>
          </button>
          <div class="expand-icon"><i class="fas fa-chevron-down"></i></div>
        </div>
      </div>

      <!-- Expandable details (hidden by default) -->
      <div class="watch-card-details">
        <div class="watch-card-poster">
          <img src="${(() => {
            const p = normalizePoster(movie.art || movie.thumb || '')
            return p.startsWith('http') ? p : basePath + p
          })()}" alt="${movie.title}">
        </div>
        <div class="watch-card-content">
          ${
            movie.summary
              ? `<p class="watch-card-summary">${movie.summary}</p>`
              : ''
          }
          ${metadataBadgesHTML}
          ${(() => {
            const ratingHtml = buildRatingHtml(movie, basePath)
            return ratingHtml
              ? `<div class="watch-card-ratings">${ratingHtml}</div>`
              : ''
          })()}
          ${whereToWatchPillsHtml}

          <!-- Move to other lists buttons -->
          <div class="list-actions">
            <button class="list-action-btn move-to-seen" data-guid="${
              movie.guid
            }" title="Mark as Seen">
              <i class="fas fa-eye"></i>
              <span class="list-action-label">Seen</span>
            </button>
            <button class="list-action-btn move-to-pass" data-guid="${
              movie.guid
            }" title="Move to Pass">
              <i class="fas fa-thumbs-down"></i>
              <span class="list-action-label">Pass</span>
            </button>
          </div>
        </div>
      </div>
    `

    card
      .querySelector('.watch-card-collapsed')
      .addEventListener('click', () => {
        card.classList.toggle('expanded')
      })

    likesList?.appendChild(card)

    if (likesList) {
      const currentOrder = likesList.dataset.originalOrder
        ? likesList.dataset.originalOrder.split(',').filter(Boolean)
        : []
      const filteredOrder = currentOrder.filter(g => g !== movie.guid)
      filteredOrder.push(movie.guid)
      likesList.dataset.originalOrder = filteredOrder.join(',')
      applyCurrentWatchListSort()
    }

    // Add click handler for Request pill
    if (!isInPersonalLibrary && tmdbId && requestServiceConfigured) {
      const addBtn = card.querySelector('.add-to-plex-btn')
      addBtn?.addEventListener('click', () =>
        handleMovieRequest(parseInt(tmdbId), movie.title, addBtn)
      )
    }

    // Add click handler for Refresh button (now in header)
    const refreshBtn = card.querySelector('.refresh-movie-btn')
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async e => {
        e.stopPropagation() // Prevent card expand/collapse toggle
        const icon = refreshBtn.querySelector('i')

        // Show loading state
        refreshBtn.disabled = true
        icon.classList.add('fa-spin')

        try {
          // Get identifier - prefer tmdbId from card, fallback to guid
          const guid = card.dataset.guid
          const cardTmdbId = card.dataset.tmdbId
          const idOrGuid = cardTmdbId || guid

          if (!idOrGuid) {
            throw new Error('No ID available for refresh')
          }

          const response = await fetch(
            `/api/refresh-movie/${encodeURIComponent(idOrGuid)}`
          )
          let data = null
          try {
            data = await response.json()
          } catch {}
          if (!response.ok) {
            console.error('❌Refresh failed', {
              status: response.status,
              rid: data?.rid,
              stage: data?.stage,
              error: data?.error,
            })
            const detail = data?.error ? `: ${data.error}` : ''
            throw new Error('Failed to refresh' + detail)
          } else {
            if (data?.rid) {
              console.debug('Refresh ok', { rid: data.rid })
            }
          }

          // If we didn't have a tmdbId before but got one from enrichment, update the card
          if (!cardTmdbId && data.tmdbId) {
            card.dataset.tmdbId = data.tmdbId
            console.log('✅ Updated card with tmdbId:', data.tmdbId)
          }

          // Update the rating display - always update even if empty to show that refresh completed
          const ratingEl = card.querySelector('.watch-card-ratings')
          if (ratingEl) {
            const ratingHtml = buildRatingHtml(
              data,
              document.body.dataset.basePath || ''
            )
            ratingEl.innerHTML = ratingHtml
          }

          // Update library status / Add pill
          const existingAddBtn = card.querySelector('.add-to-plex-btn')
          const inLibrary =
            data.inLibrary || data.inPlex || data.inEmby || data.inJellyfin

          if (inLibrary && existingAddBtn) {
            // Movie is now in library — remove the add pill
            existingAddBtn.remove()
          } else if (
            !inLibrary &&
            !existingAddBtn &&
            requestServiceConfigured
          ) {
            // Add pill wasn't there before but now we have a tmdbId — inject it
            const finalTmdbId = parseInt(card.dataset.tmdbId)
            if (finalTmdbId) {
              const pillList = card.querySelector('.provider-pill-list')
              const newPillHtml = `<button class="provider-pill provider-pill-add add-to-plex-btn" data-movie-id="${finalTmdbId}">
                <i class="fas fa-plus"></i>
                <span class="provider-pill-name">Add to ${getPersonalLibraryName()}</span>
              </button>`
              if (pillList) {
                pillList.insertAdjacentHTML('afterbegin', newPillHtml)
              } else {
                // Create where-to-watch section if it doesn't exist
                const content = card.querySelector('.watch-card-content')
                if (content) {
                  content.insertAdjacentHTML(
                    'beforeend',
                    `<div class="where-to-watch">
                      <div class="where-to-watch-title">Where to Watch</div>
                      <div class="provider-pill-list">${newPillHtml}</div>
                    </div>`
                  )
                }
              }
              const newAddBtn = card.querySelector('.add-to-plex-btn')
              newAddBtn?.addEventListener('click', () =>
                handleMovieRequest(finalTmdbId, movie.title, newAddBtn)
              )
            }
          }

          // Update streaming services (match Watch-card dropdowns)
          if (data.streamingServices) {
            const dropdowns = card.querySelectorAll('.service-dropdown')
            const subMenu = dropdowns[0]?.querySelector(
              '.service-dropdown-menu'
            )
            const freeMenu = dropdowns[1]?.querySelector(
              '.service-dropdown-menu'
            )

            // SUBSCRIPTION
            if (subMenu) {
              const services = (
                data.streamingServices.subscription || []
              ).filter(s => s.name !== window.PLEX_LIBRARY_NAME)
              subMenu.innerHTML = renderServiceItems(
                services,
                data.streamingLink
              )
            }

            // FREE
            if (freeMenu) {
              const services = data.streamingServices.free || []
              freeMenu.innerHTML = renderServiceItems(
                services,
                data.streamingLink
              )
            }
          }

          // Update Where to Watch provider pills (preserve add pill)
          const whereToWatchContainer = card.querySelector('.where-to-watch')
          const refreshedProviders = getWatchProviders(data)
          const refreshedProviderPills = refreshedProviders
            .map(provider => {
              const bp = document.body.dataset.basePath || ''
              const logoUrl = provider.logo_path
                ? provider.logo_path.startsWith('/assets/')
                  ? `${bp}${provider.logo_path}`
                  : `https://image.tmdb.org/t/p/w92${provider.logo_path}`
                : null
              return `<span class="provider-pill">${
                logoUrl
                  ? `<img src="${logoUrl}" alt="${provider.name}" class="provider-pill-logo">`
                  : ''
              }<span class="provider-pill-name">${provider.name}</span></span>`
            })
            .join('')

          if (whereToWatchContainer) {
            const list = whereToWatchContainer.querySelector(
              '.provider-pill-list'
            )
            const currentAddBtn = card.querySelector('.add-to-plex-btn')
            if (list) {
              // Re-render provider pills, preserving add pill at front
              list.innerHTML =
                (currentAddBtn ? currentAddBtn.outerHTML : '') +
                refreshedProviderPills
              // Re-attach click handler to add pill if present
              const reattachedBtn = list.querySelector('.add-to-plex-btn')
              if (reattachedBtn) {
                const finalTmdbId = parseInt(card.dataset.tmdbId)
                reattachedBtn.addEventListener('click', () =>
                  handleMovieRequest(finalTmdbId, movie.title, reattachedBtn)
                )
              }
            }
            whereToWatchContainer.style.display =
              refreshedProviders.length ||
              card.querySelector('.add-to-plex-btn')
                ? ''
                : 'none'
          }

          // Show success feedback - just change icon
          icon.classList.remove('fa-sync-alt', 'fa-spin')
          icon.classList.add('fa-check')

          setTimeout(() => {
            icon.classList.remove('fa-check')
            icon.classList.add('fa-sync-alt')
            refreshBtn.disabled = false
          }, 2000)
        } catch (err) {
          console.error('❌Failed to refresh movie:', err)
          try {
            const txt = await err?.response?.text?.()
            console.error('❌Server said:', txt)
          } catch {}

          // Show error feedback - just change icon
          icon.classList.remove('fa-spin', 'fa-sync-alt')
          icon.classList.add('fa-exclamation-triangle')

          setTimeout(() => {
            icon.classList.remove('fa-exclamation-triangle')
            icon.classList.add('fa-sync-alt')
            refreshBtn.disabled = false
          }, 2000)
        }
      })
    }

    // Add event listeners for list action buttons
    const moveToSeenBtn = card.querySelector('.move-to-seen')
    const moveToPassBtn = card.querySelector('.move-to-pass')

    if (moveToSeenBtn) {
      console.log('🧠 Attaching Watch->Seen button handler for:', movie.title)
      moveToSeenBtn.addEventListener('click', async e => {
        e.preventDefault()
        e.stopPropagation()
        const guid = moveToSeenBtn.dataset.guid
        console.log('🧠 Watch->Seen button clicked! GUID:', guid)
        await moveMovieBetweenLists(guid, 'watch', 'seen')
      })
    } else {
      console.warn('⚠️ No move-to-seen button found for:', movie.title)
    }

    if (moveToPassBtn) {
      console.log('🧠 Attaching Watch->Pass button handler for:', movie.title)
      moveToPassBtn.addEventListener('click', async e => {
        e.preventDefault()
        e.stopPropagation()
        const guid = moveToPassBtn.dataset.guid
        console.log('🧠 Watch->Pass button clicked! GUID:', guid)
        await moveMovieBetweenLists(guid, 'watch', 'pass')
      })
    } else {
      console.warn('⚠️ No move-to-pass button found for:', movie.title)
    }
  } else if (wantsToWatch === false) {
    // Create card for Pass tab (same format as Watch tab but no streaming)
    const card = document.createElement('div')
    card.className = 'watch-card'
    card.dataset.guid = movie.guid

    // Extract TMDb ID from various possible sources
    if (movie.guid && movie.guid.startsWith('tmdb://')) {
      card.dataset.tmdbId = movie.guid.replace('tmdb://', '')
    } else if (movie.guid && /\/(\d+)$/.test(movie.guid)) {
      const match = movie.guid.match(/\/(\d+)$/)
      if (match) card.dataset.tmdbId = match[1]
    } else if (movie.tmdbId || movie.tmdb_id) {
      card.dataset.tmdbId = String(movie.tmdbId || movie.tmdb_id)
    } else if (movie.guid && /movie\/(\d+)/.test(movie.guid)) {
      const match = movie.guid.match(/movie\/(\d+)/)
      if (match) card.dataset.tmdbId = match[1]
    }

    // Store filterable data on the card
    card.dataset.genres = JSON.stringify(movie.genre_ids || [])
    card.dataset.languages = JSON.stringify(
      movie.original_language ? [movie.original_language] : []
    )
    card.dataset.countries = JSON.stringify(
      movie.production_countries?.map(c => c.iso_3166_1) || []
    )
    card.dataset.contentRating = movie.contentRating || ''
    card.dataset.runtime = movie.runtime || ''
    card.dataset.voteCount = movie.vote_count || 0
    card.dataset.popularity = movie.popularity || 0

    card.innerHTML = `
      <!-- Collapsed header (always visible) -->
      <div class="watch-card-collapsed">
        <div class="watch-card-header-compact">
          <div class="watch-card-title-compact">
            ${movie.title} <span class="watch-card-year">(${
      movie.year || 'N/A'
    })</span>
          </div>
          <div class="expand-icon"><i class="fas fa-chevron-down"></i></div>
        </div>
      </div>
      
      <!-- Expandable details (hidden by default) -->
      <div class="watch-card-details">
        <div class="watch-card-poster">
          <img src="${(() => {
            const p = normalizePoster(movie.art || movie.thumb || '')
            return p.startsWith('http') ? p : basePath + p
          })()}" alt="${movie.title}">
        </div>
  
        <div class="watch-card-content">
          ${
            movie.summary
              ? `<p class="watch-card-summary">${movie.summary}</p>`
              : ''
          }
          ${(() => {
            const ratingHtml = buildRatingHtml(movie, basePath)
            return ratingHtml
              ? `<div class="watch-card-ratings">${ratingHtml}</div>`
              : ''
          })()}
        
          <!-- Move to other lists buttons -->
          <div class="list-actions">
            <button class="list-action-btn move-to-watch" data-guid="${
              movie.guid
            }" title="Move to Watch">
              <i class="fas fa-thumbs-up"></i>
            </button>
            <button class="list-action-btn move-to-seen" data-guid="${
              movie.guid
            }" title="Mark as Seen">
              <i class="fas fa-eye"></i>
            </button>
          </div>
        </div>
      </div>
    `

    // Add event listeners for pass list actions
    card
      .querySelector('.watch-card-collapsed')
      .addEventListener('click', () => {
        card.classList.toggle('expanded')
      })

    const moveToWatchBtn = card.querySelector('.move-to-watch')
    const moveToSeenBtn = card.querySelector('.move-to-seen')

    if (moveToWatchBtn) {
      console.log('🧠 Attaching Pass->Watch button handler for:', movie.title)
      moveToWatchBtn.addEventListener('click', async e => {
        e.preventDefault()
        e.stopPropagation()
        const guid = moveToWatchBtn.dataset.guid
        console.log('🧠 Pass->Watch button clicked! GUID:', guid)
        await moveMovieBetweenLists(guid, 'pass', 'watch')
      })
    } else {
      console.warn('⚠️ No move-to-watch button found for:', movie.title)
    }

    if (moveToSeenBtn) {
      console.log('🧠 Attaching Pass->Seen button handler for:', movie.title)
      moveToSeenBtn.addEventListener('click', async e => {
        e.preventDefault()
        e.stopPropagation()
        const guid = moveToSeenBtn.dataset.guid
        console.log('🧠 Pass->Seen button clicked! GUID:', guid)
        await moveMovieBetweenLists(guid, 'pass', 'seen')
      })
    } else {
      console.warn('⚠️ No move-to-seen button found for:', movie.title)
    }

    dislikesList?.appendChild(card)

    if (dislikesList) {
      const currentOrder = dislikesList.dataset.originalOrder
        ? dislikesList.dataset.originalOrder.split(',').filter(Boolean)
        : []
      const filteredOrder = currentOrder.filter(g => g !== movie.guid)
      filteredOrder.push(movie.guid)
      dislikesList.dataset.originalOrder = filteredOrder.join(',')
      applyCurrentPassListSort()
    }
  } else if (wantsToWatch === null) {
    // Create card for Seen tab (same format as Watch tab but no streaming)
    const card = document.createElement('div')
    card.className = 'watch-card'
    card.dataset.guid = movie.guid

    // Extract TMDb ID from various possible sources
    if (movie.guid && movie.guid.startsWith('tmdb://')) {
      card.dataset.tmdbId = movie.guid.replace('tmdb://', '')
    } else if (movie.guid && /\/(\d+)$/.test(movie.guid)) {
      const match = movie.guid.match(/\/(\d+)$/)
      if (match) card.dataset.tmdbId = match[1]
    } else if (movie.tmdbId || movie.tmdb_id) {
      card.dataset.tmdbId = String(movie.tmdbId || movie.tmdb_id)
    } else if (movie.guid && /movie\/(\d+)/.test(movie.guid)) {
      const match = movie.guid.match(/movie\/(\d+)/)
      if (match) card.dataset.tmdbId = match[1]
    }

    // Store filterable data on the card
    card.dataset.genres = JSON.stringify(movie.genre_ids || [])
    card.dataset.languages = JSON.stringify(
      movie.original_language ? [movie.original_language] : []
    )
    card.dataset.countries = JSON.stringify(
      movie.production_countries?.map(c => c.iso_3166_1) || []
    )
    card.dataset.contentRating = movie.contentRating || ''
    card.dataset.runtime = movie.runtime || ''
    card.dataset.voteCount = movie.vote_count || 0
    card.dataset.popularity = movie.popularity || 0

    card.innerHTML = `
      <!-- Collapsed header (always visible) -->
      <div class="watch-card-collapsed">
        <div class="watch-card-header-compact">
          <div class="watch-card-title-compact">
            ${movie.title} <span class="watch-card-year">(${
      movie.year || 'N/A'
    })</span>
          </div>
          <div class="expand-icon"><i class="fas fa-chevron-down"></i></div>
        </div>
      </div>
      
      <!-- Expandable details (hidden by default) -->
      <div class="watch-card-details">
        <div class="watch-card-poster">
          <img src="${(() => {
            const p = normalizePoster(movie.art || movie.thumb || '')
            return p.startsWith('http') ? p : basePath + p
          })()}" alt="${movie.title}">
        </div>
  
        <div class="watch-card-content">
          ${
            movie.summary
              ? `<p class="watch-card-summary">${movie.summary}</p>`
              : ''
          }
          ${(() => {
            const ratingHtml = buildRatingHtml(movie, basePath)
            return ratingHtml
              ? `<div class="watch-card-ratings">${ratingHtml}</div>`
              : ''
          })()}
        
          <!-- Move to other lists buttons -->
          <div class="list-actions">
            <button class="list-action-btn move-to-watch" data-guid="${
              movie.guid
            }" title="Move to Watch">
              <i class="fas fa-thumbs-up"></i>
            </button>
            <button class="list-action-btn move-to-pass" data-guid="${
              movie.guid
            }" title="Move to Pass">
              <i class="fas fa-thumbs-down"></i>
            </button>
          </div>
        </div>
      </div>
    `

    // Add event listeners for seen list actions
    card
      .querySelector('.watch-card-collapsed')
      .addEventListener('click', () => {
        card.classList.toggle('expanded')
      })

    const moveToWatchBtn = card.querySelector('.move-to-watch')
    const moveToPassBtn = card.querySelector('.move-to-pass')

    if (moveToWatchBtn) {
      console.log('🧠 Attaching Seen->Watch button handler for:', movie.title)
      moveToWatchBtn.addEventListener('click', async e => {
        e.preventDefault()
        e.stopPropagation()
        const guid = moveToWatchBtn.dataset.guid
        console.log('🧠 Seen->Watch button clicked! GUID:', guid)
        await moveMovieBetweenLists(guid, 'seen', 'watch')
      })
    } else {
      console.warn('⚠️ No move-to-watch button found for:', movie.title)
    }

    if (moveToPassBtn) {
      console.log('🧠 Attaching Seen->Pass button handler for:', movie.title)
      moveToPassBtn.addEventListener('click', async e => {
        e.preventDefault()
        e.stopPropagation()
        const guid = moveToPassBtn.dataset.guid
        console.log('🧠 Seen->Pass button clicked! GUID:', guid)
        await moveMovieBetweenLists(guid, 'seen', 'pass')
      })
    } else {
      console.warn('⚠️ No move-to-pass button found for:', movie.title)
    }

    seenList?.appendChild(card)

    if (seenList) {
      const currentOrder = seenList.dataset.originalOrder
        ? seenList.dataset.originalOrder.split(',').filter(Boolean)
        : []
      const filteredOrder = currentOrder.filter(g => g !== movie.guid)
      filteredOrder.push(movie.guid)
      seenList.dataset.originalOrder = filteredOrder.join(',')
      applyCurrentSeenListSort()
    }
  }
}

// Function to move movies between lists
async function moveMovieBetweenLists(guid, fromList, toList) {
  console.log('🔧 moveMovieBetweenLists called:', { guid, fromList, toList })

  try {
    // Check if api is available
    if (!api) {
      console.error('❌ API not available!')
      showNotification('Error: API not initialized')
      return
    }

    // Map list names to wantsToWatch values
    const listToValue = {
      watch: true,
      pass: false,
      seen: null,
    }

    const newValue = listToValue[toList]
    console.log('🧠 New value for wantsToWatch:', newValue)

    // Send the response to update the movie's status
    console.log('🗂️ Sending response to API...')
    await api.respond({ guid, wantsToWatch: newValue })
    console.log('✅ API response sent')

    if (toList === 'watch' && typeof window.refreshMatchesList === 'function') {
      const refreshedMatches = await window.refreshMatchesList()
      const matchedEntry = refreshedMatches?.find(
        match => match.movie?.guid === guid
      )
      const shownGuids = window.shownMatchGuids
      if (
        matchedEntry &&
        matchedEntry.users?.length > 1 &&
        (!shownGuids || !shownGuids.has(guid))
      ) {
        showMatchPopup(matchedEntry)
        shownGuids?.add?.(guid)
      }
    }

    // Get the card to extract movie data from it
    const oldCard = document.querySelector(`.watch-card[data-guid="${guid}"]`)
    if (!oldCard) {
      console.error('❌ Card not found with guid:', guid)
      showNotification('Error: Card not found')
      return
    }
    console.log('🧠 Found old card in DOM')

    // Extract movie data from the card's DOM elements and dataset
    const titleEl = oldCard.querySelector('.watch-card-title-compact')
    const titleText = titleEl ? titleEl.textContent.trim() : ''
    const yearMatch = titleText.match(/\((\d{4})\)/)
    const title = titleText.replace(/\s*\(\d{4}\)\s*$/, '').trim()
    const year = yearMatch ? yearMatch[1] : ''

    const posterImg = oldCard.querySelector('.watch-card-poster img')
    const art = posterImg
      ? posterImg.src
          .replace(/\?w=\d+$/, '')
          .replace(window.location.origin, '')
          .replace(document.body.dataset.basePath || '', '')
      : ''

    const summaryEl = oldCard.querySelector('.watch-card-summary')
    const summary = summaryEl ? summaryEl.textContent.trim() : ''

    const ratingEl = oldCard.querySelector('.watch-card-ratings')
    const rating = ratingEl ? ratingEl.innerHTML : ''

    // Reconstruct movie object from card data
    const movie = {
      guid,
      title,
      year,
      art,
      summary,
      rating,
      // Get additional data from dataset
      genre_ids: oldCard.dataset.genres
        ? JSON.parse(oldCard.dataset.genres)
        : [],
      original_language: oldCard.dataset.languages
        ? JSON.parse(oldCard.dataset.languages)[0]
        : undefined,
      production_countries: oldCard.dataset.countries
        ? JSON.parse(oldCard.dataset.countries).map(c => ({ iso_3166_1: c }))
        : [],
      contentRating: oldCard.dataset.contentRating || '',
      runtime: oldCard.dataset.runtime || '',
      vote_count: parseInt(oldCard.dataset.voteCount) || 0,
      tmdb_id: oldCard.dataset.tmdbId || '',
    }

    console.log('🧠 Reconstructed movie data:', movie.title)

    // Remove from old list
    console.log('🧠 Removing card from old list')
    const oldList = oldCard.closest('.watch-list')
    if (oldList?.dataset.originalOrder) {
      const updatedOrder = oldList.dataset.originalOrder
        .split(',')
        .filter(Boolean)
        .filter(existingGuid => existingGuid !== guid)
      oldList.dataset.originalOrder = updatedOrder.join(',')
    }

    oldCard.remove()

    // Add to new list
    const basePath = ''
    const likesList = document.querySelector('.watch-list.likes-list')
    const dislikesList = document.querySelector('.dislikes-list')
    const seenList = document.querySelector('.seen-list')

    console.log('🧠 Found lists:', {
      likesList: !!likesList,
      dislikesList: !!dislikesList,
      seenList: !!seenList,
    })

    console.log('🧩 Calling appendRatedRow...')
    await appendRatedRow(
      { basePath, likesList, dislikesList, seenList },
      movie,
      newValue
    )
    console.log('✅ appendRatedRow complete')

    // Show notification
    const listNames = {
      watch: 'Watch List',
      pass: 'Pass List',
      seen: 'Seen List',
    }
    showNotification(`Moved "${movie.title}" to ${listNames[toList]}`)
  } catch (error) {
    console.error('❌Error moving movie between lists:', error)
    console.error('Stack trace:', error.stack)
    showNotification('Failed to move movie. Please try again.')
  }
}

function getWatchProviders(movie) {
  const normalizeProviders = providers => {
    const unique = new Map()
    ;(providers || []).forEach(provider => {
      const fallbackName = String(provider?.name || '').trim()
      const isPersonalLibraryProvider =
        provider?.logo_path === '/assets/logos/allvids.svg' ||
        (provider?.id === 0 && provider?.type === 'subscription')

      const resolvedName = isPersonalLibraryProvider
        ? String(fallbackName || window.PLEX_LIBRARY_NAME).trim()
        : fallbackName

      if (!resolvedName) return
      const dedupeKey = resolvedName.toLowerCase()
      if (!unique.has(dedupeKey)) {
        unique.set(dedupeKey, {
          ...provider,
          name: resolvedName,
        })
      }
    })
    return Array.from(unique.values())
  }

  if (Array.isArray(movie.watchProviders) && movie.watchProviders.length > 0) {
    return normalizeProviders(movie.watchProviders)
  }

  const streamingServices = getStreamingServices(movie)
  return normalizeProviders([
    ...(streamingServices.subscription || []),
    ...(streamingServices.free || []),
  ])
}

function getStreamingServices(movie) {
  if (movie.streamingServices) {
    // Handle new format { subscription: [], free: [] }
    if (movie.streamingServices.subscription || movie.streamingServices.free) {
      return movie.streamingServices
    }

    // Handle old array format - treat as subscription
    if (
      Array.isArray(movie.streamingServices) &&
      movie.streamingServices.length > 0
    ) {
      return {
        subscription: movie.streamingServices.map(s =>
          typeof s === 'string'
            ? { id: 0, name: s, logo_path: null, type: 'subscription' }
            : s
        ),
        free: [],
      }
    }
  }

  // Fallback: detect personal library from guid format
  const isPlexGuid =
    !!movie.guid &&
    (movie.guid.includes('plex://') ||
      (!movie.guid.includes('tmdb://') &&
        !movie.guid.includes('imdb://') &&
        !movie.guid.includes('emby://') &&
        !movie.guid.includes('jellyfin://')))
  const isEmbyGuid = !!movie.guid && movie.guid.includes('emby://')
  const isJellyfinGuid = !!movie.guid && movie.guid.includes('jellyfin://')

  if (isPlexGuid || isEmbyGuid || isJellyfinGuid) {
    const libraryName = isEmbyGuid
      ? window.EMBY_LIBRARY_NAME
      : isJellyfinGuid
      ? window.JELLYFIN_LIBRARY_NAME
      : window.PLEX_LIBRARY_NAME
    return {
      subscription: [
        {
          id: 0,
          name: libraryName,
          logo_path: '/assets/logos/allvids.svg',
          type: 'subscription',
        },
      ],
      free: [],
    }
  }

  return { subscription: [], free: [] }
}

// Check if request service is configured (with caching)
let requestServiceConfiguredCache = null
async function checkRequestServiceStatus() {
  // Return cached value if available
  if (requestServiceConfiguredCache !== null) {
    return requestServiceConfiguredCache
  }

  try {
    const response = await fetch('/api/request-service-status')
    if (response.ok) {
      const data = await response.json()
      requestServiceConfiguredCache = data.configured
      return requestServiceConfiguredCache
    }
  } catch (err) {
    console.warn('⚠️ Failed to check request service status:', err)
  }
  requestServiceConfiguredCache = false
  return false
}

// Returns the configured personal library name (Plex > Emby > Jellyfin)
function getPersonalLibraryName() {
  if (window.PLEX_CONFIGURED) return window.PLEX_LIBRARY_NAME
  if (window.EMBY_CONFIGURED) return window.EMBY_LIBRARY_NAME
  if (window.JELLYFIN_CONFIGURED) return window.JELLYFIN_LIBRARY_NAME
  return window.PLEX_LIBRARY_NAME
}

// Returns true if the given service name belongs to any configured personal library
function isPersonalLibraryService(name) {
  if (!name) return false
  return (
    (window.PLEX_CONFIGURED && name === window.PLEX_LIBRARY_NAME) ||
    (window.EMBY_CONFIGURED && name === window.EMBY_LIBRARY_NAME) ||
    (window.JELLYFIN_CONFIGURED && name === window.JELLYFIN_LIBRARY_NAME)
  )
}

// Handle movie request
async function handleMovieRequest(tmdbId, movieTitle, buttonElement) {
  if (!tmdbId) {
    alert('Cannot request this movie: No TMDb ID available')
    return
  }

  buttonElement.disabled = true
  buttonElement.innerHTML =
    '<i class="fas fa-spinner fa-spin"></i><span class="provider-pill-name"> Requesting...</span>'

  try {
    const response = await fetch('/api/request-movie', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ tmdbId }),
    })

    const result = await response.json()

    if (result.success) {
      buttonElement.innerHTML = '<i class="fas fa-check"></i> Requested'
      buttonElement.classList.add('requested')

      showNotification(`"${movieTitle}" has been requested!`)

      // Trigger immediate Radarr cache refresh
      fetch('/api/refresh-radarr-cache', { method: 'POST' }).catch(err =>
        console.error('❌Failed to trigger cache refresh:', err)
      )

      // Check status again in 30 seconds
      setTimeout(refreshWatchListStatus, 30000)
    } else {
      buttonElement.innerHTML = `<i class="fas fa-plus"></i><span class="provider-pill-name"> Request</span>`
      buttonElement.disabled = false
      alert(
        `Failed to request "${movieTitle}": ${
          result.message || 'Unknown error'
        }`
      )
    }
  } catch (err) {
    console.error('❌Error requesting movie:', err)
    buttonElement.innerHTML = `<i class="fas fa-plus"></i> Add to ${getPersonalLibraryName()}`
    buttonElement.disabled = false
    alert(`Error requesting "${movieTitle}".`)
  }
}

// Watch List Auto-Refresh System
let watchListRefreshInterval = null

/**
 * Process a list of items with a concurrency limit to avoid blocking the main thread.
 * @template T,R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, index: number) => Promise<R>} handler
 * @returns {Promise<R[]>}
 */
async function processWithConcurrency(items, limit, handler) {
  const results = new Array(items.length)
  let index = 0

  const workerCount = Math.min(limit, items.length)
  if (workerCount === 0) return results

  async function runNext() {
    while (index < items.length) {
      const currentIndex = index++
      results[currentIndex] = await handler(items[currentIndex], currentIndex)
    }
  }

  await Promise.all(Array.from({ length: workerCount }, runNext))
  return results
}

async function refreshWatchListStatus() {
  console.log('🔧 Refreshing Watch list (Plex + Streaming)...')

  const watchCards = Array.from(document.querySelectorAll('.watch-card'))
  const results = await processWithConcurrency(watchCards, 6, async card => {
    const addBtn = card.querySelector('.add-to-plex-btn')
    const tmdbId = parseInt(card.dataset.tmdbId)

    if (!tmdbId) {
      return { plexUpdated: 0, streamingUpdated: 0 }
    }

    let plexUpdated = 0
    let streamingUpdated = 0

    try {
      // 1. Check Plex status (if button exists)
      if (addBtn) {
        const plexResponse = await fetch(
          `/api/check-movie-status?tmdbId=${tmdbId}`
        )
        if (plexResponse.ok) {
          const plexData = await plexResponse.json()

          if (plexData.inLibrary || plexData.inPlex) {
            const btnToRemove = card.querySelector('.add-to-plex-btn')
            if (btnToRemove) {
              btnToRemove.remove()
              plexUpdated++
            }
          }
        }
      }

      // 2. Check if request pill should show "Requested" instead
      const currentAddBtn = card.querySelector('.add-to-plex-btn')
      if (currentAddBtn && !currentAddBtn.classList.contains('requested')) {
        const requestResponse = await fetch(
          `/api/check-request-status?tmdbId=${tmdbId}`
        )
        if (requestResponse.ok) {
          const requestData = await requestResponse.json()

          if (requestData.pending || requestData.processing) {
            currentAddBtn.innerHTML =
              '<i class="fas fa-check"></i><span class="provider-pill-name"> Requested</span>'
            currentAddBtn.classList.add('requested')
            currentAddBtn.disabled = true
          }
        }
      }

      // 3. Refresh streaming data (for ALL movies, even if in Plex)
      const streamingResponse = await fetch(`/api/refresh-streaming/${tmdbId}`)
      if (streamingResponse.ok) {
        const streamingData = await streamingResponse.json()

        // **NEW: Also update the persisted data**
        await fetch(`/api/update-persisted-movie/${tmdbId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            streamingServices: streamingData.streamingServices,
            streamingLink: streamingData.streamingLink,
          }),
        })

        // Update SUBSCRIPTION and FREE dropdown menus (current Watch-card markup)
        const dropdowns = card.querySelectorAll('.service-dropdown')
        const subMenu = dropdowns[0]?.querySelector('.service-dropdown-menu')
        const freeMenu = dropdowns[1]?.querySelector('.service-dropdown-menu')

        // SUBSCRIPTION
        if (subMenu) {
          const services = (
            streamingData.streamingServices?.subscription || []
          ).filter(s => !isPersonalLibraryService(s.name))
          subMenu.innerHTML = renderServiceItems(
            services,
            streamingData.streamingLink
          )
          streamingUpdated++
        }

        // FREE
        if (freeMenu) {
          const services = streamingData.streamingServices?.free || []
          freeMenu.innerHTML = renderServiceItems(
            services,
            streamingData.streamingLink
          )
        }
      }
    } catch (err) {
      console.error(`❌Failed to refresh TMDb ID ${tmdbId}:`, err)
    }

    return { plexUpdated, streamingUpdated }
  })

  const { plexUpdatedCount, streamingUpdatedCount } = results.reduce(
    (acc, result = {}) => {
      acc.plexUpdatedCount += result.plexUpdated || 0
      acc.streamingUpdatedCount += result.streamingUpdated || 0
      return acc
    },
    { plexUpdatedCount: 0, streamingUpdatedCount: 0 }
  )

  // Show notification with results
  const messages = []
  if (plexUpdatedCount > 0) {
    messages.push(`${plexUpdatedCount} now in Plex`)
  }
  if (streamingUpdatedCount > 0) {
    messages.push(`${streamingUpdatedCount} streaming updated`)
  }

  if (messages.length > 0) {
    console.log(`✅ ${messages.join(', ')}`)
    showNotification(messages.join(' • '))
  } else {
    showNotification('Everything up to date!')
  }

  // Reset expand/collapse button state after refresh
  if (typeof resetExpandCollapseButton === 'function') {
    resetExpandCollapseButton()
  }
}

// Helper to render service items
function renderServiceItems(services, streamingLink) {
  if (!services || services.length === 0) {
    return '<div class="service-item">None available</div>'
  }

  const basePath = document.body.dataset.basePath || ''

  if (streamingLink) {
    return `
      <a href="${streamingLink}" target="_blank" rel="noopener noreferrer" class="service-link-wrapper">
        ${services
          .map(s => {
            const logoUrl = s.logo_path
              ? s.logo_path.startsWith('/assets/')
                ? `${basePath}${s.logo_path}`
                : `https://image.tmdb.org/t/p/original${s.logo_path}`
              : null

            return `<div class="service-item">
            ${
              logoUrl
                ? `<img src="${logoUrl}" alt="${s.name}" class="service-logo-small">`
                : ''
            }
            <span>${s.name}</span>
          </div>`
          })
          .join('')}
        <div class="service-footer">
          <i class="fas fa-external-link-alt"></i> View on JustWatch
        </div>
      </a>
    `
  }

  return services
    .map(s => {
      const logoUrl = s.logo_path
        ? s.logo_path.startsWith('/assets/')
          ? `${basePath}${s.logo_path}`
          : `https://image.tmdb.org/t/p/original${s.logo_path}`
        : null

      return `<div class="service-item">
      ${
        logoUrl
          ? `<img src="${logoUrl}" alt="${s.name}" class="service-logo-small">`
          : ''
      }
      <span>${s.name}</span>
    </div>`
    })
    .join('')
}

function startWatchListAutoRefresh() {
  if (watchListRefreshInterval) {
    clearInterval(watchListRefreshInterval)
  }

  // Check once daily for both Plex and JustWatch
  watchListRefreshInterval = setInterval(checkDailyRefresh, 60 * 60 * 1000) // Check every hour
  console.log('🔧 Started daily auto-refresh check (hourly)')

  // Run initial check when tab opens
  checkDailyRefresh()
}

// Daily refresh tracking
const LAST_PLEX_REFRESH_KEY = 'lastPlexRefresh'
const LAST_JUSTWATCH_REFRESH_KEY = 'lastJustWatchRefresh'
const ONE_DAY = 24 * 60 * 60 * 1000

function shouldRefreshPlex() {
  const lastRefresh = localStorage.getItem(LAST_PLEX_REFRESH_KEY)
  if (!lastRefresh) return true

  const timeSinceRefresh = Date.now() - parseInt(lastRefresh)
  return timeSinceRefresh > ONE_DAY
}

function shouldRefreshJustWatch() {
  const lastRefresh = localStorage.getItem(LAST_JUSTWATCH_REFRESH_KEY)
  if (!lastRefresh) return true

  const timeSinceRefresh = Date.now() - parseInt(lastRefresh)
  return timeSinceRefresh > ONE_DAY
}

async function checkDailyRefresh() {
  const needsPlex = shouldRefreshPlex()
  const needsJustWatch = shouldRefreshJustWatch()

  if (!needsPlex && !needsJustWatch) {
    console.log('✅ Daily refreshes already completed')
    return
  }

  console.log(
    `🗂️ Daily auto-refresh: Plex=${needsPlex}, JustWatch=${needsJustWatch}`
  )

  const watchCards = Array.from(document.querySelectorAll('.watch-card'))

  const results = await processWithConcurrency(watchCards, 6, async card => {
    const addBtn = card.querySelector('.add-to-plex-btn')
    const tmdbId = parseInt(card.dataset.tmdbId)

    if (!tmdbId) {
      return { plexUpdated: 0, streamingUpdated: 0 }
    }

    let plexUpdated = 0
    let streamingUpdated = 0

    try {
      // 1. Check Plex status (if needed)
      if (needsPlex && addBtn) {
        const plexResponse = await fetch(
          `/api/check-movie-status?tmdbId=${tmdbId}`
        )
        if (plexResponse.ok) {
          const plexData = await plexResponse.json()

          if (plexData.inLibrary || plexData.inPlex) {
            const btnToRemove = card.querySelector('.add-to-plex-btn')
            if (btnToRemove) {
              btnToRemove.remove()
              plexUpdated++
            }
          }
        }
      }

      // 2. Refresh streaming data (if needed)
      if (needsJustWatch) {
        const streamingResponse = await fetch(
          `/api/refresh-streaming/${tmdbId}`
        )
        if (streamingResponse.ok) {
          const streamingData = await streamingResponse.json()

          // Update subscription services
          const subContainer = card.querySelector(
            '.streaming-subscription .service-list'
          )
          if (subContainer) {
            const services = streamingData.streamingServices.subscription || []
            subContainer.innerHTML = renderServiceItems(
              services,
              streamingData.streamingLink
            )
            streamingUpdated++
          }

          // Update free services
          const freeContainer = card.querySelector(
            '.streaming-free .service-list'
          )
          if (freeContainer) {
            const services = streamingData.streamingServices.free || []
            freeContainer.innerHTML = renderServiceItems(
              services,
              streamingData.streamingLink
            )
          }
        }
      }
    } catch (err) {
      console.error(`❌Failed to refresh TMDb ID ${tmdbId}:`, err)
    }

    return { plexUpdated, streamingUpdated }
  })

  const { plexUpdatedCount, streamingUpdatedCount } = results.reduce(
    (acc, result = {}) => {
      acc.plexUpdatedCount += result.plexUpdated || 0
      acc.streamingUpdatedCount += result.streamingUpdated || 0
      return acc
    },
    { plexUpdatedCount: 0, streamingUpdatedCount: 0 }
  )

  // Update timestamps
  if (needsPlex) {
    localStorage.setItem(LAST_PLEX_REFRESH_KEY, Date.now().toString())
    if (plexUpdatedCount > 0) {
      console.log(
        `✅ Daily Plex refresh: ${plexUpdatedCount} movie(s) now in Plex`
      )
    }
  }

  if (needsJustWatch) {
    localStorage.setItem(LAST_JUSTWATCH_REFRESH_KEY, Date.now().toString())
    if (streamingUpdatedCount > 0) {
      console.log(
        `✅ Daily JustWatch refresh: ${streamingUpdatedCount} movie(s) updated`
      )
    }
  }

  // Show notification if anything updated
  const messages = []
  if (plexUpdatedCount > 0) {
    messages.push(`${plexUpdatedCount} now in Plex`)
  }
  if (streamingUpdatedCount > 0) {
    messages.push(`${streamingUpdatedCount} streaming updated`)
  }

  if (messages.length > 0) {
    showNotification('Daily refresh: ' + messages.join(' • '))
  }
}

function stopWatchListAutoRefresh() {
  if (watchListRefreshInterval) {
    clearInterval(watchListRefreshInterval)
    watchListRefreshInterval = null
    console.log('🔧 Stopped Watch list auto-refresh')
  }
}

function showNotification(message) {
  let notification = document.getElementById('watch-notification')
  if (!notification) {
    notification = document.createElement('div')
    notification.id = 'watch-notification'
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: linear-gradient(135deg, #10b981, #059669);
      color: white;
      padding: 1rem 1.5rem;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      z-index: 10000;
      font-weight: 600;
      display: none;
      animation: slideIn 0.3s ease;
    `
    document.body.appendChild(notification)

    const style = document.createElement('style')
    style.textContent = `
      @keyframes slideIn {
        from { transform: translateX(400px); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
    `
    document.head.appendChild(style)
  }

  notification.textContent = message
  notification.style.display = 'block'

  setTimeout(() => {
    notification.style.display = 'none'
  }, 3000)
}

function showNoMoviesNotification() {
  let notification = document.getElementById('no-movies-notification')
  if (!notification) {
    notification = document.createElement('div')
    notification.id = 'no-movies-notification'
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: linear-gradient(135deg, #ef4444, #dc2626);
      color: white;
      padding: 1rem 2rem;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      z-index: 10000;
      font-weight: 600;
      display: none;
      animation: slideDown 0.3s ease;
      text-align: center;
      max-width: 400px;
    `
    document.body.appendChild(notification)

    const style = document.createElement('style')
    style.textContent = `
      @keyframes slideDown {
        from { transform: translate(-50%, -100px); opacity: 0; }
        to { transform: translate(-50%, 0); opacity: 1; }
      }
    `
    document.head.appendChild(style)
  }

  notification.innerHTML = `
    <i class="fas fa-exclamation-triangle"></i> 
    No more movies found with current filters.<br>
    <small style="font-weight: 400; opacity: 0.9;">Try adjusting your filters or resetting them.</small>
  `
  notification.style.display = 'block'

  setTimeout(() => {
    notification.style.opacity = '0'
    notification.style.transition = 'opacity 0.3s'
    setTimeout(() => {
      notification.style.display = 'none'
      notification.style.opacity = '1'
    }, 300)
  }, 5000)
}

/* -------------------- main ---------------------- */
const main = async () => {
  console.log('🚀 Comparr main() starting')
  initializePasswordVisibilityToggles()
  const CARD_STACK_SIZE = 4

  api = new ComparrAPI()

  // Load startup config before login so fresh installs can run the setup wizard
  // before showing room-code/name prompts.
  window.PLEX_LIBRARY_NAME = 'My Plex Library'
  window.EMBY_LIBRARY_NAME = 'My Emby Library'
  window.JELLYFIN_LIBRARY_NAME = 'My Jellyfin Library'
  window.PLEX_CONFIGURED = false
  window.EMBY_CONFIGURED = false
  window.JELLYFIN_CONFIGURED = false
  window.TMDB_CONFIGURED = false
  window.SETUP_WIZARD_COMPLETED = false
  await loadClientConfig()
  await setupSettingsUI()
  await ensureInitialSourceSetup()

  console.log('⏳ Waiting for login...')
  const loginData = await login(api)
  console.log('✅ Login successful:', loginData)
  const {
    matches,
    rated,
    user: userName,
    roomCode,
    appMode = 'group',
  } = loginData

  document.body.classList.add('is-logged-in')
  document.body.dataset.appMode = appMode
  // Re-fetch client config now that we know the user's server access level,
  // so PERSONAL_MEDIA_SOURCES and subscription options are up-to-date.
  await loadClientConfig().catch(() => {})
  await hydrateSettingsUiIfAuthorized()

  sessionStorage.setItem('userName', userName)
  sessionStorage.setItem('roomCode', roomCode)
  displayPreferences = loadDisplayPreferences()
  applyDisplayPreferencesToNavigation(displayPreferences)

  // Kick off profile settings fetch so subscriptions can be applied once filterState is ready
  const _profileSettingsFetch = fetch('/api/profile/settings')
    .then(r => r.ok ? r.json() : null)
    .catch(() => null)

  // Track movies this user has already rated (to prevent showing them again)
  const normalizeGuid = value => {
    if (value == null) return ''
    return String(value).trim()
  }

  const ratedGuids = new Set(
    rated.map(r => normalizeGuid(r.movie?.guid ?? r.guid)).filter(Boolean)
  )
  console.log(`⚠️ User has already rated ${ratedGuids.size} movies`)

  const getNormalizedTmdbId = movie => {
    if (!movie) return null

    const directId =
      movie.tmdbId ?? movie.tmdb_id ?? movie.tmdbID ?? movie.tmdbid
    if (directId) {
      return String(directId).trim()
    }

    if (typeof movie.guid === 'string') {
      const guidMatch =
        movie.guid.match(/tmdb:\/\/(\d+)/i) ||
        movie.guid.match(/themoviedb:\/\/(\d+)/i)
      if (guidMatch) return guidMatch[1]
    }

    if (typeof movie.streamingLink === 'string') {
      const linkMatch = movie.streamingLink.match(
        /themoviedb\.org\/movie\/(\d+)/i
      )
      if (linkMatch) return linkMatch[1]
    }

    if (movie.ids?.tmdb) {
      return String(movie.ids.tmdb).trim()
    }

    return null
  }

  // ALSO track rated TMDb IDs for cross-format matching (Plex GUID vs TMDb GUID)
  // Seen items are now slim (no .movie) — fall back to the tmdbId field.
  const ratedTmdbIds = new Set()
  for (const r of rated) {
    const normalizedGuid = normalizeGuid(r.movie?.guid ?? r.guid)
    if (normalizedGuid) ratedGuids.add(normalizedGuid)

    let normalized = getNormalizedTmdbId(r.movie)
    if (!normalized && r.tmdbId != null) normalized = String(r.tmdbId)
    if (normalized) ratedTmdbIds.add(normalized)
  }
  console.log(
    `🎬 Tracking ${ratedTmdbIds.size} unique TMDb IDs from rated movies`
  )

  const matchesView = new MatchesView(matches)
  const shownMatchGuids = new Set()
  window.shownMatchGuids = shownMatchGuids

  const refreshMatchesList = async () => {
    try {
      const result = await api.getMatches(roomCode, userName)
      matchesView.matches = result.matches || []
      matchesView.render()
      return matchesView.matches
    } catch (error) {
      console.error('Failed to refresh matches:', error)
      return matchesView.matches
    }
  }

  window.refreshMatchesList = refreshMatchesList

  // Match event listener - show popup and add to matches view
  api.addEventListener('match', e => {
    const matchData = e.data
    matchesView.add(matchData)
    if (matchData?.movie?.guid && !shownMatchGuids.has(matchData.movie.guid)) {
      showMatchPopup(matchData)
      shownMatchGuids.add(matchData.movie.guid)
    }
    // Browser notification when tab is in background
    if (
      document.visibilityState === 'hidden' &&
      window._comparrNotificationsGranted
    ) {
      const title = matchData?.movie?.title || 'a movie'
      new Notification("It's a Match! 🎬", {
        body: `You matched on "${title}". Open Comparr to see it.`,
        icon: document.querySelector('link[rel="icon"]')?.href || undefined,
      })
    }
  })

  // ===== BROWSER NOTIFICATIONS (group mode) =====
  const showNotificationsBlockedWarning = () => {
    if (document.getElementById('notifications-blocked-banner')) return
    const banner = document.createElement('div')
    banner.id = 'notifications-blocked-banner'
    banner.style.cssText = `
      background: #78350f;
      color: #fef3c7;
      font-size: 0.82rem;
      padding: 0.5rem 1rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
    `
    const msg = document.createElement('span')
    msg.textContent =
      'Browser notifications are blocked — you may miss match alerts in this session.'
    const dismiss = document.createElement('button')
    dismiss.textContent = '✕'
    dismiss.setAttribute('aria-label', 'Dismiss')
    dismiss.style.cssText =
      'background:none;border:none;color:inherit;cursor:pointer;font-size:1rem;padding:0;flex-shrink:0;'
    dismiss.addEventListener('click', () => banner.remove())
    banner.appendChild(msg)
    banner.appendChild(dismiss)
    const swipePanel = document.getElementById('tab-swipe')
    swipePanel?.prepend(banner)
  }

  if (appMode === 'group' && 'Notification' in window) {
    if (Notification.permission === 'granted') {
      window._comparrNotificationsGranted = true
    } else if (Notification.permission === 'denied') {
      showNotificationsBlockedWarning()
    } else {
      Notification.requestPermission().then(permission => {
        window._comparrNotificationsGranted = permission === 'granted'
        if (permission === 'denied') {
          showNotificationsBlockedWarning()
        }
      })
    }
  }

  // ===== ROOM MEMBER LIST =====
  const roomMembersWidget = document.querySelector('.js-room-members-widget')
  const roomMembersList = document.querySelector('.js-room-members-list')

  const updateRoomMembers = members => {
    if (!roomMembersWidget || !roomMembersList || appMode !== 'group') return
    roomMembersList.textContent = members.join(', ')
    roomMembersWidget.hidden = members.length === 0
  }

  // Populate from loginResponse members field
  if (loginData.members && appMode === 'group') {
    updateRoomMembers(loginData.members)
  }

  api.addEventListener('roomMembers', e => {
    updateRoomMembers(e.data?.members ?? [])
  })

  // ===== MATCHES TAB =====
  // Each user has a stable invite code. Enter a friend's code to send a
  // request — they must accept before matches are visible.

  const matchesMyCodeEl = document.querySelector('.js-matches-my-code')
  const matchesCopyBtn = document.querySelector('.js-matches-copy-btn')
  const matchesRefreshBtn = document.querySelector('.js-matches-refresh-btn')
  const matchesAddForm = document.querySelector('.js-matches-add-form')
  const matchesFriendInput = document.querySelector('.js-matches-friend-input')
  const matchesStatus = document.querySelector('.js-matches-status')
  const matchesFriendsList = document.querySelector('.js-matches-friends-list')
  const matchesFriendsHeading = document.querySelector(
    '.js-matches-friends-heading'
  )
  const matchesPendingSection = document.querySelector(
    '.js-matches-pending-section'
  )
  const matchesPendingList = document.querySelector('.js-matches-pending-list')

  // Server-sharing consent modal elements
  const sharingModal = document.querySelector('.js-server-sharing-modal')
  const sharingModalBody = document.querySelector(
    '.js-server-sharing-modal-body'
  )
  const sharingAcceptBtn = document.querySelector('.js-server-sharing-accept')
  const sharingDeclineBtn = document.querySelector('.js-server-sharing-decline')
  let _sharingPromptQueue = []

  const setMatchesStatus = (msg, isError = false) => {
    if (!matchesStatus) return
    matchesStatus.textContent = msg
    matchesStatus.hidden = !msg
    matchesStatus.style.color = isError
      ? 'var(--color-accent-danger, #f87171)'
      : 'var(--color-text-muted, inherit)'
  }

  const renderMatchMovie = (movie, friendName) => {
    const posterUrl = movie.art || movie.thumb || ''
    const imgHtml = posterUrl
      ? `<div class="watch-card-poster"><img src="${
          posterUrl.startsWith('http') ? posterUrl : basePath + posterUrl
        }" alt="${movie.title} poster" loading="lazy" /></div>`
      : ''
    return `
      <div class="watch-card" data-guid="${movie.guid}">
        <div class="watch-card-collapsed">
          <div class="watch-card-header-compact">
            <div class="watch-card-title-compact">
              ${movie.title}${
      movie.year ? ` <span class="watch-card-year">(${movie.year})</span>` : ''
    }
            </div>
            <div class="expand-icon"><i class="fas fa-chevron-down"></i></div>
          </div>
        </div>
        <div class="watch-card-details">
          ${imgHtml}
          <div class="watch-card-content">
            ${
              movie.summary
                ? `<p class="watch-card-summary">${movie.summary}</p>`
                : ''
            }
            <div class="watch-card-metadata">
              <i class="fas fa-heart"></i>
              You and ${friendName} both want to watch this
            </div>
          </div>
        </div>
      </div>`
  }

  // Show server-sharing consent modal for one pending prompt at a time.
  const processNextSharingPrompt = () => {
    if (!sharingModal || !_sharingPromptQueue.length) {
      if (sharingModal) sharingModal.hidden = true
      return
    }
    const { friendUserId, friendName } = _sharingPromptQueue[0]
    if (sharingModalBody) {
      sharingModalBody.textContent = `${friendName} wants to share their media library with you.`
    }
    sharingModal.hidden = false
    sharingModal.dataset.friendUserId = friendUserId

    const resolve = async accepts => {
      sharingModal.hidden = true
      _sharingPromptQueue.shift()
      try {
        await fetch(`${basePath}/api/matches/resolve-server-prompt`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ friendUserId, acceptsServer: accepts }),
        })
      } catch {
        /* ignore */
      }
      processNextSharingPrompt()
    }

    sharingAcceptBtn?.addEventListener('click', () => resolve(true), {
      once: true,
    })
    sharingDeclineBtn?.addEventListener('click', () => resolve(false), {
      once: true,
    })
  }

  const renderPendingRequests = connections => {
    if (!matchesPendingSection || !matchesPendingList) return
    const pending = connections.filter(
      c => c.status === 'pending' && c.friendUserId
    )
    const incomingPending = connections.filter(c => c.status === 'pending')
    matchesPendingSection.hidden = !incomingPending.length
    if (!incomingPending.length) {
      matchesPendingList.innerHTML = ''
      return
    }

    matchesPendingList.innerHTML = incomingPending
      .map(
        conn => `
      <div class="matches-pending-card" data-friend-id="${conn.friendUserId}">
        <span class="matches-pending-name">${conn.friendName}</span>
        <div class="matches-pending-actions">
          <label class="matches-pending-share-label">
            <input type="checkbox" class="js-pending-share-check" />
            Share my library
          </label>
          <button type="button" class="btn-primary js-pending-accept" data-friend-id="${conn.friendUserId}">Accept</button>
          <button type="button" class="btn-ghost js-pending-decline" data-friend-id="${conn.friendUserId}">Decline</button>
        </div>
      </div>`
      )
      .join('')

    matchesPendingList.querySelectorAll('.js-pending-accept').forEach(btn => {
      btn.addEventListener('click', async () => {
        const friendId = Number(btn.dataset.friendId)
        const card = btn.closest('.matches-pending-card')
        const sharesServer =
          card?.querySelector('.js-pending-share-check')?.checked ?? false
        btn.disabled = true
        try {
          const res = await fetch(`${basePath}/api/matches/accept`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ requesterId: friendId, sharesServer }),
          })
          if (!res.ok) throw new Error()
          await loadMatchesData()
        } catch {
          btn.disabled = false
        }
      })
    })

    matchesPendingList.querySelectorAll('.js-pending-decline').forEach(btn => {
      btn.addEventListener('click', async () => {
        const friendId = Number(btn.dataset.friendId)
        btn.disabled = true
        try {
          await fetch(`${basePath}/api/matches/decline`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ requesterId: friendId }),
          })
          await loadMatchesData()
        } catch {
          btn.disabled = false
        }
      })
    })
  }

  const renderFriends = connections => {
    if (!matchesFriendsList || !matchesFriendsHeading) return
    const accepted = connections.filter(c => c.status === 'accepted')
    if (!accepted.length) {
      matchesFriendsHeading.hidden = true
      matchesFriendsList.innerHTML = ''
      return
    }
    matchesFriendsHeading.hidden = false

    // Queue server-sharing prompts
    const prompts = accepted.filter(
      c => c.serverPromptPending && c.friendSharesServerWithMe
    )
    for (const c of prompts) {
      if (!_sharingPromptQueue.some(q => q.friendUserId === c.friendUserId)) {
        _sharingPromptQueue.push({
          friendUserId: c.friendUserId,
          friendName: c.friendName,
        })
      }
    }
    if (_sharingPromptQueue.length && sharingModal?.hidden !== false) {
      processNextSharingPrompt()
    }

    matchesFriendsList.innerHTML = accepted
      .map(conn => {
        const {
          friendUserId,
          friendName,
          sharesServer,
          friendSharesServerWithMe,
          matches,
        } = conn
        const matchCount = matches ? matches.length : 0
        const matchLabel =
          matchCount === 0
            ? 'No matches yet — keep swiping!'
            : matchCount === 1
            ? '1 match'
            : `${matchCount} matches`
        const moviesHtml = matchCount
          ? matches.map(m => renderMatchMovie(m, friendName)).join('')
          : `<p class="matches-empty-note">No matches yet — keep swiping!</p>`
        const sharingBadge = friendSharesServerWithMe
          ? `<span class="matches-friend-sharing-badge" title="Sharing their library with you"><i class="fas fa-server"></i></span>`
          : ''
        return `
        <div class="matches-friend-card" data-friend-id="${friendUserId}">
          <div class="matches-friend-header">
            <span class="matches-friend-name">${friendName}</span>
            ${sharingBadge}
            <span class="matches-friend-count">${matchLabel}</span>
            <label class="matches-share-toggle" title="Share your library with ${friendName}">
              <input type="checkbox" class="js-friend-share-toggle" data-friend-id="${friendUserId}" ${
          sharesServer ? 'checked' : ''
        } />
              <span class="matches-share-toggle-label">Share my library</span>
            </label>
            <button class="matches-remove-btn" type="button" data-friend-id="${friendUserId}"
              title="Remove ${friendName}" aria-label="Remove ${friendName}">
              <i class="fas fa-times"></i>
            </button>
          </div>
          <div class="matches-friend-movies">${moviesHtml}</div>
        </div>`
      })
      .join('')

    // Wire sharing toggles
    matchesFriendsList
      .querySelectorAll('.js-friend-share-toggle')
      .forEach(toggle => {
        toggle.addEventListener('change', async () => {
          const friendId = Number(toggle.dataset.friendId)
          try {
            await fetch(`${basePath}/api/matches/sharing`, {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                friendUserId: friendId,
                sharesServer: toggle.checked,
              }),
            })
          } catch {
            toggle.checked = !toggle.checked
          }
        })
      })

    // Wire remove buttons
    matchesFriendsList.querySelectorAll('.matches-remove-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const friendId = Number(btn.dataset.friendId)
        if (!friendId) return
        btn.disabled = true
        try {
          await fetch(`${basePath}/api/matches/remove-user`, {
            method: 'DELETE',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ friendUserId: friendId }),
          })
          await loadMatchesData()
        } catch {
          btn.disabled = false
        }
      })
    })

    // Expand/collapse match cards
    matchesFriendsList.querySelectorAll('.watch-card').forEach(card => {
      const collapsed = card.querySelector('.watch-card-collapsed')
      const details = card.querySelector('.watch-card-details')
      if (!collapsed || !details) return
      collapsed.addEventListener('click', () => {
        const isOpen = card.classList.contains('is-expanded')
        card.classList.toggle('is-expanded', !isOpen)
        details.hidden = isOpen
      })
      details.hidden = true
    })
  }

  const loadMatchesData = async () => {
    try {
      const codeRes = await fetch(`${basePath}/api/user/code`)
      const codeData = await codeRes.json().catch(() => ({}))
      if (matchesMyCodeEl) matchesMyCodeEl.textContent = codeData.code || '——'

      const connRes = await fetch(`${basePath}/api/matches/connections`)
      const connData = await connRes.json().catch(() => ({}))
      const connections = connData.connections || []
      renderPendingRequests(connections)
      renderFriends(connections)
    } catch (err) {
      console.warn('[matches] Failed to load matches data:', err)
    }
  }

  // Copy invite code
  if (matchesCopyBtn) {
    matchesCopyBtn.addEventListener('click', () => {
      const code = matchesMyCodeEl?.textContent?.trim() || ''
      if (!code || code === '——' || code === '······') return
      navigator.clipboard
        .writeText(code)
        .then(() => {
          matchesCopyBtn.innerHTML = '<i class="fas fa-check"></i>'
          setTimeout(() => {
            matchesCopyBtn.innerHTML = '<i class="fas fa-copy"></i>'
          }, 2000)
        })
        .catch(() => {})
    })
  }

  // Refresh code
  if (matchesRefreshBtn) {
    matchesRefreshBtn.addEventListener('click', async () => {
      if (
        !confirm(
          'Refresh your code? This will remove all your current friend connections and generate a new code.'
        )
      )
        return
      matchesRefreshBtn.disabled = true
      try {
        const res = await fetch(`${basePath}/api/user/refresh`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || 'Could not refresh code.')
        if (matchesMyCodeEl) matchesMyCodeEl.textContent = data.code || '——'
        renderPendingRequests([])
        renderFriends([])
        setMatchesStatus('New code generated — share it with your friends.')
      } catch (err) {
        setMatchesStatus(err.message, true)
      } finally {
        matchesRefreshBtn.disabled = false
      }
    })
  }

  // Add friend (sends pending request)
  if (matchesAddForm) {
    matchesAddForm.addEventListener('submit', async e => {
      e.preventDefault()
      const friendCode = (matchesFriendInput?.value || '').trim().toUpperCase()
      if (!friendCode) return
      setMatchesStatus('Sending friend request…')
      try {
        const res = await fetch(`${basePath}/api/matches/add`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ friendCode }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || 'Could not add friend.')
        if (matchesFriendInput) matchesFriendInput.value = ''
        setMatchesStatus(
          `Request sent to ${data.friendName}! They need to accept.`
        )
        setTimeout(() => setMatchesStatus(''), 5000)
        await loadMatchesData()
      } catch (err) {
        setMatchesStatus(err.message, true)
      }
    })
  }

  // Load data when matches tab becomes active
  window.initCompareTab = () => {
    if (window._matchesTabInitialized) return
    window._matchesTabInitialized = true
    loadMatchesData()
  }

  // ===== PROFILE SETTINGS (settings tab — My Profile section) =====

  const profileInviteCode = document.querySelector('.js-settings-invite-code')
  const profileCopyInvite = document.querySelector('.js-settings-copy-invite')
<<<<<<< codex/task-title-ucuzdd
  const profileServerForm = document.querySelector('.js-profile-server-form')
  const profileServerType = document.querySelector('.js-profile-server-type')
  const profileServerFields = document.querySelectorAll(
    '.js-profile-server-fields'
  )
  const profileTokenLabel = document.querySelector('.js-profile-token-label')
  const profileServerStatus = document.querySelector(
    '.js-profile-server-status'
  )

  if (profileServerForm) {
    profileServerForm.hidden = true
    if (profileServerStatus) {
      profileServerStatus.textContent =
        'Personal media server settings are managed by the instance admin.'
      profileServerStatus.hidden = false
    }
  }

  // Show or hide server-specific fields based on selected type
  const updateProfileServerFields = () => {
    const type = profileServerType?.value || ''
    profileServerFields.forEach(el => (el.hidden = !type))
    if (profileTokenLabel) {
      profileTokenLabel.textContent = type === 'plex' ? 'Plex Token' : 'API Key'
    }
  }

  if (profileServerType) {
    profileServerType.addEventListener('change', updateProfileServerFields)
    updateProfileServerFields()
  }
=======
  const profileSubCheckboxes = document.querySelectorAll('.js-profile-sub-checkbox')
  const profileSubSaveBtn = document.querySelector('.js-profile-subscriptions-save')
  const profileSubStatus = document.querySelector('.js-profile-subscriptions-status')
>>>>>>> dev

  // Populate invite code from already-loaded currentUser or fetch it
  const hydrateInviteCode = code => {
    if (profileInviteCode && code) profileInviteCode.textContent = code
  }

  if (currentUser?.inviteCode) hydrateInviteCode(currentUser.inviteCode)

  if (profileCopyInvite) {
    profileCopyInvite.addEventListener('click', async () => {
      const code = profileInviteCode?.textContent?.trim()
      if (!code || code === '······') return
      try {
        await navigator.clipboard.writeText(code)
        const icon = profileCopyInvite.querySelector('i')
        if (icon) {
          icon.className = 'fas fa-check'
          setTimeout(() => { icon.className = 'fas fa-copy' }, 1500)
        }
      } catch {
        // clipboard not available; silently ignore
      }
    })
  }

  const hydrateProfileSubscriptions = subs => {
    const subsSet = new Set(Array.isArray(subs) ? subs : [])
    profileSubCheckboxes.forEach(cb => {
      cb.checked = subsSet.has(cb.value)
    })
  }

  // Load profile settings from server and hydrate subscriptions + invite code
  const loadProfileSettings = async () => {
    try {
      const res = await fetch('/api/profile/settings')
      if (!res.ok) return
      const { settings, inviteCode } = await res.json()
      if (inviteCode) hydrateInviteCode(inviteCode)
      if (settings?.subscriptions) {
        try {
          hydrateProfileSubscriptions(JSON.parse(settings.subscriptions))
        } catch { /* ignore parse errors */ }
      }
    } catch (err) {
      console.warn('[profile] Failed to load profile settings:', err.message)
    }
  }

  if (profileSubSaveBtn) {
    profileSubSaveBtn.addEventListener('click', async () => {
      const selected = Array.from(profileSubCheckboxes)
        .filter(cb => cb.checked)
        .map(cb => cb.value)
      if (profileSubStatus) {
        profileSubStatus.textContent = 'Saving…'
        profileSubStatus.hidden = false
      }
      try {
        const res = await fetch('/api/profile/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscriptions: JSON.stringify(selected) }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.error || `HTTP ${res.status}`)
        }
        // Apply the user's chosen subscriptions to the active swipe filter
        applyUserSubscriptions(selected)
        if (profileSubStatus) {
          profileSubStatus.textContent = '✅ Saved!'
          profileSubStatus.hidden = false
          setTimeout(() => { if (profileSubStatus) profileSubStatus.hidden = true }, 2500)
        }
      } catch (err) {
        if (profileSubStatus) {
          profileSubStatus.textContent = `Error: ${err.message}`
          profileSubStatus.hidden = false
        }
      }
    })
  }

  // Load profile settings when the settings tab first becomes active
  let _profileSettingsLoaded = false
  const origInitSettingsTab = window.initSettingsTab
  window.initSettingsTab = () => {
    if (origInitSettingsTab) origInitSettingsTab()
    if (!_profileSettingsLoaded) {
      _profileSettingsLoaded = true
      loadProfileSettings()
    }
  }

  // Also load immediately if invite code not yet populated (e.g. page reload)
  if (!currentUser?.inviteCode) loadProfileSettings()

  // ===== RECOMMENDATIONS TAB =====
  let recommendationsLoaded = false

  const buildRecommendationCard = movie => {
    const basePath = document.body.dataset.basePath || ''
    const likesList = document.querySelector('.likes-list')
    const dislikesList = document.querySelector('.dislikes-list')
    const seenList = document.querySelector('.seen-list')

    // Build the same metadata badges as the Watch list
    const genres = movie.genres || []
    const genreDisplay =
      genres.length > 0 ? genres.slice(0, 2).join(', ') : null
    const contentRating = movie.contentRating || null
    const runtimeMin = (() => {
      const candidates = [
        Number(movie.runtime),
        Number(movie.runtimeMinutes),
      ].filter(v => Number.isFinite(v) && v > 0)
      return candidates.length && candidates[0] < 1000
        ? Math.round(candidates[0])
        : null
    })()
    const runtimeDisplay = runtimeMin ? formatRuntime(runtimeMin) : null

    const metadataBadges = []
    if (contentRating)
      metadataBadges.push(
        `<span class="metadata-badge badge-rating"><i class="fas fa-tag"></i> ${contentRating}</span>`
      )
    if (genreDisplay)
      metadataBadges.push(
        `<span class="metadata-badge badge-genre"><i class="fas fa-film"></i> ${genreDisplay}</span>`
      )
    if (runtimeDisplay)
      metadataBadges.push(
        `<span class="metadata-badge badge-runtime"><i class="fas fa-clock"></i> ${runtimeDisplay}</span>`
      )
    const metadataBadgesHTML =
      metadataBadges.length > 0
        ? `<div class="watch-card-metadata">${metadataBadges.join('')}</div>`
        : ''

    const ratingHtml = buildRatingHtml(movie, basePath)
    const ratingSection = ratingHtml
      ? `<div class="watch-card-ratings">${ratingHtml}</div>`
      : ''

    const watchProviders = getWatchProviders(movie)
    const providerPillsHtml = watchProviders
      .map(provider => {
        const logoUrl = provider.logo_path
          ? provider.logo_path.startsWith('/assets/')
            ? `${basePath}${provider.logo_path}`
            : `https://image.tmdb.org/t/p/w92${provider.logo_path}`
          : null
        return `<span class="provider-pill">
          ${
            logoUrl
              ? `<img src="${logoUrl}" alt="${provider.name}" class="provider-pill-logo">`
              : ''
          }
          <span class="provider-pill-name">${provider.name}</span>
        </span>`
      })
      .join('')
    const whereToWatchHtml = watchProviders.length
      ? `<div class="where-to-watch">
          <div class="where-to-watch-title">Where to Watch</div>
          <div class="provider-pill-list">${providerPillsHtml}</div>
        </div>`
      : ''

    const posterUrl = (() => {
      const p = normalizePoster(movie.art || '')
      return p ? (p.startsWith('http') ? p : basePath + p) : ''
    })()

    const card = document.createElement('div')
    card.className = 'watch-card'
    card.dataset.tmdbId = String(movie.tmdbId || '')
    card.dataset.guid = movie.guid || ''

    card.innerHTML = `
      <div class="watch-card-collapsed">
        <div class="watch-card-header-compact">
          <div class="watch-card-title-compact">
            ${movie.title} <span class="watch-card-year">(${
      movie.year || 'N/A'
    })</span>
          </div>
          <div class="expand-icon"><i class="fas fa-chevron-down"></i></div>
        </div>
      </div>
      <div class="watch-card-details">
        <div class="watch-card-poster">
          ${
            posterUrl
              ? `<img src="${posterUrl}" alt="${movie.title}" loading="lazy" decoding="async">`
              : ''
          }
        </div>
        <div class="watch-card-content">
          ${
            movie.summary
              ? `<p class="watch-card-summary">${movie.summary}</p>`
              : ''
          }
          ${metadataBadgesHTML}
          ${ratingSection}
          ${whereToWatchHtml}
          <div class="list-actions">
            <button class="list-action-btn move-to-seen rec-action-seen" data-guid="${
              movie.guid
            }" title="Mark as Seen">
              <i class="fas fa-eye"></i>
              <span class="list-action-label">Seen</span>
            </button>
            <button class="list-action-btn move-to-watch rec-action-watch" data-guid="${
              movie.guid
            }" title="Add to Watch list">
              <i class="fas fa-thumbs-up"></i>
              <span class="list-action-label">Watch</span>
            </button>
            <button class="list-action-btn move-to-pass rec-action-pass" data-guid="${
              movie.guid
            }" title="Pass">
              <i class="fas fa-thumbs-down"></i>
              <span class="list-action-label">Pass</span>
            </button>
          </div>
        </div>
      </div>
    `

    card
      .querySelector('.watch-card-collapsed')
      .addEventListener('click', () => {
        card.classList.toggle('expanded')
      })

    card
      .querySelector('.rec-action-watch')
      .addEventListener('click', async e => {
        e.stopPropagation()
        await api.respond({ guid: movie.guid, wantsToWatch: true })
        await appendRatedRow(
          { basePath, likesList, dislikesList, seenList },
          movie,
          true
        )
        card.remove()
      })

    card
      .querySelector('.rec-action-pass')
      .addEventListener('click', async e => {
        e.stopPropagation()
        await api.respond({ guid: movie.guid, wantsToWatch: false })
        await appendRatedRow(
          { basePath, likesList, dislikesList, seenList },
          movie,
          false
        )
        card.remove()
      })

    card
      .querySelector('.rec-action-seen')
      .addEventListener('click', async e => {
        e.stopPropagation()
        await appendRatedRow(
          { basePath, likesList, dislikesList, seenList },
          movie,
          null
        )
        card.remove()
      })

    return card
  }

  const loadRecommendations = async () => {
    const list = document.querySelector('.js-recommendations-list')
    const hint = document.querySelector('.js-recommendations-hint')
    if (!list) return

    // Pick up to 3 recently watched movies to seed recommendations
    const watchCards = Array.from(
      document.querySelectorAll('.likes-list .watch-card')
    )
    const seedIds = watchCards
      .slice(0, 3)
      .map(c => c.dataset.tmdbId)
      .filter(Boolean)

    if (seedIds.length === 0) {
      if (hint) hint.hidden = false
      return
    }
    if (hint) hint.hidden = true

    list.innerHTML = '<p class="stats-empty">Loading recommendations…</p>'

    const seenGuids = new Set([
      ...Array.from(document.querySelectorAll('.likes-list .watch-card')).map(
        c => c.dataset.guid
      ),
      ...Array.from(
        document.querySelectorAll('.dislikes-list .watch-card')
      ).map(c => c.dataset.guid),
      ...Array.from(document.querySelectorAll('.seen-list .watch-card')).map(
        c => c.dataset.guid
      ),
    ])

    const seenTmdbIds = new Set([
      ...Array.from(document.querySelectorAll('.likes-list .watch-card')).map(
        c => c.dataset.tmdbId
      ),
      ...Array.from(
        document.querySelectorAll('.dislikes-list .watch-card')
      ).map(c => c.dataset.tmdbId),
      ...Array.from(document.querySelectorAll('.seen-list .watch-card')).map(
        c => c.dataset.tmdbId
      ),
    ])

    const allMovies = new Map()
    await Promise.all(
      seedIds.map(async tmdbId => {
        try {
          const { movies } = await api.getRecommendations(tmdbId)
          for (const m of movies) {
            if (
              !allMovies.has(m.tmdbId) &&
              !seenGuids.has(m.guid) &&
              !seenTmdbIds.has(String(m.tmdbId))
            ) {
              allMovies.set(m.tmdbId, m)
            }
          }
        } catch {
          // ignore per-seed failures
        }
      })
    )

    list.innerHTML = ''
    if (allMovies.size === 0) {
      list.innerHTML =
        '<p class="stats-empty">No new recommendations found. Rate more movies to improve suggestions.</p>'
      return
    }

    for (const movie of allMovies.values()) {
      list.appendChild(buildRecommendationCard(movie))
    }
    recommendationsLoaded = true
  }

  document
    .getElementById('recommendations-refresh-btn')
    ?.addEventListener('click', () => {
      recommendationsLoaded = false
      loadRecommendations()
    })

  window.refreshRecommendationsTab = () => {
    if (!recommendationsLoaded) loadRecommendations()
  }

  // ===== STATS TAB =====
  const refreshStatsTab = () => {
    const watchCards = document.querySelectorAll('.likes-list .watch-card')
    const passCards = document.querySelectorAll('.dislikes-list .watch-card')
    const seenCards = document.querySelectorAll('.seen-list .watch-card')

    const watchCount = watchCards.length
    const passCount = passCards.length
    const seenCount = seenCards.length
    const totalRated = watchCount + passCount + seenCount

    const setValue = (sel, val) => {
      const el = document.querySelector(sel)
      if (el) el.textContent = val
    }
    setValue('.js-stat-total-rated', totalRated)
    setValue('.js-stat-watch-count', watchCount)
    setValue('.js-stat-pass-count', passCount)
    setValue('.js-stat-seen-count', seenCount)

    // Genre breakdown from Watch list
    const genreBar = document.querySelector('.js-stats-genre-bars')
    if (genreBar) {
      const genreCounts = {}
      watchCards.forEach(card => {
        const genreText =
          card.querySelector('.watch-card-genres')?.textContent || ''
        genreText.split(',').forEach(g => {
          const genre = g.trim()
          if (genre) genreCounts[genre] = (genreCounts[genre] || 0) + 1
        })
      })

      const sortedGenres = Object.entries(genreCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)

      if (sortedGenres.length === 0) {
        genreBar.innerHTML =
          '<p class="stats-empty">Rate some movies to see your genre breakdown.</p>'
      } else {
        const max = sortedGenres[0][1]
        genreBar.innerHTML = sortedGenres
          .map(
            ([genre, count]) => `
          <div class="stats-genre-row">
            <span class="stats-genre-name">${genre}</span>
            <div class="stats-genre-bar-track">
              <div class="stats-genre-bar-fill" style="width:${Math.round(
                (count / max) * 100
              )}%"></div>
            </div>
            <span class="stats-genre-count">${count}</span>
          </div>
        `
          )
          .join('')
      }
    }

    // Average ratings from Watch list
    const avgEl = document.querySelector('.js-stats-avg-ratings')
    if (avgEl && watchCount > 0) {
      const imdbScores = []
      const tmdbScores = []

      watchCards.forEach(card => {
        const html = card.innerHTML
        const imdbMatch =
          html.match(/imdb\.svg[^>]*>[\s\S]*?<\/img>\s*([\d.]+)/) ||
          html.match(/imdb[^>]*>\s*([\d.]+)/)
        const tmdbMatch =
          html.match(/tmdb\.svg[^>]*>[\s\S]*?<\/img>\s*([\d.]+)/) ||
          html.match(/tmdb[^>]*>\s*([\d.]+)/)
        if (imdbMatch) imdbScores.push(parseFloat(imdbMatch[1]))
        if (tmdbMatch) tmdbScores.push(parseFloat(tmdbMatch[1]))
      })

      const avg = arr =>
        arr.length
          ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1)
          : null

      const avgImdb = avg(imdbScores)
      const avgTmdb = avg(tmdbScores)

      if (!avgImdb && !avgTmdb) {
        avgEl.innerHTML = '<p class="stats-empty">No rating data available.</p>'
      } else {
        avgEl.innerHTML = [
          avgImdb
            ? `<div class="stats-avg-row"><span>IMDb avg</span><strong>${avgImdb}</strong></div>`
            : '',
          avgTmdb
            ? `<div class="stats-avg-row"><span>TMDb avg</span><strong>${avgTmdb}</strong></div>`
            : '',
        ].join('')
      }
    } else if (avgEl) {
      avgEl.innerHTML = '<p class="stats-empty">No watch list data yet.</p>'
    }
  }

  window.refreshStatsTab = refreshStatsTab

  api.addEventListener('message', e => {
    const data = e.data
    if (data.type === 'matchRemoved') {
      const { guid } = data.payload
      const matchIndex = matchesView.matches.findIndex(
        m => m.movie.guid === guid
      )
      if (matchIndex !== -1) {
        matchesView.matches.splice(matchIndex, 1)
        matchesView.render()
      }
    }
  })

  // --- IMDb Import WebSocket handlers ---
  const imdbImportProgress = document.getElementById('imdb-import-progress')
  const imdbImportStatus = document.getElementById('imdb-import-status')
  const imdbImportBar = document.getElementById('imdb-import-bar')
  const imdbImportDetail = document.getElementById(
    'imdb-import-progress-detail'
  )
  const imdbImportCancelBtn = document.getElementById('imdb-import-cancel-btn')
  const imdbImportCancelActions = document.getElementById(
    'imdb-import-cancel-actions'
  )
  const imdbImportCancelMsg = document.getElementById('imdb-import-cancel-msg')
  const imdbImportKeepBtn = document.getElementById('imdb-import-keep-btn')
  const imdbImportRemoveBtn = document.getElementById('imdb-import-remove-btn')
  let isImdbImportActive = false
  let currentImportRoomCode = null
  let currentImportUserName = null
  // Track GUIDs added during the current import session for optional rollback
  let sessionImportedGuids = []

  function setImdbImportProgressText(
    headline,
    {
      total = 0,
      processed = 0,
      imported = 0,
      skipped = 0,
      notFoundOnTmdb = 0,
      duplicates = 0,
      apiErrors = 0,
      stage = '',
    } = {}
  ) {
    const safeTotal = Number.isFinite(total) ? total : 0
    const safeProcessed = Number.isFinite(processed) ? processed : 0
    const safeImported = Number.isFinite(imported) ? imported : 0
    const safeSkipped = Number.isFinite(skipped) ? skipped : 0
    const pct =
      safeTotal > 0 ? Math.round((safeProcessed / safeTotal) * 100) : 0

    if (imdbImportStatus) imdbImportStatus.textContent = headline
    if (imdbImportDetail) {
      const stageText = stage === 'looking_up_tmdb' ? 'Looking up TMDb...' : ''
      const parts = [
        stageText,
        `Processed ${safeProcessed}/${safeTotal} (${pct}%)`,
        `Imported ${safeImported}`,
      ]
      if (safeSkipped > 0) {
        const skipParts = []
        if (Number.isFinite(notFoundOnTmdb) && notFoundOnTmdb > 0)
          skipParts.push(`${notFoundOnTmdb} not on TMDb`)
        if (Number.isFinite(duplicates) && duplicates > 0)
          skipParts.push(`${duplicates} already imported`)
        if (Number.isFinite(apiErrors) && apiErrors > 0)
          skipParts.push(`${apiErrors} errors`)
        const skipDetail =
          skipParts.length > 0 ? ` (${skipParts.join(', ')})` : ''
        parts.push(`Skipped ${safeSkipped}${skipDetail}`)
      }
      imdbImportDetail.textContent = parts.filter(Boolean).join(' · ')
    }
    if (imdbImportBar) imdbImportBar.style.width = `${pct}%`
  }

  function resetImdbImportProgress() {
    if (imdbImportProgress) imdbImportProgress.style.display = 'none'
    if (imdbImportStatus) imdbImportStatus.textContent = 'Importing...'
    if (imdbImportDetail) imdbImportDetail.textContent = ''
    if (imdbImportBar) {
      imdbImportBar.style.width = '0%'
      imdbImportBar.classList.remove('error')
    }
    if (imdbImportCancelBtn) {
      imdbImportCancelBtn.disabled = false
      imdbImportCancelBtn.style.display = ''
    }
    if (imdbImportCancelActions) imdbImportCancelActions.style.display = 'none'
    sessionImportedGuids = []
  }

  // Ensure stale UI state does not survive navigation/reconnect.
  resetImdbImportProgress()

  if (imdbImportCancelBtn) {
    imdbImportCancelBtn.addEventListener('click', async () => {
      if (!isImdbImportActive) return
      imdbImportCancelBtn.disabled = true
      if (imdbImportStatus) imdbImportStatus.textContent = 'Cancelling...'
      try {
        const apiBase = document.body.dataset.basePath || ''
        await fetch(`${apiBase}/api/imdb-import-cancel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomCode: currentImportRoomCode,
            userName: currentImportUserName,
          }),
        })
      } catch (_) {
        // ignore network errors — server will handle cleanup
      }
    })
  }

  if (imdbImportKeepBtn) {
    imdbImportKeepBtn.addEventListener('click', () => {
      sessionImportedGuids = []
      if (typeof window.refreshImdbImportHistory === 'function') {
        window.refreshImdbImportHistory()
      }
      setTimeout(() => resetImdbImportProgress(), 300)
    })
  }

  if (imdbImportRemoveBtn) {
    imdbImportRemoveBtn.addEventListener('click', async () => {
      const guidsToRemove = [...sessionImportedGuids]
      if (!guidsToRemove.length) {
        resetImdbImportProgress()
        return
      }
      imdbImportKeepBtn.disabled = true
      imdbImportRemoveBtn.disabled = true
      if (imdbImportCancelMsg)
        imdbImportCancelMsg.textContent = 'Removing imported movies...'

      try {
        const apiBase = document.body.dataset.basePath || ''
        await fetch(`${apiBase}/api/imdb-import-rollback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomCode: currentImportRoomCode,
            userName: currentImportUserName,
            guids: guidsToRemove,
          }),
        })
      } catch (_) {
        // best-effort; reload proceeds regardless
      }

      // Reload so the Seen list reflects the rolled-back state
      sessionImportedGuids = []
      setTimeout(() => window.location.reload(), 500)
    })
  }

  api.addEventListener('message', e => {
    const data = e.data

    // Handle import progress updates
    if (data.type === 'imdbImportProgress') {
      const {
        status,
        total,
        processed,
        imported,
        skipped,
        notFoundOnTmdb = 0,
        duplicates = 0,
        apiErrors = 0,
        stage,
      } = data.payload

      if (
        !['started', 'processing', 'completed', 'cancelled'].includes(status)
      ) {
        return
      }

      if (status === 'started') {
        isImdbImportActive = true
        sessionImportedGuids = []
        if (imdbImportProgress) imdbImportProgress.style.display = 'block'
        if (imdbImportBar) {
          imdbImportBar.style.width = '5%'
          imdbImportBar.classList.remove('error')
        }
        setImdbImportProgressText(`Queued ${total} rows. Starting import...`, {
          total,
          processed: 0,
          imported: 0,
          skipped: 0,
        })
        if (imdbImportCancelBtn) {
          imdbImportCancelBtn.disabled = false
          imdbImportCancelBtn.style.display = ''
        }
        if (imdbImportCancelActions)
          imdbImportCancelActions.style.display = 'none'
      } else if (status === 'processing') {
        isImdbImportActive = true
        if (imdbImportProgress) imdbImportProgress.style.display = 'block'
        const pct = total > 0 ? Math.round((processed / total) * 100) : 0
        setImdbImportProgressText(
          `Importing... ${processed}/${total} (${pct}%)`,
          {
            total,
            processed,
            imported,
            skipped,
            notFoundOnTmdb,
            duplicates,
            apiErrors,
            stage,
          }
        )
      } else if (status === 'completed') {
        if (!isImdbImportActive) return

        isImdbImportActive = false
        if (imdbImportCancelBtn) imdbImportCancelBtn.style.display = 'none'
        if (imdbImportCancelActions)
          imdbImportCancelActions.style.display = 'none'
        if (imdbImportStatus)
          imdbImportStatus.textContent = `Done! ${imported} imported, ${skipped} skipped. Refreshing...`
        if (imdbImportBar) imdbImportBar.style.width = '100%'

        // Show final skip breakdown in detail line before page reloads
        if (imdbImportDetail && skipped > 0) {
          const skipParts = []
          if (notFoundOnTmdb > 0)
            skipParts.push(`${notFoundOnTmdb} not on TMDb`)
          if (duplicates > 0) skipParts.push(`${duplicates} already imported`)
          if (apiErrors > 0) skipParts.push(`${apiErrors} errors`)
          imdbImportDetail.textContent =
            skipParts.length > 0
              ? `Skipped breakdown: ${skipParts.join(', ')}`
              : ''
        } else if (imdbImportDetail) {
          imdbImportDetail.textContent = ''
        }

        const imdbCsvUploadBtn = document.getElementById('imdb-csv-upload-btn')
        if (imdbCsvUploadBtn) imdbCsvUploadBtn.disabled = false

        // Log out the access session and wipe cached credentials so the user
        // lands on the access password screen with a blank login form instead
        // of being auto-authenticated back into the same room/user (which
        // would cause every movie to be reported as "already imported").
        setTimeout(async () => {
          await api.logoutUser()
          await api.logoutAccessSession()
          localStorage.removeItem('user')
          localStorage.removeItem('roomCode')
          localStorage.removeItem('personalUser')
          localStorage.removeItem('personalRoomCode')
          sessionStorage.clear()
          window.location.reload()
        }, 2500)
      } else if (status === 'cancelled') {
        isImdbImportActive = false
        if (imdbImportCancelBtn) imdbImportCancelBtn.style.display = 'none'
        if (imdbImportBar) imdbImportBar.classList.add('error')
        if (imdbImportDetail) imdbImportDetail.textContent = ''

        const count = sessionImportedGuids.length
        if (imdbImportStatus) imdbImportStatus.textContent = 'Import cancelled.'

        const imdbCsvUploadBtn = document.getElementById('imdb-csv-upload-btn')
        if (imdbCsvUploadBtn) imdbCsvUploadBtn.disabled = false

        // Show keep/remove choice only if movies were actually imported
        if (count > 0 && imdbImportCancelActions && imdbImportCancelMsg) {
          if (imdbImportKeepBtn) imdbImportKeepBtn.disabled = false
          if (imdbImportRemoveBtn) imdbImportRemoveBtn.disabled = false
          imdbImportCancelMsg.textContent = `${count} movie${
            count === 1 ? ' was' : 's were'
          } imported before cancellation. What would you like to do?`
          imdbImportCancelActions.style.display = 'block'
        } else {
          // Nothing imported — just clear
          if (typeof window.refreshImdbImportHistory === 'function') {
            window.refreshImdbImportHistory()
          }
          setTimeout(() => resetImdbImportProgress(), 4000)
        }
      }
    }

    // Handle individual movie imports — track GUID for potential rollback,
    // but do NOT insert into the DOM here. Rapid-fire DOM mutations for
    // hundreds/thousands of movies hangs the browser renderer. The page
    // reloads when the import completes so the Seen list renders in one pass.
    if (data.type === 'imdbImportMovie') {
      const { movie, progress } = data.payload
      if (movie?.guid) sessionImportedGuids.push(movie.guid)
      if (progress?.total > 0 && isImdbImportActive) {
        const pct = Math.round((progress.processed / progress.total) * 100)
        setImdbImportProgressText(
          `Importing... ${progress.processed}/${progress.total} (${pct}%)`,
          progress
        )
      }
    }
  })

  const likesList = document.querySelector('.likes-list')
  const dislikesList = document.querySelector('.dislikes-list')
  const seenList = document.querySelector('.seen-list')
  const basePath = document.body.dataset.basePath || ''
  const movieByGuid = new Map()

  const savedSwipeDefaults = loadSavedSwipeFilterDefaults()

  // Filter state - consolidated into one declaration
  const filterState = savedSwipeDefaults || createDefaultSwipeFilterState()

  filterState.availability = normalizeAvailabilityState(
    filterState.availability
  )
  filterState.showPlexOnly = deriveShowPlexOnlyFromAvailability(
    filterState.availability,
    filterState.showPlexOnly
  )

  // Expose filterState globally for swipe filter modal
  window.filterState = filterState

  // Apply saved user subscription preferences to the swipe filter
  _profileSettingsFetch.then(data => {
    if (!data?.settings?.subscriptions) return
    try {
      const subs = JSON.parse(data.settings.subscriptions)
      if (Array.isArray(subs) && subs.length) applyUserSubscriptions(subs)
    } catch { /* ignore parse errors */ }
  })

  // Filter UI elements
  // const streamingCheckboxes = document.querySelectorAll('#streaming-checkboxes input[type="checkbox"]')  // COMMENTED OUT
  const currentYear = new Date().getFullYear()
  const yearMinInput = document.getElementById('year-min')
  const yearMaxInput = document.getElementById('year-max')

  function syncFilterUIWithState() {
    if (yearMinInput) yearMinInput.value = filterState.yearRange.min.toString()
    if (yearMaxInput) yearMaxInput.value = filterState.yearRange.max.toString()

    document
      .querySelectorAll('.genre-checkbox input[type="checkbox"]')
      .forEach(checkbox => {
        checkbox.checked = filterState.genres.includes(checkbox.value)
      })
    updateGenreButton(filterState.genres)

    document
      .querySelectorAll('.language-checkbox input[type="checkbox"]')
      .forEach(checkbox => {
        checkbox.checked = filterState.languages.includes(checkbox.value)
      })
    updateLanguageButton(filterState.languages)

    document
      .querySelectorAll('.country-checkbox input[type="checkbox"]')
      .forEach(checkbox => {
        checkbox.checked = filterState.countries.includes(checkbox.value)
      })
    updateCountryButton(filterState.countries)

    document
      .querySelectorAll('.rating-checkbox input[type="checkbox"]')
      .forEach(checkbox => {
        checkbox.checked = filterState.contentRatings.includes(checkbox.value)
      })
    updateContentRatingButton(filterState.contentRatings)

    const voteCountSliderEl = document.getElementById('vote-count')
    const voteCountValueEl = document.getElementById('vote-count-value')
    if (voteCountSliderEl)
      voteCountSliderEl.value = String(filterState.voteCount)
    if (voteCountValueEl)
      voteCountValueEl.textContent = filterState.voteCount.toLocaleString()
  }

  if (yearMinInput && yearMaxInput) {
    yearMinInput.value = filterState.yearRange.min
    yearMinInput.max = currentYear
    yearMaxInput.value = currentYear
    yearMaxInput.max = currentYear + 2
  }

  syncFilterUIWithState()

  /* COMMENTED OUT - Streaming services handlers (replaced with Where to Watch toggle)
  streamingCheckboxes.forEach(checkbox => {
    checkbox.addEventListener('change', (e) => {
      const service = e.target.value
      if (e.target.checked) {
        if (!filterState.streamingServices.includes(service)) {
          filterState.streamingServices.push(service)
        }
      } else {
        filterState.streamingServices = filterState.streamingServices.filter(s => s !== service)
      }
    })
  })
  */

  const legacyPlexOnlyToggle = document.getElementById('plex-only-toggle')

  const syncLegacyPlexOnlyToggle = () => {
    if (!legacyPlexOnlyToggle) return
    legacyPlexOnlyToggle.checked = filterState.showPlexOnly
  }

  legacyPlexOnlyToggle?.addEventListener('change', e => {
    filterState.availability = normalizeAvailabilityState({
      anywhere: !e.target.checked,
      roomPersonalMedia: e.target.checked,
      paidSubscriptions: false,
      freeStreaming: false,
    })
    filterState.showPlexOnly = deriveShowPlexOnlyFromAvailability(
      filterState.availability
    )
  })

  // FIXED DROPDOWN SETUP
  function setupAllDropdowns() {
    console.log('🔧 Setting up dropdowns...')

    // Create overlay container for dropdowns
    let overlay = document.getElementById('filter-dropdown-overlay')
    if (!overlay) {
      overlay = document.createElement('div')
      overlay.id = 'filter-dropdown-overlay'
      overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 10000;
      `
      document.body.appendChild(overlay)
    }

    const pairs = [
      {
        type: 'genre',
        toggle: document.getElementById('genre-dropdown-toggle'),
        list: document.getElementById('genre-dropdown-list'),
        checkboxes: document.querySelectorAll(
          '.genre-checkbox input[type="checkbox"]'
        ),
      },
      {
        type: 'language',
        toggle: document.getElementById('language-dropdown-toggle'),
        list: document.getElementById('language-dropdown-list'),
        checkboxes: document.querySelectorAll(
          '.language-checkbox input[type="checkbox"]'
        ),
      },
      {
        type: 'country',
        toggle: document.getElementById('country-dropdown-toggle'),
        list: document.getElementById('country-dropdown-list'),
        checkboxes: document.querySelectorAll(
          '.country-checkbox input[type="checkbox"]'
        ),
      },
      {
        type: 'sort',
        toggle: document.getElementById('sort-dropdown-toggle'),
        list: document.getElementById('sort-dropdown-list'),
        radios: document.querySelectorAll('input[name="sort"]'),
      },
      {
        type: 'rating',
        toggle: document.getElementById('rating-dropdown-toggle'),
        list: document.getElementById('rating-dropdown-list'),
        checkboxes: document.querySelectorAll(
          '.rating-checkbox input[type="checkbox"]'
        ),
      },
    ]

    let currentOpen = null

    function closeAllDropdowns() {
      pairs.forEach(p => {
        if (p.list) {
          p.list.style.display = 'none'
          p.list.style.pointerEvents = 'none'
        }
        if (p.toggle) {
          p.toggle.classList.remove('open')
        }
      })
      currentOpen = null
    }

    function positionDropdown(pair) {
      if (!pair?.toggle || !pair?.list) return
      const rect = pair.toggle.getBoundingClientRect()
      pair.list.style.top = `${rect.bottom + 4}px`
      pair.list.style.left = `${rect.left}px`
      pair.list.style.width = `${Math.max(rect.width, 200)}px`
    }

    function openDropdown(pair) {
      if (!pair.toggle || !pair.list) return

      console.log(`🧠 Opening ${pair.type} dropdown`)

      // Move to overlay and position
      overlay.appendChild(pair.list)

      // Force styles to override CSS
      pair.list.style.cssText = `
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        width: 200px !important;
        max-height: 250px !important;
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
        pointer-events: auto !important;
        z-index: 10001 !important;
        background: var(--gradient-surface) !important;
        border: 1px solid rgba(51, 65, 85, 0.5) !important;
        border-radius: var(--radius-md) !important;
        overflow-y: auto !important;
        backdrop-filter: blur(20px) !important;
        box-shadow: var(--shadow-xl) !important;
      `

      pair.toggle.classList.add('open')
      currentOpen = pair.type
      positionDropdown(pair)

      console.log(`🧠 ${pair.type} dropdown visible at`, {
        top: pair.list.style.top,
        left: pair.list.style.left,
        display: pair.list.style.display,
      })
    }

    let positionUpdateQueued = false
    function refreshOpenDropdownPosition() {
      if (positionUpdateQueued) return
      positionUpdateQueued = true

      requestAnimationFrame(() => {
        positionUpdateQueued = false
        if (!currentOpen) return
        const openPair = pairs.find(p => p.type === currentOpen)
        if (!openPair) return
        positionDropdown(openPair)
      })
    }

    // Attach click handlers
    pairs.forEach(pair => {
      if (!pair.toggle || !pair.list) {
        console.warn(`⚠️ Missing elements for ${pair.type}`)
        return
      }

      // Toggle button handlers - both touch and click
      const handleToggle = e => {
        e.preventDefault()
        e.stopPropagation()

        console.log(`🧠 ${pair.type} toggle activated`)

        if (currentOpen === pair.type) {
          closeAllDropdowns()
        } else {
          closeAllDropdowns()
          setTimeout(() => openDropdown(pair), 10)
        }
      }

      // Add both touch and click handlers for mobile support
      pair.toggle.addEventListener('touchend', handleToggle, { passive: false })
      pair.toggle.addEventListener('click', handleToggle)

      // Prevent clicks inside dropdown from closing it
      pair.list.addEventListener('click', e => {
        e.stopPropagation()
      })

      // Genre checkboxes
      if (pair.type === 'genre' && pair.checkboxes) {
        pair.checkboxes.forEach(cb => {
          cb.addEventListener('change', e => {
            const val = parseInt(e.target.value)
            if (e.target.checked) {
              if (!filterState.genres.includes(val)) {
                filterState.genres.push(val)
              }
            } else {
              filterState.genres = filterState.genres.filter(id => id !== val)
            }
            console.log('Genres:', filterState.genres)
            updateGenreButton(filterState.genres)
          })
        })
      }

      // Language checkboxes
      if (pair.type === 'language' && pair.checkboxes) {
        pair.checkboxes.forEach(cb => {
          cb.addEventListener('change', e => {
            const val = e.target.value
            if (e.target.checked) {
              if (!filterState.languages.includes(val)) {
                filterState.languages.push(val)
              }
            } else {
              filterState.languages = filterState.languages.filter(
                l => l !== val
              )
            }
            console.log('Languages:', filterState.languages)
            updateLanguageButton(filterState.languages)
          })
        })
      }

      // Country checkboxes
      if (pair.type === 'country' && pair.checkboxes) {
        pair.checkboxes.forEach(cb => {
          cb.addEventListener('change', e => {
            const val = e.target.value
            if (e.target.checked) {
              if (!filterState.countries.includes(val)) {
                filterState.countries.push(val)
              }
            } else {
              filterState.countries = filterState.countries.filter(
                c => c !== val
              )
            }
            console.log('Countries:', filterState.countries)
            updateCountryButton(filterState.countries)
          })
        })
      }

      // Sort radios
      if (pair.type === 'sort' && pair.radios) {
        pair.radios.forEach(radio => {
          radio.addEventListener('change', e => {
            if (e.target.checked) {
              filterState.sortBy = e.target.value
              const text = e.target.parentElement.textContent.trim()
              pair.toggle.innerHTML = `${text} <span class="dropdown-arrow">▼</span>`
              console.log('Sort:', filterState.sortBy)
              setTimeout(closeAllDropdowns, 100)
            }
          })
        })
      }

      // Content Rating checkboxes
      if (pair.type === 'rating' && pair.checkboxes) {
        pair.checkboxes.forEach(cb => {
          cb.addEventListener('change', e => {
            const rating = e.target.value
            if (e.target.checked) {
              if (!filterState.contentRatings.includes(rating)) {
                filterState.contentRatings.push(rating)
              }
            } else {
              filterState.contentRatings = filterState.contentRatings.filter(
                r => r !== rating
              )
            }
            console.log('Content Ratings:', filterState.contentRatings)
            updateContentRatingButton(filterState.contentRatings)
          })
        })
      }
    })

    // Close on outside click
    document.addEventListener('click', e => {
      if (currentOpen) {
        const clickedInside = pairs.some(
          p => p.toggle?.contains(e.target) || p.list?.contains(e.target)
        )
        if (!clickedInside) {
          closeAllDropdowns()
        }
      }
    })

    // Keep dropdown aligned while scrolling; close on resize to avoid stale layout
    document.addEventListener('scroll', refreshOpenDropdownPosition, {
      passive: true,
      capture: true,
    })
    window.addEventListener('scroll', refreshOpenDropdownPosition, {
      passive: true,
    })
    window.addEventListener('resize', closeAllDropdowns)

    console.log('✅ Dropdown setup complete')
  }

  setupAllDropdowns()
  syncFilterUIWithState()

  // =========================================================
  // Filter Sort Direction Button
  // =========================================================
  const sortDirectionBtn = document.getElementById('sort-direction-btn')

  // Handle direction button click
  sortDirectionBtn?.addEventListener('click', () => {
    // Get currently selected radio button
    const selectedRadio = document.querySelector('input[name="sort"]:checked')
    if (!selectedRadio) return

    const currentValue = selectedRadio.value // e.g., "popularity.desc"

    // Parse current value
    const parts = currentValue.split('.')
    const field = parts[0]
    const currentDirection = parts[1]

    // Toggle direction
    const newDirection = currentDirection === 'desc' ? 'asc' : 'desc'
    const newValue = `${field}.${newDirection}`

    // Update filterState
    filterState.sortBy = newValue

    // Update the selected radio (find or create it)
    let newRadio = document.querySelector(
      `input[name="sort"][value="${newValue}"]`
    )
    if (newRadio) {
      newRadio.checked = true
    } else {
      // Radio doesn't exist, just update the current one's value
      selectedRadio.value = newValue
      selectedRadio.checked = true
    }

    // Update button arrow
    sortDirectionBtn.textContent = newDirection === 'desc' ? '↓' : '↑'

    // Update dropdown button text to show direction
    const sortDropdownToggle = document.getElementById('sort-dropdown-toggle')
    if (sortDropdownToggle) {
      const fieldName = selectedRadio.parentElement.textContent.trim()
      const directionText = newDirection === 'desc' ? ' ↓' : ' ↑'
      sortDropdownToggle.innerHTML = `${fieldName}${directionText} <span class="dropdown-arrow">▼</span>`
    }

    console.log('Filter sort direction changed:', newValue)
  })

  /* COMMENTED OUT - Old rating checkboxes handler (now in dropdown setup)
  const ratingCheckboxes = document.querySelectorAll('#rating-checkboxes input[type="checkbox"]')
  ratingCheckboxes.forEach(checkbox => {
    checkbox.addEventListener('change', (e) => {
      const rating = e.target.value
      if (e.target.checked) {
        if (!filterState.contentRatings.includes(rating)) {
          filterState.contentRatings.push(rating)
        }
      } else {
        filterState.contentRatings = filterState.contentRatings.filter(r => r !== rating)
      }
    })
  })
  */

  const imdbRatingSlider = document.getElementById('imdb-rating')
  const imdbRatingValue = document.getElementById('imdb-rating-value')
  imdbRatingSlider?.addEventListener('input', e => {
    const rating = parseFloat(e.target.value)
    filterState.imdbRating = rating
    imdbRatingValue.textContent = rating.toFixed(1)
  })

  const tmdbRatingSlider = document.getElementById('tmdb-rating')
  const tmdbRatingValue = document.getElementById('tmdb-rating-value')
  tmdbRatingSlider?.addEventListener('input', e => {
    const rating = parseFloat(e.target.value)
    filterState.tmdbRating = rating
    tmdbRatingValue.textContent = rating.toFixed(1)
  })

  yearMinInput?.addEventListener('change', e => {
    const value = parseInt(e.target.value) || 1895
    filterState.yearRange.min = value
  })

  yearMaxInput?.addEventListener('change', e => {
    const value = parseInt(e.target.value) || currentYear
    filterState.yearRange.max = value
  })

  const runtimeMinInput = document.getElementById('runtime-min')
  const runtimeMaxInput = document.getElementById('runtime-max')

  runtimeMinInput?.addEventListener('change', e => {
    const value = parseInt(e.target.value) || 0
    filterState.runtimeRange.min = value
  })

  runtimeMaxInput?.addEventListener('change', e => {
    const value = parseInt(e.target.value) || 300
    filterState.runtimeRange.max = value
  })

  const voteCountSlider = document.getElementById('vote-count')
  const voteCountValue = document.getElementById('vote-count-value')
  voteCountSlider?.addEventListener('input', e => {
    const count = parseInt(e.target.value)
    filterState.voteCount = count
    voteCountValue.textContent = count.toLocaleString()
  })

  /* COMMENTED OUT - RT Rating Filter
   */

  // Apply filters button
  const applyFiltersBtn = document.getElementById('apply-filters')
  const handleApplyFilters = e => {
    e.preventDefault()
    e.stopPropagation()

    window.__resetMovies = true // Invalidate old buffer
    console.log(
      '🧩 FILTER DEBUG - Applying filters:',
      JSON.stringify(filterState, null, 2)
    )
    triggerNewBatch()
    const swipeButton = document.querySelector('[data-tab="tab-swipe"]')
    swipeButton?.click()
  }

  // Add both touch and click handlers for mobile support
  applyFiltersBtn?.addEventListener('touchend', handleApplyFilters, {
    passive: false,
  })
  applyFiltersBtn?.addEventListener('click', handleApplyFilters)

  // Fix 4: Add swipe tab buffer check OUTSIDE of handleApplyFilters
  const swipeButton = document.querySelector('[data-tab="tab-swipe"]')
  swipeButton?.addEventListener('click', async () => {
    // Force buffer check when returning to swipe tab
    console.log('🔧 Returning to swipe tab, checking buffer...')
    if (movieBuffer.length < BUFFER_MIN_SIZE) {
      console.log('⚠️ Buffer low on tab switch, refilling...')
      await ensureMovieBuffer()

      // If cards are empty, load some
      const cardStack = document.querySelector('.js-card-stack')
      if (
        cardStack &&
        cardStack.children.length === 0 &&
        movieBuffer.length > 0
      ) {
        console.log('📋 No cards visible, loading from buffer...')
        for (
          let i = 0;
          i < Math.min(CARD_STACK_SIZE, movieBuffer.length);
          i++
        ) {
          const movie = getNextMovie()
          if (movie) {
            new CardView(movie, cardStackEventTarget)
          }
        }
      }
    }
  })

  // Reset filters button
  const resetFiltersBtn = document.getElementById('reset-filters')

  const handleResetFilters = e => {
    e.preventDefault()
    e.stopPropagation()

    // Reset filterState to defaults
    filterState.yearRange = { min: DEFAULT_YEAR_MIN, max: currentYear }
    filterState.genres = []
    filterState.contentRatings = []
    //filterState.streamingServices = []
    filterState.languages = [...DEFAULT_LANGUAGES]
    filterState.countries = []
    filterState.imdbRating = 0.0
    filterState.tmdbRating = 0.0
    filterState.runtimeRange = { min: 0, max: 300 }
    filterState.voteCount = DEFAULT_VOTE_COUNT
    filterState.sortBy = 'popularity.desc'
    //filterState.rtRating = 0

    syncFilterUIWithState()

    // Streaming checkboxes
    //streamingCheckboxes.forEach(checkbox => {
    //checkbox.checked = false
    //})

    // Reset Where to Watch toggle to configured profile
    const plexOnlyToggle = document.getElementById('plex-only-toggle')
    if (plexOnlyToggle) {
      filterState.availability = getDefaultAvailabilityState()
      filterState.showPlexOnly = false
      plexOnlyToggle.checked = false
    }

    // Sliders
    if (tmdbRatingSlider) {
      tmdbRatingSlider.value = '0'
      tmdbRatingValue.textContent = '0.0'
    }

    if (runtimeMinInput) runtimeMinInput.value = '0'
    if (runtimeMaxInput) runtimeMaxInput.value = '300'

    // Reset sort radio buttons
    const resetSortRadios = document.querySelectorAll('input[name="sort"]')
    resetSortRadios.forEach(radio => {
      radio.checked = radio.value === 'popularity.desc'
    })

    // Reset sort direction button
    const resetSortBtn = document.getElementById('sort-direction-btn')
    if (resetSortBtn) {
      resetSortBtn.textContent = '↓'
    }

    // Reset sort dropdown toggle text
    const resetSortToggle = document.getElementById('sort-dropdown-toggle')
    if (resetSortToggle) {
      resetSortToggle.innerHTML =
        'Popularity <span class="dropdown-arrow">▼</span>'
    }

    // Reset dropdown button texts
    updateGenreButton(filterState.genres)

    // Reset sort radio buttons
    const sortRadios = document.querySelectorAll('input[name="sort"]')
    sortRadios.forEach(radio => {
      radio.checked = radio.value === 'popularity.desc'
    })

    // Reset sort direction button
    const sortDirectionBtn = document.getElementById('sort-direction-btn')
    if (sortDirectionBtn) {
      sortDirectionBtn.textContent = '↓'
    }

    // Reset sort dropdown toggle text
    const sortDropdownToggle = document.getElementById('sort-dropdown-toggle')
    if (sortDropdownToggle) {
      sortDropdownToggle.innerHTML =
        'Popularity <span class="dropdown-arrow">▼</span>'
    }

    // Reset dropdown button texts
    updateGenreButton(filterState.genres)
    updateLanguageButton(filterState.languages)
    updateCountryButton(filterState.countries)
    updateContentRatingButton(filterState.contentRatings)

    console.log('Filters reset to default')
  }

  // Add both touch and click handlers for mobile support
  resetFiltersBtn?.addEventListener('touchend', handleResetFilters, {
    passive: false,
  })
  resetFiltersBtn?.addEventListener('click', handleResetFilters)

  let topCardEl = null
  const cardStackEventTarget = new EventTarget()

  // Set a random loading message on each page load
  const cardStackEl = document.querySelector('.js-card-stack')
  if (cardStackEl) {
    const randomMessage = getRandomLoadingMessage()
    cardStackEl.style.setProperty('--empty-text', `"${randomMessage}"`)
  }

  cardStackEventTarget.addEventListener('newTopCard', () => {
    topCardEl = topCardEl?.nextSibling || null
    if (!topCardEl) {
      const cardStackEl = document.querySelector('.js-card-stack')
      cardStackEl?.style.setProperty(
        '--empty-text',
        `var(--i18n-exhausted-cards)`
      )
    }
  })

  const triggerTopCardRate = value => {
    const activeCard = document.querySelector('.js-card-stack > :first-child')
    if (!activeCard) {
      console.log('⚠️ No active card available to rate')
      return
    }

    activeCard.dispatchEvent(new MessageEvent('rate', { data: value }))
  }

  const swipeRateButtons = document.querySelectorAll('.js-swipe-rate')
  swipeRateButtons.forEach(button => {
    const handleSwipeRate = event => {
      event.preventDefault()
      event.stopPropagation()

      const { rateValue } = button.dataset
      if (rateValue === 'up') {
        triggerTopCardRate(true)
      } else if (rateValue === 'down') {
        triggerTopCardRate(false)
      } else {
        triggerTopCardRate(null)
      }
    }

    button.addEventListener('touchend', handleSwipeRate, { passive: false })
    button.addEventListener('click', handleSwipeRate)
  })

  let movieBuffer = []
  let pendingGuids = new Set()
  let pendingTmdbIds = new Set()
  let isLoadingBatch = false
  let ensureMovieBufferPromise = null
  let ensureMovieBufferTarget = 0
  const BUFFER_MIN_SIZE = 10
  const INITIAL_BUFFER_MIN_SIZE = 4
  const BATCH_SIZE = 20

  // Track if initial load has completed (to prevent showing filter notification on startup)
  let isInitialLoadComplete = false

  // Swipe history for undo functionality (only track last swipe)
  let lastSwipe = null

  window.ensureMovieBufferPromise = ensureMovieBufferPromise
  window.isLoadingBatch = isLoadingBatch

  // Prime request-service status and the initial swipe buffer in parallel
  console.log('🧊 Priming request status and initial movie batch...')
  const requestServiceStatusPromise = checkRequestServiceStatus()
  const initialBufferWarmPromise = ensureMovieBuffer(INITIAL_BUFFER_MIN_SIZE)

  await requestServiceStatusPromise
  console.log('📦 Request service status cached')

  initialBufferWarmPromise?.catch(err => {
    console.warn('⚠️ Initial movie buffer warm failed:', err)
  })

  if (rated && rated.length > 0) {
    // Separate Seen items from Watch/Pass items.
    // Watch and Pass lists are small — render immediately.
    // Seen can have thousands of entries after an import; defer those to avoid
    // hanging the browser renderer on initial page load.
    const deferredSeenItems = []

    for (const item of rated) {
      if (item.wantsToWatch === null) {
        // Seen items arrive as slim stubs (no movie property) — full data is
        // fetched lazily from /api/seen-movies when the Seen tab is opened.
        deferredSeenItems.push(item)
      } else if (item.movie) {
        appendRatedRow(
          { basePath, likesList, dislikesList, seenList },
          item.movie,
          item.wantsToWatch
        )
      }
    }

    if (deferredSeenItems.length > 0) {
      // Seen items in the loginResponse are now slim (guid+tmdbId only).
      // Fetch full movie data from /api/seen-movies when the user opens
      // the Seen tab, then paginate with a Load More button.
      const PAGE_SIZE = 50
      const loadMoreWrap = document.getElementById('seen-load-more-wrap')
      const loadMoreBtn = document.getElementById('seen-load-more-btn')
      const loadMoreCount = document.getElementById('seen-load-more-count')

      window._renderDeferredSeen = async () => {
        window._renderDeferredSeen = null // prevent re-entry

        if (loadMoreWrap) loadMoreWrap.hidden = false
        if (loadMoreBtn) loadMoreBtn.disabled = true
        if (loadMoreCount)
          loadMoreCount.textContent = `Loading ${deferredSeenItems.length} movies...`

        try {
          const apiBase = document.body.dataset.basePath || ''
          const resp = await fetch(
            `${apiBase}/api/seen-movies?roomCode=${encodeURIComponent(
              roomCode
            )}&userName=${encodeURIComponent(userName)}`
          )
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
          const { movies: seenMovies } = await resp.json()

          let renderIdx = 0

          const updateLoadMore = () => {
            const remaining = seenMovies.length - renderIdx
            if (remaining > 0 && loadMoreWrap) {
              loadMoreWrap.hidden = false
              if (loadMoreBtn) loadMoreBtn.disabled = false
              if (loadMoreCount)
                loadMoreCount.textContent = `${remaining} remaining`
            } else if (loadMoreWrap) {
              loadMoreWrap.hidden = true
            }
          }

          const renderPage = () => {
            const end = Math.min(renderIdx + PAGE_SIZE, seenMovies.length)
            for (; renderIdx < end; renderIdx++) {
              const movie = seenMovies[renderIdx]
              if (movie) {
                appendRatedRow(
                  { basePath, likesList, dislikesList, seenList },
                  movie,
                  null
                )
              }
            }
            updateLoadMore()
            applyCurrentSeenListSort()
            hydrateSeenRatingsRetroactively().catch(err => {
              console.warn('Retro Seen ratings hydration failed:', err)
            })
          }

          if (loadMoreBtn) loadMoreBtn.addEventListener('click', renderPage)
          renderPage()
        } catch (err) {
          console.error('Failed to load seen movies:', err)
          if (loadMoreCount)
            loadMoreCount.textContent = 'Failed to load — try refreshing'
          if (loadMoreBtn) loadMoreBtn.disabled = false
        }
      }
    }
  }

  async function hydrateSeenRatingsRetroactively(limit = 30) {
    if (!seenList) return

    const cards = Array.from(seenList.querySelectorAll('.watch-card'))
      .filter(card => {
        const ratingEl = card.querySelector('.watch-card-ratings')
        if (!ratingEl) return true
        return !ratingEl.querySelector('.rating-logo')
      })
      .slice(0, limit)

    if (cards.length === 0) return

    console.log(
      `🔄 Retro-rating refresh queued for ${cards.length} Seen card(s)`
    )

    const workers = 3
    let index = 0

    const runWorker = async () => {
      while (index < cards.length) {
        const card = cards[index]
        index += 1

        const idOrGuid = card.dataset.tmdbId || card.dataset.guid
        if (!idOrGuid) continue

        try {
          const response = await fetch(
            `/api/refresh-movie/${encodeURIComponent(idOrGuid)}`
          )
          if (!response.ok) continue

          const data = await response.json().catch(() => null)
          if (!data) continue

          const ratingHtml = buildRatingHtml(data, basePath)
          if (!ratingHtml) continue

          let ratingEl = card.querySelector('.watch-card-ratings')
          if (!ratingEl) {
            ratingEl = document.createElement('div')
            ratingEl.className = 'watch-card-ratings'
            const content = card.querySelector('.watch-card-content')
            content?.prepend(ratingEl)
          }
          ratingEl.innerHTML = ratingHtml
        } catch (err) {
          console.warn('Seen retro refresh failed:', err)
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(workers, cards.length) }, () => runWorker())
    )
  }

  // hydrateSeenRatingsRetroactively is now called inside the deferred Seen
  // renderer after each page of cards is appended, since Seen cards are no
  // longer present in the DOM at this point in the initial load.

  // =========================================================
  // IMDb Import Handler (CSV upload + history)
  // =========================================================
  const imdbCsvUploadBtn = document.getElementById('imdb-csv-upload-btn')
  const imdbCsvInput = document.getElementById('imdb-csv-input')
  const imdbImportHistoryBody = document.getElementById(
    'imdb-import-history-body'
  )

  function showImdbProgress(text) {
    isImdbImportActive = true
    if (imdbImportProgress) imdbImportProgress.style.display = 'block'
    if (imdbImportStatus) imdbImportStatus.textContent = text
    if (imdbImportBar) {
      imdbImportBar.style.width = '10%'
      imdbImportBar.classList.remove('error')
    }
  }

  function showImdbError(err) {
    console.error('IMDb import error:', err)
    if (imdbImportStatus)
      imdbImportStatus.textContent = `Import failed: ${err.message}`
    if (imdbImportBar) {
      imdbImportBar.style.width = '100%'
      imdbImportBar.classList.add('error')
    }
    showNotification(`IMDb import failed: ${err.message}`)
  }

  function escapeCell(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  async function loadImdbImportHistory() {
    if (!imdbImportHistoryBody) return

    try {
      const apiBase = document.body.dataset.basePath || ''
      const response = await fetch(
        `${apiBase}/api/imdb-import-history?roomCode=${encodeURIComponent(
          roomCode
        )}&userName=${encodeURIComponent(userName)}`
      )

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`)
      }

      const { history } = await response.json()
      if (!Array.isArray(history) || history.length === 0) {
        imdbImportHistoryBody.innerHTML =
          '<tr><td colspan="4">No imports yet.</td></tr>'
        return
      }

      imdbImportHistoryBody.innerHTML = history
        .map(entry => {
          const uploadDate = new Date(entry.uploadedAt).toLocaleString()
          const statusClass =
            entry.status === 'failed' ? 'failed' : 'successful'
          return `<tr>
            <td>${escapeCell(entry.fileName || 'IMDb CSV')}</td>
            <td>${escapeCell(uploadDate)}</td>
            <td>${escapeCell(entry.movieCount ?? 0)}</td>
            <td><span class="imdb-import-status-pill ${statusClass}">${escapeCell(
            entry.status === 'failed' ? 'Failed' : 'Successful'
          )}</span></td>
          </tr>`
        })
        .join('')
    } catch (err) {
      console.warn('Failed to load IMDb import history:', err)
      imdbImportHistoryBody.innerHTML =
        '<tr><td colspan="4">Unable to load import history.</td></tr>'
    }
  }

  window.refreshImdbImportHistory = loadImdbImportHistory
  loadImdbImportHistory()

  // --- CSV Upload handler ---
  if (imdbCsvUploadBtn && imdbCsvInput) {
    imdbCsvUploadBtn.addEventListener('click', () => {
      imdbCsvInput.click()
    })

    imdbCsvInput.addEventListener('change', async e => {
      const file = e.target.files?.[0]
      if (!file) return

      if (!file.name.toLowerCase().endsWith('.csv')) {
        showNotification('Please select a CSV file exported from IMDb.')
        imdbCsvInput.value = ''
        return
      }

      currentImportRoomCode = roomCode
      currentImportUserName = userName
      showImdbProgress('Reading file...')
      imdbCsvUploadBtn.disabled = true

      try {
        const csvContent = await file.text()
        if (imdbImportStatus)
          imdbImportStatus.textContent = 'Uploading and parsing CSV file...'
        if (imdbImportDetail)
          imdbImportDetail.textContent =
            'Validating file and extracting IMDb rows...'
        if (imdbImportBar) imdbImportBar.style.width = '10%'

        const apiBase = document.body.dataset.basePath || ''
        const response = await fetch(`${apiBase}/api/imdb-import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            csvContent,
            roomCode,
            userName,
            fileName: file.name,
          }),
        })

        if (imdbImportBar) imdbImportBar.style.width = '20%'

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}))
          throw new Error(errorData.error || `Server error: ${response.status}`)
        }

        const result = await response.json()

        // Handle immediate completion (0 movies) or started status
        if (result.status === 'completed' && result.total === 0) {
          if (imdbImportStatus)
            imdbImportStatus.textContent = 'No movies found in the CSV file.'
          if (imdbImportBar) imdbImportBar.style.width = '100%'
          if (imdbImportCancelBtn) imdbImportCancelBtn.style.display = 'none'
          imdbCsvUploadBtn.disabled = false
          loadImdbImportHistory()
          setTimeout(() => {
            if (imdbImportProgress) imdbImportProgress.style.display = 'none'
          }, 3000)
        } else if (result.status === 'started') {
          // Background processing started - progress updates will come via WebSocket
          setImdbImportProgressText(
            `Queued ${result.total} rows. Waiting for first lookup...`,
            {
              total: result.total,
              processed: 0,
              imported: 0,
              skipped: 0,
            }
          )

          // Fallback: if no WebSocket progress after 30s, re-enable the button
          setTimeout(() => {
            if (
              isImdbImportActive &&
              imdbImportStatus?.textContent?.includes('Queued')
            ) {
              setImdbImportProgressText(
                `Processing ${result.total} rows in background...`,
                {
                  total: result.total,
                  processed: 0,
                  imported: 0,
                  skipped: 0,
                }
              )
              imdbCsvUploadBtn.disabled = false
            }
          }, 30000)
        }
      } catch (err) {
        showImdbError(err)
        imdbCsvUploadBtn.disabled = false
        loadImdbImportHistory()
      } finally {
        imdbCsvInput.value = '' // Always reset file input
      }
    })
  }

  async function ensureMovieBuffer(targetSize = BUFFER_MIN_SIZE) {
    // If already loading, return the existing promise with timeout
    if (ensureMovieBufferPromise) {
      const requestedLargerTarget = targetSize > ensureMovieBufferTarget
      console.log('⏳ Already ensuring buffer, waiting...')
      try {
        await Promise.race([
          ensureMovieBufferPromise,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Buffer promise timeout')), 10000)
          ),
        ])
      } catch (e) {
        if (e.message === 'Buffer promise timeout') {
          console.warn('⚠️ Buffer promise timed out, resetting')
          ensureMovieBufferPromise = null
          ensureMovieBufferTarget = 0
          window.ensureMovieBufferPromise = ensureMovieBufferPromise
          isLoadingBatch = false
          window.isLoadingBatch = isLoadingBatch
          // Retry the buffer load
          return ensureMovieBuffer(targetSize)
        }
        throw e
      }

      if (requestedLargerTarget && movieBuffer.length < targetSize) {
        return ensureMovieBuffer(targetSize)
      }

      return
    }

    // Clear buffer if filters changed
    if (window.__resetMovies) {
      console.log('🧹 Clearing buffer due to filter change')
      movieBuffer = []
      pendingGuids = new Set()
      pendingTmdbIds = new Set()
      isLoadingBatch = false
      window.isLoadingBatch = isLoadingBatch
      window.__resetMovies = false
    }

    if (isLoadingBatch || movieBuffer.length >= targetSize) {
      return
    }

    isLoadingBatch = true
    window.isLoadingBatch = isLoadingBatch

    // Set a random funny loading message
    const cardStack = document.querySelector('.js-card-stack')
    if (cardStack) {
      const randomMessage = getRandomLoadingMessage()
      cardStack.style.setProperty('--empty-text', `"${randomMessage}"`)
    }

    //FIX: Create and store the promise immediately
    ensureMovieBufferTarget = targetSize
    ensureMovieBufferPromise = (async () => {
      try {
        const MAX_BATCH_ATTEMPTS = 4
        let attempts = 0
        let addedMovies = 0
        const bufferWasEmpty = movieBuffer.length === 0

        while (
          attempts < MAX_BATCH_ATTEMPTS &&
          movieBuffer.length < targetSize
        ) {
          attempts += 1
          console.log(
            `🗂️ Requesting new batch (attempt ${attempts}) with filters:`,
            filterState
          )
          const newBatch = await api.requestNextBatchWithFilters({
            ...filterState,
            runtimeMin: filterState.runtimeRange.min || undefined,
            runtimeMax: filterState.runtimeRange.max || undefined,
            voteCount: filterState.voteCount,
            sortBy: filterState.sortBy,
            imdbRating: filterState.imdbRating,
            batchSize: BATCH_SIZE,
          })

          if (!Array.isArray(newBatch) || newBatch.length === 0) {
            console.warn('⚠️ No more movies available from service')
            break
          }

          console.log(`📦 Received ${newBatch.length} movies from server`)

          const batchGuids = new Set()
          const batchTmdbIds = new Set()

          const unseenMovies = newBatch.filter(movie => {
            const normalizedGuid = normalizeGuid(movie.guid)
            const normalizedTmdbId = getNormalizedTmdbId(movie)

            if (normalizedGuid && ratedGuids.has(normalizedGuid)) {
              console.log(`Filtering ${movie.title} - exact GUID match`)
              return false
            }

            if (normalizedTmdbId && ratedTmdbIds.has(normalizedTmdbId)) {
              console.log(
                `Filtering ${movie.title} - TMDb ID ${normalizedTmdbId} already rated`
              )
              return false
            }

            if (normalizedGuid && pendingGuids.has(normalizedGuid)) {
              console.log(
                `Skipping ${movie.title} - GUID already pending in swipe stack`
              )
              return false
            }

            if (normalizedTmdbId && pendingTmdbIds.has(normalizedTmdbId)) {
              console.log(
                `Skipping ${movie.title} - TMDb ID ${normalizedTmdbId} already pending`
              )
              return false
            }

            if (normalizedGuid && batchGuids.has(normalizedGuid)) {
              console.log(
                `Skipping ${movie.title} - duplicate GUID within batch`
              )
              return false
            }
            if (normalizedTmdbId && batchTmdbIds.has(normalizedTmdbId)) {
              console.log(
                `Skipping ${movie.title} - duplicate TMDb ID within batch`
              )
              return false
            }

            if (normalizedGuid) batchGuids.add(normalizedGuid)
            if (normalizedTmdbId) batchTmdbIds.add(normalizedTmdbId)
            return true
          })

          console.log(
            `🧠 Filtered to ${unseenMovies.length} unseen movies (${
              newBatch.length - unseenMovies.length
            } removed as rated/duplicates)`
          )

          if (unseenMovies.length === 0) {
            console.log(
              '🔁 Batch yielded no new unseen movies, requesting another batch'
            )
            continue
          }

          addedMovies += unseenMovies.length
          movieBuffer.push(...unseenMovies)

          // Warm poster images in the browser cache before cards are rendered.
          unseenMovies
            .slice(0, CARD_STACK_SIZE + 2)
            .forEach(preloadPosterForMovie)

          unseenMovies.forEach(movie => {
            const normalizedGuid = normalizeGuid(movie.guid)
            if (normalizedGuid) pendingGuids.add(normalizedGuid)
            const normalizedTmdbId = getNormalizedTmdbId(movie)
            if (normalizedTmdbId) pendingTmdbIds.add(normalizedTmdbId)
            const guidKey = normalizedGuid || movie.guid
            if (guidKey) movieByGuid.set(guidKey, movie)
          })
        }

        if (bufferWasEmpty && addedMovies === 0 && movieBuffer.length === 0) {
          console.warn('⚠️ No unseen movies available after multiple attempts')

          const cardStack = document.querySelector('.js-card-stack')
          const hasVisibleMovies = cardStack && cardStack.children.length > 0

          // Only show "no movies with filters" notification if initial load has completed
          // This prevents the confusing message on app startup before user has set any filters
          if (!hasVisibleMovies && isInitialLoadComplete) {
            if (cardStack) {
              cardStack.style.setProperty(
                '--empty-text',
                '"No more movies found. Try adjusting your filters!"'
              )
            }

            showNoMoviesNotification()
          }

          isLoadingBatch = false
          return
        }
      } catch (error) {
        console.error('❌Error loading movie batch:', error)

        // Show error message to user
        const cardStack = document.querySelector('.js-card-stack')
        if (cardStack) {
          cardStack.style.setProperty(
            '--empty-text',
            '"Error loading movies. Please try again or adjust filters."'
          )
        }
      } finally {
        isLoadingBatch = false
        ensureMovieBufferPromise = null
        ensureMovieBufferTarget = 0
        window.isLoadingBatch = isLoadingBatch
        window.ensureMovieBufferPromise = ensureMovieBufferPromise
      }
    })()
    window.ensureMovieBufferPromise = ensureMovieBufferPromise

    // FIX: Return the promise so callers can await it
    return ensureMovieBufferPromise
  }

  function getNextMovie() {
    return movieBuffer.shift()
  }

  // NEW triggerNewBatch
  async function triggerNewBatch() {
    console.log('🔧 triggerNewBatch called with filters:', filterState)

    const cardStack = document.querySelector('.js-card-stack')
    if (cardStack) cardStack.innerHTML = ''

    // Clear undo history when filters change
    lastSwipe = null

    window.__resetMovies = true
    await ensureMovieBuffer()

    for (let i = 0; i < CARD_STACK_SIZE && movieBuffer.length > 0; i++) {
      const movie = getNextMovie()
      if (movie) {
        new CardView(movie, cardStackEventTarget)
        {
          const guidKey = normalizeGuid(movie.guid) || movie.guid
          if (guidKey) movieByGuid.set(guidKey, movie)
        }
        if (i === 0) {
          setTimeout(() => {
            topCardEl = document.querySelector('.js-card-stack > :first-child')
          }, 100)
        }
      }
    }

    ensureMovieBuffer()
  }

  // Expose triggerNewBatch globally for swipe filter modal
  window.triggerNewBatch = triggerNewBatch

  // Helper function to remove last rated row from UI
  function removeLastRatedRow(wantsToWatch) {
    let targetList
    if (wantsToWatch === true) {
      targetList = likesList
    } else if (wantsToWatch === false) {
      targetList = dislikesList
    } else {
      targetList = seenList
    }

    if (targetList && targetList.lastElementChild) {
      targetList.lastElementChild.remove()
    }
  }

  // Undo event listener (only allows undoing the most recent swipe)
  cardStackEventTarget.addEventListener('undo', () => {
    if (!lastSwipe) {
      console.log('⚠️ No swipe to undo')
      return
    }

    console.log('↩️ Undoing swipe for:', lastSwipe.movie.title)

    // Remove from rated sets
    const normalizedGuid = normalizeGuid(lastSwipe.guid)
    if (normalizedGuid) {
      ratedGuids.delete(normalizedGuid)
    } else {
      ratedGuids.delete(lastSwipe.guid)
    }

    const normalizedTmdbId = getNormalizedTmdbId(lastSwipe.movie)
    if (normalizedTmdbId) {
      ratedTmdbIds.delete(normalizedTmdbId)
    }

    // Remove the last rated row from UI
    removeLastRatedRow(lastSwipe.wantsToWatch)

    // Create a new card for the previous movie at the top of the stack
    const cardStack = document.querySelector('.js-card-stack')
    const newCard = new CardView(lastSwipe.movie, cardStackEventTarget)

    // Move the newly created card to the top of the stack
    if (cardStack && newCard.node) {
      cardStack.insertBefore(newCard.node, cardStack.firstChild)
    }

    // Update topCardEl reference
    topCardEl = cardStack?.querySelector('.card:first-child')

    // Clear lastSwipe so user can't undo again until they swipe again
    lastSwipe = null

    console.log('✅ Undo complete - card restored')
  })

  // NEW loadMoviesWithFilters
  async function loadMoviesWithFilters() {
    window.__resetMovies = false

    try {
      await ensureMovieBuffer(INITIAL_BUFFER_MIN_SIZE)

      const cardStack = document.querySelector('.js-card-stack')
      if (cardStack) cardStack.innerHTML = ''

      for (let i = 0; i < CARD_STACK_SIZE && movieBuffer.length > 0; i++) {
        const movie = getNextMovie()
        if (movie) {
          new CardView(movie, cardStackEventTarget)
          {
            const guidKey = normalizeGuid(movie.guid) || movie.guid
            if (guidKey) movieByGuid.set(guidKey, movie)
          }
          if (i === 0) {
            setTimeout(() => {
              topCardEl = document.querySelector(
                '.js-card-stack > :first-child'
              )
            }, 100)
          }
        }
      }

      ensureMovieBuffer().catch(error => {
        console.warn('⚠️ Background buffer refill failed:', error)
      })
    } catch (error) {
      console.error('❌Error in initial movie loading:', error)
    }

    // Mark initial load as complete - now safe to show "no movies with filters" notifications
    isInitialLoadComplete = true

    while (true) {
      const { guid, wantsToWatch, isUndo } = await new Promise(resolve => {
        cardStackEventTarget.addEventListener(
          'response',
          e => resolve(e.data),
          { once: true }
        )
      })

      // IMPORTANT: Add this movie to the rated set so we don't show it again
      const normalizedGuid = normalizeGuid(guid)
      if (normalizedGuid) {
        ratedGuids.add(normalizedGuid)
        pendingGuids.delete(normalizedGuid)
      } else {
        pendingGuids.delete(guid)
      }

      const m = movieByGuid.get(normalizedGuid) || movieByGuid.get(guid)
      if (m) {
        // Also add the TMDb ID to prevent showing the same movie with a different GUID
        const normalized = getNormalizedTmdbId(m)
        if (normalized) {
          ratedTmdbIds.add(normalized)
          pendingTmdbIds.delete(normalized)
        }

        // Track last swipe for undo functionality
        lastSwipe = {
          movie: m,
          guid: normalizedGuid || guid,
          wantsToWatch,
          timestamp: Date.now(),
        }

        appendRatedRow(
          { basePath, likesList, dislikesList, seenList },
          m,
          wantsToWatch
        )
      } else {
        // Best effort cleanup when we don't have the movie handy (should be rare)
        const fallbackTmdbId = getNormalizedTmdbId({ guid })
        if (fallbackTmdbId) {
          ratedTmdbIds.add(fallbackTmdbId)
          pendingTmdbIds.delete(fallbackTmdbId)
        }
      }

      api.respond({ guid, wantsToWatch })

      // ✅ First, try to get next movie from buffer
      let nextMovie = getNextMovie()

      // If buffer was empty, refill it and try again
      if (!nextMovie) {
        console.log('⚠️ Buffer empty, triggering immediate refill')
        await ensureMovieBuffer()
        nextMovie = getNextMovie() // Try to get a movie after refill
      }

      // Create card if we have a movie
      if (nextMovie) {
        try {
          new CardView(nextMovie, cardStackEventTarget)
          const guidKey = normalizeGuid(nextMovie.guid) || nextMovie.guid
          if (guidKey) movieByGuid.set(guidKey, nextMovie)
        } catch (err) {
          console.error(
            '❌ Error creating CardView for movie:',
            nextMovie?.title,
            err
          )
        }
      } else {
        console.warn('⚠️ No movies available even after refill attempt')
      }

      // Always ensure buffer stays topped up
      if (movieBuffer.length < BUFFER_MIN_SIZE) {
        ensureMovieBuffer() // Trigger background refill (non-blocking)
      }
    }
  }
  await loadMoviesWithFilters()
}

// =========================================================
// Watch List Filter Modal
// =========================================================
const watchFilterBtn = document.getElementById('watch-filter-btn')
const watchFilterModal = document.getElementById('watch-filter-modal')
const watchFilterOverlay = document.getElementById('watch-filter-overlay')
const watchFilterClose = document.getElementById('watch-filter-close')
const watchFilterApply = document.getElementById('watch-filter-apply')
const watchFilterReset = document.getElementById('watch-filter-reset')

function openWatchFilterModal() {
  watchFilterModal?.classList.add('active')
  watchFilterOverlay?.classList.add('active')
}

function closeWatchFilterModal() {
  watchFilterModal?.classList.remove('active')
  watchFilterOverlay?.classList.remove('active')
}

watchFilterBtn?.addEventListener('click', openWatchFilterModal)
watchFilterClose?.addEventListener('click', closeWatchFilterModal)
watchFilterOverlay?.addEventListener('click', closeWatchFilterModal)

// =========================================================
// Watch List Sort Controls
// =========================================================
const watchSortDropdown = document.getElementById('watch-sort')
const watchSortDirectionBtn = document.getElementById('watch-sort-direction')

if (watchSortDirectionBtn && !watchSortDirectionBtn.dataset.direction) {
  watchSortDirectionBtn.dataset.direction = 'desc'
}

// Handle sort dropdown change with separate direction control
watchSortDropdown?.addEventListener('change', () => {
  const sortField = watchSortDropdown.value
  const direction = watchSortDirectionBtn?.dataset.direction || 'desc'
  window.sortWatchList(`${sortField}-${direction}`)
})

// Handle direction button click - toggle between asc/desc
watchSortDirectionBtn?.addEventListener('click', e => {
  e.preventDefault()
  e.stopPropagation()

  const currentDirection =
    watchSortDirectionBtn.dataset.direction === 'asc' ? 'asc' : 'desc'
  const newDirection = currentDirection === 'desc' ? 'asc' : 'desc'
  watchSortDirectionBtn.dataset.direction = newDirection
  watchSortDirectionBtn.textContent = newDirection === 'desc' ? '↓' : '↑'

  const sortField = watchSortDropdown?.value || 'date'
  window.sortWatchList(`${sortField}-${newDirection}`)
})

// =========================================================
// Expand/Collapse All Button
// =========================================================
const toggleExpandAllBtn = document.getElementById('toggle-expand-all-btn')
let allExpanded = false

// Function to reset the expand/collapse button state
function resetExpandCollapseButton() {
  allExpanded = false
  if (toggleExpandAllBtn) {
    toggleExpandAllBtn.classList.remove('all-expanded')
    toggleExpandAllBtn.title = 'Expand All'
  }
}

toggleExpandAllBtn?.addEventListener('click', () => {
  const likesList = document.querySelector('.likes-list')
  if (!likesList) return

  const cards = likesList.querySelectorAll('.watch-card')

  if (allExpanded) {
    // Collapse all
    cards.forEach(card => card.classList.remove('expanded'))
    toggleExpandAllBtn.classList.remove('all-expanded')
    toggleExpandAllBtn.title = 'Expand All'
    allExpanded = false
  } else {
    // Expand all
    cards.forEach(card => card.classList.add('expanded'))
    toggleExpandAllBtn.classList.add('all-expanded')
    toggleExpandAllBtn.title = 'Collapse All'
    allExpanded = true
  }
})

// =========================================================
// Pass List Sort Controls
// =========================================================
const passSortDropdown = document.getElementById('pass-sort')
const passSortDirectionBtn = document.getElementById('pass-sort-direction')

if (passSortDirectionBtn && !passSortDirectionBtn.dataset.direction) {
  passSortDirectionBtn.dataset.direction = 'desc'
}

passSortDropdown?.addEventListener('change', () => {
  const sortField = passSortDropdown.value
  const direction = passSortDirectionBtn?.dataset.direction || 'desc'
  window.sortPassList(`${sortField}-${direction}`)
})

passSortDirectionBtn?.addEventListener('click', e => {
  e.preventDefault()
  e.stopPropagation()

  const currentDirection =
    passSortDirectionBtn.dataset.direction === 'asc' ? 'asc' : 'desc'
  const newDirection = currentDirection === 'desc' ? 'asc' : 'desc'
  passSortDirectionBtn.dataset.direction = newDirection
  passSortDirectionBtn.textContent = newDirection === 'desc' ? '↓' : '↑'

  const sortField = passSortDropdown?.value || 'date'
  window.sortPassList(`${sortField}-${newDirection}`)
})

// =========================================================
// Pass List Expand/Collapse All Button
// =========================================================
const toggleExpandAllPassBtn = document.getElementById(
  'toggle-expand-all-pass-btn'
)
let allPassExpanded = false

toggleExpandAllPassBtn?.addEventListener('click', () => {
  const dislikesList = document.querySelector('.dislikes-list')
  if (!dislikesList) return

  const cards = dislikesList.querySelectorAll('.watch-card')

  if (allPassExpanded) {
    cards.forEach(card => card.classList.remove('expanded'))
    toggleExpandAllPassBtn.classList.remove('all-expanded')
    toggleExpandAllPassBtn.title = 'Expand All'
    allPassExpanded = false
  } else {
    cards.forEach(card => card.classList.add('expanded'))
    toggleExpandAllPassBtn.classList.add('all-expanded')
    toggleExpandAllPassBtn.title = 'Collapse All'
    allPassExpanded = true
  }
})

// =========================================================
// Seen List Sort Controls
// =========================================================
const seenSortDropdown = document.getElementById('seen-sort')
const seenSortDirectionBtn = document.getElementById('seen-sort-direction')

if (seenSortDirectionBtn && !seenSortDirectionBtn.dataset.direction) {
  seenSortDirectionBtn.dataset.direction = 'desc'
}

seenSortDropdown?.addEventListener('change', () => {
  const sortField = seenSortDropdown.value
  const direction = seenSortDirectionBtn?.dataset.direction || 'desc'
  window.sortSeenList(`${sortField}-${direction}`)
})

seenSortDirectionBtn?.addEventListener('click', e => {
  e.preventDefault()
  e.stopPropagation()

  const currentDirection =
    seenSortDirectionBtn.dataset.direction === 'asc' ? 'asc' : 'desc'
  const newDirection = currentDirection === 'desc' ? 'asc' : 'desc'
  seenSortDirectionBtn.dataset.direction = newDirection
  seenSortDirectionBtn.textContent = newDirection === 'desc' ? '↓' : '↑'

  const sortField = seenSortDropdown?.value || 'date'
  window.sortSeenList(`${sortField}-${newDirection}`)
})

// =========================================================
// Seen List Expand/Collapse All Button
// =========================================================
const toggleExpandAllSeenBtn = document.getElementById(
  'toggle-expand-all-seen-btn'
)
let allSeenExpanded = false

toggleExpandAllSeenBtn?.addEventListener('click', () => {
  const seenList = document.querySelector('.seen-list')
  if (!seenList) return

  const cards = seenList.querySelectorAll('.watch-card')

  if (allSeenExpanded) {
    cards.forEach(card => card.classList.remove('expanded'))
    toggleExpandAllSeenBtn.classList.remove('all-expanded')
    toggleExpandAllSeenBtn.title = 'Expand All'
    allSeenExpanded = false
  } else {
    cards.forEach(card => card.classList.add('expanded'))
    toggleExpandAllSeenBtn.classList.add('all-expanded')
    toggleExpandAllSeenBtn.title = 'Collapse All'
    allSeenExpanded = true
  }
})

// =========================================================
// Recommendations List Expand/Collapse All Button
// =========================================================
const toggleExpandAllRecommendationsBtn = document.getElementById(
  'toggle-expand-all-recommendations-btn'
)
let allRecommendationsExpanded = false

toggleExpandAllRecommendationsBtn?.addEventListener('click', () => {
  const recommendationsList = document.querySelector('.recommendations-list')
  if (!recommendationsList) return

  const cards = recommendationsList.querySelectorAll('.watch-card')

  if (allRecommendationsExpanded) {
    cards.forEach(card => card.classList.remove('expanded'))
    toggleExpandAllRecommendationsBtn.classList.remove('all-expanded')
    toggleExpandAllRecommendationsBtn.title = 'Expand All'
    allRecommendationsExpanded = false
  } else {
    cards.forEach(card => card.classList.add('expanded'))
    toggleExpandAllRecommendationsBtn.classList.add('all-expanded')
    toggleExpandAllRecommendationsBtn.title = 'Collapse All'
    allRecommendationsExpanded = true
  }
})

watchFilterApply?.addEventListener('click', () => {
  console.log('🧠 Apply button clicked')

  // Collect filter values
  const filters = {
    genres: [],
    languages: [],
    countries: [],
    contentRatings: [],
    yearMin: parseInt(document.getElementById('watch-year-min')?.value) || null,
    yearMax: parseInt(document.getElementById('watch-year-max')?.value) || null,
    tmdbRating:
      parseFloat(document.getElementById('watch-tmdb-rating')?.value) || 0,
    voteCount:
      parseInt(document.getElementById('watch-vote-count')?.value) || 0,
    runtimeMin:
      parseInt(document.getElementById('watch-runtime-min')?.value) || null,
    runtimeMax:
      parseInt(document.getElementById('watch-runtime-max')?.value) || null,
    showPlexOnly: filterState.showPlexOnly,
  }

  // Collect checked genres
  document
    .querySelectorAll('#watch-genre-list input[type="checkbox"]:checked')
    .forEach(cb => {
      filters.genres.push(cb.value)
    })

  // Collect checked languages
  document
    .querySelectorAll('#watch-language-list input[type="checkbox"]:checked')
    .forEach(cb => {
      filters.languages.push(cb.value)
    })

  // Collect checked countries
  document
    .querySelectorAll('#watch-country-list input[type="checkbox"]:checked')
    .forEach(cb => {
      filters.countries.push(cb.value)
    })

  // Collect checked content ratings
  document
    .querySelectorAll('#watch-rating-list input[type="checkbox"]:checked')
    .forEach(cb => {
      filters.contentRatings.push(cb.value)
    })

  console.log('🧩 Filters to apply:', filters)

  // Apply filters to watch list
  applyWatchListFilters(filters)

  closeWatchFilterModal()
})

// Function to apply filters to the watch list - MOVED OUTSIDE
function applyWatchListFilters(filters) {
  console.log('🧩 applyWatchListFilters called with:', filters)

  const likesList = document.querySelector('.likes-list')
  if (!likesList) {
    console.warn('⚠️ .likes-list not found!')
    return
  }

  const cards = Array.from(likesList.querySelectorAll('.watch-card'))
  console.log(`🔍 Found ${cards.length} cards to filter`)

  let hiddenCount = 0

  cards.forEach(card => {
    let shouldShow = true

    // Get movie data from the card
    const yearText = card.querySelector('.watch-card-year')?.textContent
    const year = yearText ? parseInt(yearText.match(/\d+/)?.[0]) : null

    // Get TMDB rating
    const ratingEl = card.querySelector('.watch-card-ratings')
    let tmdbRating = 0
    if (ratingEl) {
      const innerHTML = ratingEl.innerHTML
      const tmdbMatch = innerHTML.match(/tmdb\.svg[^>]*>\s*([\d.]+)/i)
      tmdbRating = tmdbMatch ? parseFloat(tmdbMatch[1]) : 0
    }

    // Get stored filter data from card dataset
    const cardGenres = card.dataset.genres
      ? JSON.parse(card.dataset.genres)
      : []
    const cardLanguages = card.dataset.languages
      ? JSON.parse(card.dataset.languages)
      : []
    const cardCountries = card.dataset.countries
      ? JSON.parse(card.dataset.countries)
      : []
    const cardRating = card.dataset.contentRating || ''
    const cardRuntime = parseInt(card.dataset.runtime) || 0
    const cardVoteCount = parseInt(card.dataset.voteCount) || 0

    console.log(`Checking card: year=${year}, genres=${cardGenres}`)

    // Genre filter - if genres selected, card must have at least one matching genre
    if (filters.genres.length > 0) {
      const hasMatchingGenre = filters.genres.some(filterGenre =>
        cardGenres.includes(parseInt(filterGenre))
      )
      if (!hasMatchingGenre) {
        console.log(`  🧩 Failed genre check`)
        shouldShow = false
      }
    }

    // Language filter
    if (filters.languages.length > 0) {
      const hasMatchingLanguage = filters.languages.some(lang =>
        cardLanguages.includes(lang)
      )
      if (!hasMatchingLanguage) {
        console.log(`  🧩 Failed language check`)
        shouldShow = false
      }
    }

    // Country filter
    if (filters.countries.length > 0) {
      const hasMatchingCountry = filters.countries.some(country =>
        cardCountries.includes(country)
      )
      if (!hasMatchingCountry) {
        console.log(`  🧩 Failed country check`)
        shouldShow = false
      }
    }

    // Content rating filter
    if (filters.contentRatings.length > 0) {
      if (!filters.contentRatings.includes(cardRating)) {
        console.log(`  🧩 Failed content rating check`)
        shouldShow = false
      }
    }

    // Year filter
    if (filters.yearMin && year && year < filters.yearMin) {
      console.log(`  🧩 Failed yearMin: ${year} < ${filters.yearMin}`)
      shouldShow = false
    }
    if (filters.yearMax && year && year > filters.yearMax) {
      console.log(`  🧩 Failed yearMax: ${year} > ${filters.yearMax}`)
      shouldShow = false
    }

    // TMDB Rating filter
    if (filters.tmdbRating > 0 && tmdbRating < filters.tmdbRating) {
      console.log(
        `  🧩 Failed tmdbRating: ${tmdbRating} < ${filters.tmdbRating}`
      )
      shouldShow = false
    }

    // Runtime filter
    if (filters.runtimeMin && cardRuntime && cardRuntime < filters.runtimeMin) {
      console.log(`  🧩 Failed runtimeMin`)
      shouldShow = false
    }
    if (filters.runtimeMax && cardRuntime && cardRuntime > filters.runtimeMax) {
      console.log(`  🧩 Failed runtimeMax`)
      shouldShow = false
    }

    // Vote count filter
    if (filters.voteCount > 0 && cardVoteCount < filters.voteCount) {
      console.log(`  🧩 Failed voteCount`)
      shouldShow = false
    }

    // Show Plex Only filter - only show movies that are in Plex
    if (filters.showPlexOnly) {
      // Check if the card has the plex-status element (indicates movie is in Plex)
      const hasPlexStatus = card.querySelector('.plex-status') !== null
      if (!hasPlexStatus) {
        console.log(`  🧩 Failed showPlexOnly check - not in Plex`)
        shouldShow = false
      }
    }

    // Show/hide card
    if (shouldShow) {
      card.style.display = ''
      console.log('🧠 Showing card')
    } else {
      card.style.display = 'none'
      hiddenCount++
      console.log('🧠 Hiding card')
    }
  })

  // Show notification
  const visibleCards = cards.length - hiddenCount
  console.log(
    `✅ Showing ${visibleCards} of ${cards.length} movies after filtering`
  )

  // Optional: Show a user-facing notification
  if (hiddenCount > 0) {
    showNotification(
      `Filtered: showing ${visibleCards} of ${cards.length} movies`
    )
  }
}

// Dropdown Controls for Watch Filter Modal
const watchDropdowns = [
  { toggle: 'watch-genre-toggle', list: 'watch-genre-list' },
  { toggle: 'watch-language-toggle', list: 'watch-language-list' },
  { toggle: 'watch-country-toggle', list: 'watch-country-list' },
  { toggle: 'watch-rating-toggle', list: 'watch-rating-list' },
]

watchDropdowns.forEach(({ toggle, list }) => {
  const toggleBtn = document.getElementById(toggle)
  const listEl = document.getElementById(list)

  toggleBtn?.addEventListener('click', e => {
    e.stopPropagation()

    console.log('Dropdown clicked:', toggle)
    console.log('List element:', listEl)
    console.log(
      'Has active class before toggle:',
      listEl?.classList.contains('active')
    )

    // Close other dropdowns
    watchDropdowns.forEach(({ toggle: otherToggle, list: otherList }) => {
      if (otherToggle !== toggle) {
        document.getElementById(otherToggle)?.classList.remove('open')
        document.getElementById(otherList)?.classList.remove('active')
      }
    })

    // Toggle current dropdown
    toggleBtn.classList.toggle('open')
    listEl?.classList.toggle('active')

    console.log(
      'Has active class after toggle:',
      listEl?.classList.contains('active')
    )
  })
})

// Watch filter modal - Genre checkboxes
document
  .querySelectorAll('#watch-genre-list input[type="checkbox"]')
  .forEach(cb => {
    cb.addEventListener('change', () => {
      const selectedGenres = Array.from(
        document.querySelectorAll(
          '#watch-genre-list input[type="checkbox"]:checked'
        )
      ).map(checkbox => parseInt(checkbox.value))
      updateWatchGenreButton(selectedGenres)
    })
  })

// Watch filter modal - Language checkboxes
document
  .querySelectorAll('#watch-language-list input[type="checkbox"]')
  .forEach(cb => {
    cb.addEventListener('change', () => {
      const selectedLanguages = Array.from(
        document.querySelectorAll(
          '#watch-language-list input[type="checkbox"]:checked'
        )
      ).map(checkbox => checkbox.value)
      updateWatchLanguageButton(selectedLanguages)
    })
  })

// Watch filter modal - Country checkboxes
document
  .querySelectorAll('#watch-country-list input[type="checkbox"]')
  .forEach(cb => {
    cb.addEventListener('change', () => {
      const selectedCountries = Array.from(
        document.querySelectorAll(
          '#watch-country-list input[type="checkbox"]:checked'
        )
      ).map(checkbox => checkbox.value)
      updateWatchCountryButton(selectedCountries)
    })
  })

// Watch filter modal - Content Rating checkboxes
document
  .querySelectorAll('#watch-rating-list input[type="checkbox"]')
  .forEach(cb => {
    cb.addEventListener('change', () => {
      const selectedRatings = Array.from(
        document.querySelectorAll(
          '#watch-rating-list input[type="checkbox"]:checked'
        )
      ).map(checkbox => checkbox.value)
      updateWatchContentRatingButton(selectedRatings)
    })
  })

// Close dropdowns when clicking outside
document.addEventListener('click', e => {
  if (
    !e.target.closest('.dropdown-button') &&
    !e.target.closest('.dropdown-list')
  ) {
    watchDropdowns.forEach(({ toggle, list }) => {
      document.getElementById(toggle)?.classList.remove('open')
      document.getElementById(list)?.classList.remove('active')
    })
  }
})

// Slider Updates
const watchTmdbRating = document.getElementById('watch-tmdb-rating')
const watchTmdbValue = document.getElementById('watch-tmdb-rating-value')
const watchVoteCount = document.getElementById('watch-vote-count')
const watchVoteValue = document.getElementById('watch-vote-count-value')

watchTmdbRating?.addEventListener('input', e => {
  if (watchTmdbValue) {
    watchTmdbValue.textContent = parseFloat(e.target.value).toFixed(1)
  }
})

watchVoteCount?.addEventListener('input', e => {
  if (watchVoteValue) {
    watchVoteValue.textContent = parseInt(e.target.value).toLocaleString()
  }
})

watchFilterReset?.addEventListener('click', () => {
  document
    .querySelectorAll('#watch-filter-modal input[type="checkbox"]')
    .forEach(cb => (cb.checked = false))
  const yearMin = document.getElementById('watch-year-min')
  const yearMax = document.getElementById('watch-year-max')
  const runtimeMin = document.getElementById('watch-runtime-min')
  const runtimeMax = document.getElementById('watch-runtime-max')

  if (yearMin) yearMin.value = ''
  if (yearMax) yearMax.value = ''
  if (runtimeMin) runtimeMin.value = ''
  if (runtimeMax) runtimeMax.value = ''
  if (watchTmdbRating) watchTmdbRating.value = 0
  if (watchTmdbValue) watchTmdbValue.textContent = '0.0'
  if (watchVoteCount) watchVoteCount.value = 0
  if (watchVoteValue) watchVoteValue.textContent = '0'

  // Reset dropdown button texts
  updateWatchGenreButton([])
  updateWatchLanguageButton([])
  updateWatchCountryButton([])
  updateWatchContentRatingButton([])
})

// =========================================================
// Swipe Filter Modal
// =========================================================
const swipeFilterBtn = document.getElementById('swipe-filter-btn')
const swipeHomeBtn = document.getElementById('swipe-home-btn')
const swipeFilterModal = document.getElementById('swipe-filter-modal')
const swipeFilterOverlay = document.getElementById('swipe-filter-overlay')
const swipeFilterClose = document.getElementById('swipe-filter-close')
const swipeFilterApply = document.getElementById('swipe-filter-apply')
const swipeFilterReset = document.getElementById('swipe-filter-reset')
const defaultsInlineEditor = document.getElementById('defaults-inline-editor')
const swipeFilterTitle = document.getElementById('swipe-filter-title')
const swipeFilterApplyLabel = document.getElementById(
  'swipe-filter-apply-label'
)
let closeSwipeDropdowns = () => {}
let swipeFilterMode = 'live'
let liveSwipeFilterStateRef = null
let swipeFilterModalHomeParent = swipeFilterModal?.parentElement || null
let swipeFilterModalHomeNextSibling =
  swipeFilterModal?.nextElementSibling || null

// Swipe filter modal sliders
const swipeImdbRating = document.getElementById('swipe-imdb-rating')
const swipeImdbValue = document.getElementById('swipe-imdb-rating-value')
const swipeTmdbRating = document.getElementById('swipe-tmdb-rating')
const swipeTmdbValue = document.getElementById('swipe-tmdb-rating-value')
const swipeVoteCount = document.getElementById('swipe-vote-count')
const swipeVoteValue = document.getElementById('swipe-vote-count-value')

// Swipe filter dropdown button update functions
function updateSwipeGenreButton(selected) {
  const btn = document.getElementById('swipe-genre-toggle')
  if (!btn) return
  const count = selected.length
  btn.innerHTML =
    count === 0
      ? 'Select Genres <span class="dropdown-arrow">▼</span>'
      : count === 1
      ? `1 genre <span class="dropdown-arrow">▼</span>`
      : `${count} genres <span class="dropdown-arrow">▼</span>`
}

function updateSwipeLanguageButton(selected) {
  const btn = document.getElementById('swipe-language-toggle')
  if (!btn) return
  const count = selected.length
  btn.innerHTML =
    count === 0
      ? 'Select Languages <span class="dropdown-arrow">▼</span>'
      : count === 1
      ? `1 language <span class="dropdown-arrow">▼</span>`
      : `${count} languages <span class="dropdown-arrow">▼</span>`
}

function updateSwipeCountryButton(selected) {
  const btn = document.getElementById('swipe-country-toggle')
  if (!btn) return
  const count = selected.length
  btn.innerHTML =
    count === 0
      ? 'Select Countries <span class="dropdown-arrow">▼</span>'
      : count === 1
      ? `1 country <span class="dropdown-arrow">▼</span>`
      : `${count} countries <span class="dropdown-arrow">▼</span>`
}

function updateSwipeContentRatingButton(selected) {
  const btn = document.getElementById('swipe-rating-toggle')
  if (!btn) return
  const count = selected.length
  btn.innerHTML =
    count === 0
      ? 'Select Ratings <span class="dropdown-arrow">▼</span>'
      : count === 1
      ? `1 rating <span class="dropdown-arrow">▼</span>`
      : `${count} ratings <span class="dropdown-arrow">▼</span>`
}

function updateSwipeSortButton(sortBy) {
  const btn = document.getElementById('swipe-sort-dropdown-toggle')
  if (!btn) return
  const sortLabels = {
    'popularity.desc': 'Popularity',
    'popularity.asc': 'Popularity',
    'release_date.desc': 'Release Date',
    'release_date.asc': 'Release Date',
    'vote_count.desc': 'Votes',
    'vote_count.asc': 'Votes',
    'vote_average.desc': 'Rating',
    'vote_average.asc': 'Rating',
  }
  const baseSortBy = sortBy.replace('.asc', '.desc')
  btn.innerHTML = `${
    sortLabels[baseSortBy] || 'Popularity'
  } <span class="dropdown-arrow">▼</span>`
}

function parsePaidServices() {
  const fromWindow = parseArraySetting(window.PAID_STREAMING_SERVICES)
  if (fromWindow.length > 0) return fromWindow
  return parseArraySetting(
    document.getElementById('setting-paid-streaming-services')?.value
  )
}

function parsePersonalSources() {
  return parseArraySetting(window.PERSONAL_MEDIA_SOURCES)
}

function updateHostManagedSubscriptionServiceOptions() {
  const hostManagedServices = new Set(
    parsePersonalSources().map(source => String(source).trim().toLowerCase())
  )

  if (window.PLEX_CONFIGURED) {
    hostManagedServices.add('plex')
  }

  if (window.EMBY_CONFIGURED) {
    hostManagedServices.add('emby')
  }

  if (window.JELLYFIN_CONFIGURED) {
    hostManagedServices.add('jellyfin')
  }

  document
    .querySelectorAll('[data-host-managed-personal-service]')
    .forEach(option => {
      const service = String(
        option.dataset.hostManagedPersonalService || ''
      ).toLowerCase()
      const input = option.querySelector('input[type="checkbox"]')
      const isEnabled = hostManagedServices.has(service)

      option.toggleAttribute('hidden', !isEnabled)
      option.style.display = isEnabled ? '' : 'none'

      if (input) {
        input.checked = isEnabled
        input.disabled = true
      }
    })
}

function getAvailableSubscriptionOptions() {
  const paidServices = parsePaidServices().map(value => String(value).trim())
  const personalSources = parsePersonalSources().map(value =>
    String(value).trim()
  )

  if (window.PLEX_CONFIGURED && !personalSources.includes('plex')) {
    personalSources.push('plex')
  }

  if (window.EMBY_CONFIGURED && !personalSources.includes('emby')) {
    personalSources.push('emby')
  }

  if (window.JELLYFIN_CONFIGURED && !personalSources.includes('jellyfin')) {
    personalSources.push('jellyfin')
  }

  return {
    paidServices: Array.from(new Set(paidServices)),
    personalSources: Array.from(new Set(personalSources)),
  }
}

function getVisibleSubscriptionOptions() {
  return Array.from(
    document.querySelectorAll(
      '#swipe-subscriptions-options input[type="checkbox"][value]'
    )
  )
    .filter(
      input =>
        !input.disabled && input.closest('label')?.style.display !== 'none'
    )
    .map(input => input.value)
}

function getVisibleFreeStreamingOptions() {
  return Array.from(
    document.querySelectorAll(
      '#swipe-free-options input[type="checkbox"][value]'
    )
  )
    .filter(
      input =>
        !input.disabled && input.closest('label')?.style.display !== 'none'
    )
    .map(input => input.value)
}

function syncFreeStreamingOptionVisibility() {
  const freeSet = new Set(FREE_STREAMING_SERVICE_OPTIONS)

  document
    .querySelectorAll('#swipe-free-options input[type="checkbox"][value]')
    .forEach(input => {
      const service = String(input.value || '').trim()
      const isAvailable = freeSet.has(service)
      const wrapper = input.closest('label')
      if (wrapper) wrapper.style.display = isAvailable ? '' : 'none'
      input.disabled = !isAvailable
      if (!isAvailable) input.checked = false
    })

  const selected = Array.isArray(
    window.filterState?.availability?.freeStreamingServices
  )
    ? window.filterState.availability.freeStreamingServices
    : []

  const visibleOptionSet = new Set(getVisibleFreeStreamingOptions())
  const nextSelected = selected.filter(service => visibleOptionSet.has(service))

  if (window.filterState?.availability) {
    window.filterState.availability.freeStreamingServices = nextSelected
  }

  document
    .querySelectorAll('#swipe-free-options input[type="checkbox"][value]')
    .forEach(input => {
      input.checked = nextSelected.includes(input.value)
    })
}

function syncSubscriptionOptionVisibility() {
  const { paidServices, personalSources } = getAvailableSubscriptionOptions()
  const availableSet = new Set([...paidServices, ...personalSources])

  document
    .querySelectorAll(
      '#swipe-subscriptions-options input[type="checkbox"][value]'
    )
    .forEach(input => {
      const service = String(input.value || '').trim()
      const isAvailable = availableSet.has(service)
      const wrapper = input.closest('label')
      if (wrapper) wrapper.style.display = isAvailable ? '' : 'none'
      input.disabled = !isAvailable
      if (!isAvailable) input.checked = false
    })

  const selected = Array.isArray(
    window.filterState?.availability?.subscriptionServices
  )
    ? window.filterState.availability.subscriptionServices
    : []

  const visibleOptionSet = new Set(
    Array.from(
      document.querySelectorAll(
        '#swipe-subscriptions-options input[type="checkbox"][value]'
      )
    ).map(input => String(input.value || '').trim())
  )

  const nextSelected = selected.filter(service => visibleOptionSet.has(service))
  if (window.filterState?.availability) {
    window.filterState.availability.subscriptionServices = nextSelected
    window.filterState.availability.roomPersonalMedia = nextSelected.some(
      service => personalSources.includes(service)
    )
    window.filterState.availability.paidSubscriptions = nextSelected.some(
      service => paidServices.includes(service)
    )
  }

  document
    .querySelectorAll(
      '#swipe-subscriptions-options input[type="checkbox"][value]'
    )
    .forEach(input => {
      input.checked = nextSelected.includes(input.value)
    })
}

function updateSwipeAvailabilityUI() {
  syncSubscriptionOptionVisibility()
  syncFreeStreamingOptionVisibility()

  const availability = normalizeAvailabilityState(
    window.filterState?.availability,
    {
      enforceSelection: false,
    }
  )
  const anywhereInput = document.getElementById('swipe-availability-anywhere')
  const subscriptionsInput = document.getElementById(
    'swipe-availability-subscriptions'
  )
  const subscriptionInputs = Array.from(
    document.querySelectorAll(
      '#swipe-subscriptions-options input[type="checkbox"][value]'
    )
  )
  const freeInput = document.getElementById('swipe-availability-free')
  const freeStreamingInputs = Array.from(
    document.querySelectorAll(
      '#swipe-free-options input[type="checkbox"][value]'
    )
  )
  const { paidServices, personalSources } = getAvailableSubscriptionOptions()
  const subscriptionsConfigured =
    paidServices.length + personalSources.length > 0
  const selectedSubscriptions = availability.subscriptionServices || []
  const selectedFreeServices = availability.freeStreamingServices || []
  const selectedSubscriptionSet = new Set(selectedSubscriptions)
  const anySubscriptionSelected = selectedSubscriptions.length > 0

  if (anywhereInput) anywhereInput.checked = availability.anywhere
  if (subscriptionsInput) {
    subscriptionsInput.checked = anySubscriptionSelected
    subscriptionsInput.disabled = !subscriptionsConfigured
    const visibleSubscriptionCount = getVisibleSubscriptionOptions().length
    subscriptionsInput.indeterminate =
      anySubscriptionSelected &&
      selectedSubscriptions.length > 0 &&
      selectedSubscriptions.length < visibleSubscriptionCount
  }
  subscriptionInputs.forEach(input => {
    input.checked = selectedSubscriptionSet.has(input.value)
    input.disabled = !subscriptionsConfigured || input.disabled
  })
  if (freeInput) {
    freeInput.checked = availability.freeStreaming
    freeInput.disabled = false
    const visibleFreeCount = getVisibleFreeStreamingOptions().length
    freeInput.indeterminate =
      availability.freeStreaming &&
      selectedFreeServices.length > 0 &&
      selectedFreeServices.length < visibleFreeCount
  }

  const selectedFreeSet = new Set(selectedFreeServices)
  freeStreamingInputs.forEach(input => {
    input.checked = selectedFreeSet.has(input.value)
    input.disabled = !availability.freeStreaming || input.disabled
  })

  const toggle = document.getElementById('swipe-availability-toggle')
  if (toggle) {
    let label = 'Anywhere'
    if (!availability.anywhere) {
      const selected = []
      if (selectedSubscriptions.length > 0) {
        selected.push(
          selectedSubscriptions.length > 1
            ? `My Subscriptions (${selectedSubscriptions.length})`
            : 'My Subscriptions'
        )
      }
      if (availability.freeStreaming) {
        selected.push(
          selectedFreeServices.length > 1
            ? `Free Streaming (${selectedFreeServices.length})`
            : 'Free Streaming'
        )
      }
      label = selected.length > 0 ? selected.join(', ') : 'Custom'
    }
    toggle.innerHTML = `${label} <span class="dropdown-arrow">▼</span>`
  }
}

function setAvailabilityState(nextState) {
  if (!window.filterState) return
  window.filterState.availability = normalizeAvailabilityState(nextState, {
    enforceSelection: false,
  })

  window.filterState.showPlexOnly = deriveShowPlexOnlyFromAvailability(
    window.filterState.availability
  )
  const oldToggle = document.getElementById('plex-only-toggle')
  if (oldToggle) {
    oldToggle.checked = window.filterState.showPlexOnly
  }
  updateSwipeAvailabilityUI()
}

function applyUserSubscriptions(services) {
  if (!Array.isArray(services)) return
  if (!window.filterState) return
  if (!services.length) {
    // User cleared all subscriptions — reset availability to "anywhere"
    setAvailabilityState({
      ...(window.filterState.availability || getDefaultAvailabilityState()),
      subscriptionServices: [],
      paidSubscriptions: false,
      anywhere: true,
    })
    return
  }
  setAvailabilityState({
    ...(window.filterState.availability || getDefaultAvailabilityState()),
    subscriptionServices: services,
    paidSubscriptions: true,
    anywhere: false,
  })
}

// Sync swipe filter modal UI with filterState
function syncSwipeFilterModalWithState() {
  // Year range
  const yearMin = document.getElementById('swipe-year-min')
  const yearMax = document.getElementById('swipe-year-max')
  if (yearMin && window.filterState)
    yearMin.value = window.filterState.yearRange?.min || ''
  if (yearMax && window.filterState)
    yearMax.value = window.filterState.yearRange?.max || ''

  // Runtime
  const runtimeMin = document.getElementById('swipe-runtime-min')
  const runtimeMax = document.getElementById('swipe-runtime-max')
  if (runtimeMin && window.filterState)
    runtimeMin.value = window.filterState.runtimeRange?.min || ''
  if (runtimeMax && window.filterState)
    runtimeMax.value = window.filterState.runtimeRange?.max || ''

  // Sliders
  if (swipeImdbRating && window.filterState) {
    swipeImdbRating.value = window.filterState.imdbRating || 0
    if (swipeImdbValue)
      swipeImdbValue.textContent = (window.filterState.imdbRating || 0).toFixed(
        1
      )
  }
  if (swipeTmdbRating && window.filterState) {
    swipeTmdbRating.value = window.filterState.tmdbRating || 0
    if (swipeTmdbValue)
      swipeTmdbValue.textContent = (window.filterState.tmdbRating || 0).toFixed(
        1
      )
  }
  if (swipeVoteCount && window.filterState) {
    swipeVoteCount.value = window.filterState.voteCount || 0
    if (swipeVoteValue)
      swipeVoteValue.textContent = (
        window.filterState.voteCount || 0
      ).toLocaleString()
  }

  updateSwipeAvailabilityUI()

  // Sort
  if (window.filterState?.sortBy) {
    const sortRadios = document.querySelectorAll('input[name="swipe-sort"]')
    const baseSortBy = window.filterState.sortBy.replace('.asc', '.desc')
    sortRadios.forEach(radio => {
      radio.checked = radio.value === baseSortBy
    })
    updateSwipeSortButton(window.filterState.sortBy)

    // Update direction button
    const dirBtn = document.getElementById('swipe-sort-direction-btn')
    if (dirBtn) {
      const isAsc = window.filterState.sortBy.endsWith('.asc')
      dirBtn.textContent = isAsc ? '↑' : '↓'
      dirBtn.dataset.direction = isAsc ? 'asc' : 'desc'
    }
  }

  // Checkboxes - Genres
  document
    .querySelectorAll('#swipe-genre-list input[type="checkbox"]')
    .forEach(cb => {
      const val = parseInt(cb.value)
      cb.checked = window.filterState?.genres?.includes(val) || false
    })
  updateSwipeGenreButton(window.filterState?.genres || [])

  // Checkboxes - Languages
  document
    .querySelectorAll('#swipe-language-list input[type="checkbox"]')
    .forEach(cb => {
      cb.checked = window.filterState?.languages?.includes(cb.value) || false
    })
  updateSwipeLanguageButton(window.filterState?.languages || [])

  // Checkboxes - Countries
  document
    .querySelectorAll('#swipe-country-list input[type="checkbox"]')
    .forEach(cb => {
      cb.checked = window.filterState?.countries?.includes(cb.value) || false
    })
  updateSwipeCountryButton(window.filterState?.countries || [])

  // Checkboxes - Content Ratings
  document
    .querySelectorAll('#swipe-rating-list input[type="checkbox"]')
    .forEach(cb => {
      cb.checked =
        window.filterState?.contentRatings?.includes(cb.value) || false
    })
  updateSwipeContentRatingButton(window.filterState?.contentRatings || [])
}

// Check if any filters are active (for button styling)
function hasActiveSwipeFilters() {
  if (!window.filterState) return false
  const fs = window.filterState
  const currentYear = new Date().getFullYear()
  return (
    fs.genres?.length > 0 ||
    fs.contentRatings?.length > 0 ||
    fs.countries?.length > 0 ||
    (fs.languages?.length > 0 &&
      !(fs.languages.length === 1 && fs.languages[0] === 'en')) ||
    !fs.availability?.anywhere ||
    fs.showPlexOnly ||
    fs.imdbRating > 0 ||
    fs.tmdbRating > 0 ||
    fs.voteCount > 0 ||
    (fs.yearRange?.min && fs.yearRange.min > 1895) ||
    (fs.yearRange?.max && fs.yearRange.max < currentYear) ||
    (fs.runtimeRange?.min && fs.runtimeRange.min > 0) ||
    (fs.runtimeRange?.max && fs.runtimeRange.max < 300)
  )
}

function updateSwipeFilterButtonState() {
  if (swipeFilterBtn) {
    swipeFilterBtn.classList.toggle('has-filters', hasActiveSwipeFilters())
  }
}

function describeSwipeDefaults(defaults) {
  if (!defaults) return 'No saved defaults yet.'

  const activeBits = []
  if (defaults.genres?.length)
    activeBits.push(`${defaults.genres.length} genres`)
  if (defaults.languages?.length)
    activeBits.push(`${defaults.languages.length} languages`)
  if (defaults.countries?.length)
    activeBits.push(`${defaults.countries.length} countries`)
  if (defaults.contentRatings?.length)
    activeBits.push(`${defaults.contentRatings.length} ratings`)
  if (!defaults.availability?.anywhere)
    activeBits.push('availability constrained')
  if (defaults.imdbRating > 0)
    activeBits.push(`IMDb ≥ ${defaults.imdbRating.toFixed(1)}`)
  if (defaults.tmdbRating > 0)
    activeBits.push(`TMDb ≥ ${defaults.tmdbRating.toFixed(1)}`)
  if (defaults.voteCount > 0)
    activeBits.push(`Votes ≥ ${defaults.voteCount.toLocaleString()}`)

  if (activeBits.length === 0) {
    return 'Saved defaults match broad discovery (minimal filtering).'
  }

  return `Saved defaults: ${activeBits.join(' • ')}`
}

function refreshDefaultsSummary() {
  // Defaults are now edited inline, so no summary text is shown.
}

function applyFilterStatePatch(nextState) {
  if (!window.filterState || !nextState) return
  Object.assign(window.filterState, cloneFilterStateValue(nextState))
  window.filterState.availability = normalizeAvailabilityState(
    window.filterState.availability
  )
  window.filterState.showPlexOnly = deriveShowPlexOnlyFromAvailability(
    window.filterState.availability,
    window.filterState.showPlexOnly
  )

  syncSwipeFilterModalWithState()
  updateSwipeFilterButtonState()
}

function updateSwipeFilterModalModeUI() {
  if (swipeFilterTitle) {
    swipeFilterTitle.innerHTML =
      swipeFilterMode === 'defaults'
        ? '<i class="fas fa-filter"></i> Default Swipe Filters'
        : '<i class="fas fa-filter"></i> Movie Filters'
  }
  if (swipeFilterApplyLabel) {
    swipeFilterApplyLabel.textContent =
      swipeFilterMode === 'defaults' ? 'Save Changes' : 'Apply'
  }
}

function enterDefaultsInlineEditor() {
  if (!swipeFilterModal || !defaultsInlineEditor || !window.filterState) return

  swipeFilterMode = 'defaults'
  liveSwipeFilterStateRef = window.filterState
  const baseState =
    loadSavedSwipeFilterDefaults() ||
    normalizeFilterStateForDefaults(liveSwipeFilterStateRef)
  window.filterState = cloneFilterStateValue(baseState)

  defaultsInlineEditor.appendChild(swipeFilterModal)
  swipeFilterModal.classList.add('active', 'inline-defaults-mode')
  swipeFilterOverlay?.classList.remove('active')

  updateSwipeFilterModalModeUI()
  syncSwipeFilterModalWithState()
}

function exitDefaultsInlineEditor() {
  if (!swipeFilterModal) return

  closeSwipeDropdowns()

  if (
    swipeFilterModalHomeParent &&
    swipeFilterModal.parentElement !== swipeFilterModalHomeParent
  ) {
    if (
      swipeFilterModalHomeNextSibling &&
      swipeFilterModalHomeNextSibling.parentElement ===
        swipeFilterModalHomeParent
    ) {
      swipeFilterModalHomeParent.insertBefore(
        swipeFilterModal,
        swipeFilterModalHomeNextSibling
      )
    } else {
      swipeFilterModalHomeParent.appendChild(swipeFilterModal)
    }
  }

  if (swipeFilterMode === 'defaults' && liveSwipeFilterStateRef) {
    window.filterState = liveSwipeFilterStateRef
    liveSwipeFilterStateRef = null
  }

  swipeFilterMode = 'live'
  swipeFilterModal.classList.remove('inline-defaults-mode')
  swipeFilterModal.classList.remove('active')
  updateSwipeFilterModalModeUI()
}

function openSwipeFilterModal(mode = 'live') {
  closeSwipeDropdowns()

  if (mode === 'live') {
    exitDefaultsInlineEditor()
  }

  swipeFilterMode = mode

  if (mode === 'defaults') {
    liveSwipeFilterStateRef = window.filterState
    const baseState =
      loadSavedSwipeFilterDefaults() ||
      normalizeFilterStateForDefaults(liveSwipeFilterStateRef)
    window.filterState = cloneFilterStateValue(baseState)
  }

  updateSwipeFilterModalModeUI()
  syncSwipeFilterModalWithState()
  swipeFilterModal?.classList.add('active')
  swipeFilterOverlay?.classList.add('active')
}

function closeSwipeFilterModal() {
  closeSwipeDropdowns()

  if (swipeFilterModal?.classList.contains('inline-defaults-mode')) return

  swipeFilterModal?.classList.remove('active')
  swipeFilterOverlay?.classList.remove('active')

  if (swipeFilterMode === 'defaults' && liveSwipeFilterStateRef) {
    window.filterState = liveSwipeFilterStateRef
    liveSwipeFilterStateRef = null
  }

  swipeFilterMode = 'live'
  updateSwipeFilterModalModeUI()
}

swipeFilterBtn?.addEventListener('click', () => openSwipeFilterModal('live'))
swipeFilterClose?.addEventListener('click', closeSwipeFilterModal)
swipeFilterOverlay?.addEventListener('click', closeSwipeFilterModal)

function returnToModeSelection() {
  closeSwipeFilterModal()
  sessionStorage.setItem('comparrReturnToModeSelection', '1')
  window.location.reload()
}

const swipeHeaderHomeButtons = document.querySelectorAll(
  '.swipe-header .js-home-btn'
)
if (swipeHeaderHomeButtons.length > 1) {
  swipeHeaderHomeButtons.forEach((button, index) => {
    if (index < swipeHeaderHomeButtons.length - 1) {
      button.remove()
    }
  })
}

const homeButtons = document.querySelectorAll('.js-home-btn')
homeButtons.forEach(button => {
  button.addEventListener('click', returnToModeSelection)
})

// Setup swipe filter modal dropdowns
function setupSwipeFilterDropdowns() {
  const overlay =
    document.getElementById('filter-dropdown-overlay') ||
    (() => {
      const el = document.createElement('div')
      el.id = 'filter-dropdown-overlay'
      el.style.cssText =
        'position: fixed; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 10000;'
      document.body.appendChild(el)
      return el
    })()

  const pairs = [
    {
      type: 'swipe-genre',
      toggle: document.getElementById('swipe-genre-toggle'),
      list: document.getElementById('swipe-genre-list'),
      checkboxes: document.querySelectorAll(
        '#swipe-genre-list input[type="checkbox"]'
      ),
    },
    {
      type: 'swipe-language',
      toggle: document.getElementById('swipe-language-toggle'),
      list: document.getElementById('swipe-language-list'),
      checkboxes: document.querySelectorAll(
        '#swipe-language-list input[type="checkbox"]'
      ),
    },
    {
      type: 'swipe-country',
      toggle: document.getElementById('swipe-country-toggle'),
      list: document.getElementById('swipe-country-list'),
      checkboxes: document.querySelectorAll(
        '#swipe-country-list input[type="checkbox"]'
      ),
    },
    {
      type: 'swipe-rating',
      toggle: document.getElementById('swipe-rating-toggle'),
      list: document.getElementById('swipe-rating-list'),
      checkboxes: document.querySelectorAll(
        '#swipe-rating-list input[type="checkbox"]'
      ),
    },
    {
      type: 'swipe-availability',
      toggle: document.getElementById('swipe-availability-toggle'),
      list: document.getElementById('swipe-availability-list'),
      checkboxes: document.querySelectorAll(
        '#swipe-availability-list input[type="checkbox"]'
      ),
    },
    {
      type: 'swipe-sort',
      toggle: document.getElementById('swipe-sort-dropdown-toggle'),
      list: document.getElementById('swipe-sort-dropdown-list'),
      radios: document.querySelectorAll('input[name="swipe-sort"]'),
    },
  ]

  let currentOpen = null

  function closeAllSwipeDropdowns() {
    pairs.forEach(p => {
      if (p.list) {
        p.list.style.display = 'none'
        p.list.style.pointerEvents = 'none'
      }
      if (p.toggle) p.toggle.classList.remove('open')
    })
    currentOpen = null
  }

  closeSwipeDropdowns = closeAllSwipeDropdowns

  function openSwipeDropdown(pair) {
    if (!pair.toggle || !pair.list) return

    const positionSwipeDropdown = targetPair => {
      if (!targetPair?.toggle || !targetPair?.list) return
      const rect = targetPair.toggle.getBoundingClientRect()
      targetPair.list.style.top = `${rect.bottom + 4}px`
      targetPair.list.style.left = `${rect.left}px`
      targetPair.list.style.width = `${Math.max(rect.width, 200)}px`
    }

    overlay.appendChild(pair.list)
    pair.list.style.cssText = `
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      width: 200px !important;
      max-height: 250px !important;
      display: block !important;
      visibility: visible !important;
      opacity: 1 !important;
      pointer-events: auto !important;
      z-index: 10001 !important;
      background: var(--gradient-surface) !important;
      border: 1px solid rgba(51, 65, 85, 0.5) !important;
      border-radius: var(--radius-md) !important;
      overflow-y: auto !important;
      backdrop-filter: blur(20px) !important;
      box-shadow: var(--shadow-xl) !important;
    `
    pair.toggle.classList.add('open')
    currentOpen = pair.type

    positionSwipeDropdown(pair)

    if (!openSwipeDropdown.refreshPosition) {
      let positionUpdateQueued = false
      openSwipeDropdown.refreshPosition = () => {
        if (positionUpdateQueued) return
        positionUpdateQueued = true
        requestAnimationFrame(() => {
          positionUpdateQueued = false
          if (!currentOpen) return
          const openPair = pairs.find(p => p.type === currentOpen)
          if (!openPair) return
          positionSwipeDropdown(openPair)
        })
      }

      document.addEventListener('scroll', openSwipeDropdown.refreshPosition, {
        passive: true,
        capture: true,
      })
      window.addEventListener('scroll', openSwipeDropdown.refreshPosition, {
        passive: true,
      })
      window.addEventListener('resize', closeAllSwipeDropdowns)
    }
  }

  pairs.forEach(pair => {
    if (!pair.toggle || !pair.list) return

    const handleToggle = e => {
      e.preventDefault()
      e.stopPropagation()
      if (currentOpen === pair.type) {
        closeAllSwipeDropdowns()
      } else {
        closeAllSwipeDropdowns()
        setTimeout(() => openSwipeDropdown(pair), 10)
      }
    }

    pair.toggle.addEventListener('touchend', handleToggle, { passive: false })
    pair.toggle.addEventListener('click', handleToggle)
    pair.list.addEventListener('click', e => e.stopPropagation())

    // Genre checkboxes
    if (pair.type === 'swipe-genre' && pair.checkboxes) {
      pair.checkboxes.forEach(cb => {
        cb.addEventListener('change', e => {
          const val = parseInt(e.target.value)
          if (e.target.checked) {
            if (!window.filterState.genres.includes(val))
              window.filterState.genres.push(val)
          } else {
            window.filterState.genres = window.filterState.genres.filter(
              id => id !== val
            )
          }
          updateSwipeGenreButton(window.filterState.genres)
          // Also sync the old Filters tab
          document
            .querySelectorAll('#genre-dropdown-list input[type="checkbox"]')
            .forEach(oldCb => {
              if (parseInt(oldCb.value) === val)
                oldCb.checked = e.target.checked
            })
        })
      })
    }

    // Language checkboxes
    if (pair.type === 'swipe-language' && pair.checkboxes) {
      pair.checkboxes.forEach(cb => {
        cb.addEventListener('change', e => {
          const val = e.target.value
          if (e.target.checked) {
            if (!window.filterState.languages.includes(val))
              window.filterState.languages.push(val)
          } else {
            window.filterState.languages = window.filterState.languages.filter(
              l => l !== val
            )
          }
          updateSwipeLanguageButton(window.filterState.languages)
          document
            .querySelectorAll('#language-dropdown-list input[type="checkbox"]')
            .forEach(oldCb => {
              if (oldCb.value === val) oldCb.checked = e.target.checked
            })
        })
      })
    }

    // Country checkboxes
    if (pair.type === 'swipe-country' && pair.checkboxes) {
      pair.checkboxes.forEach(cb => {
        cb.addEventListener('change', e => {
          const val = e.target.value
          if (e.target.checked) {
            if (!window.filterState.countries.includes(val))
              window.filterState.countries.push(val)
          } else {
            window.filterState.countries = window.filterState.countries.filter(
              c => c !== val
            )
          }
          updateSwipeCountryButton(window.filterState.countries)
          document
            .querySelectorAll('#country-dropdown-list input[type="checkbox"]')
            .forEach(oldCb => {
              if (oldCb.value === val) oldCb.checked = e.target.checked
            })
        })
      })
    }

    // Content Rating checkboxes
    if (pair.type === 'swipe-rating' && pair.checkboxes) {
      pair.checkboxes.forEach(cb => {
        cb.addEventListener('change', e => {
          const val = e.target.value
          if (e.target.checked) {
            if (!window.filterState.contentRatings.includes(val))
              window.filterState.contentRatings.push(val)
          } else {
            window.filterState.contentRatings = window.filterState.contentRatings.filter(
              r => r !== val
            )
          }
          updateSwipeContentRatingButton(window.filterState.contentRatings)
          document
            .querySelectorAll('#rating-dropdown-list input[type="checkbox"]')
            .forEach(oldCb => {
              if (oldCb.value === val) oldCb.checked = e.target.checked
            })
        })
      })
    }

    // Sort radios
    if (pair.type === 'swipe-sort' && pair.radios) {
      pair.radios.forEach(radio => {
        radio.addEventListener('change', e => {
          if (e.target.checked) {
            const dirBtn = document.getElementById('swipe-sort-direction-btn')
            const direction = dirBtn?.dataset.direction || 'desc'
            const baseValue = e.target.value.replace(/\.(asc|desc)$/, '')
            window.filterState.sortBy = `${baseValue}.${direction}`
            updateSwipeSortButton(window.filterState.sortBy)
            // Also sync old Filters tab
            document
              .querySelectorAll('input[name="sort"]')
              .forEach(oldRadio => {
                if (oldRadio.value === e.target.value) oldRadio.checked = true
              })
            setTimeout(closeAllSwipeDropdowns, 100)
          }
        })
      })
    }
  })

  // Sort direction button
  const swipeSortDirBtn = document.getElementById('swipe-sort-direction-btn')
  swipeSortDirBtn?.addEventListener('click', e => {
    e.preventDefault()
    const currentDir = swipeSortDirBtn.dataset.direction || 'desc'
    const newDir = currentDir === 'desc' ? 'asc' : 'desc'
    swipeSortDirBtn.dataset.direction = newDir
    swipeSortDirBtn.textContent = newDir === 'asc' ? '↑' : '↓'

    // Update filterState.sortBy
    if (window.filterState?.sortBy) {
      const baseSort = window.filterState.sortBy.replace(/\.(asc|desc)$/, '')
      window.filterState.sortBy = `${baseSort}.${newDir}`

      // Sync old Filters tab direction button
      const oldDirBtn = document.getElementById('sort-direction-btn')
      if (oldDirBtn) {
        oldDirBtn.dataset.direction = newDir
        oldDirBtn.textContent = newDir === 'asc' ? '↑' : '↓'
      }
    }
  })

  // Close dropdowns on outside click within modal
  swipeFilterModal?.addEventListener('click', e => {
    if (currentOpen) {
      const clickedInside = pairs.some(
        p => p.toggle?.contains(e.target) || p.list?.contains(e.target)
      )
      if (!clickedInside) closeAllSwipeDropdowns()
    }
  })
}

// Slider event listeners
swipeImdbRating?.addEventListener('input', e => {
  const val = parseFloat(e.target.value)
  if (swipeImdbValue) swipeImdbValue.textContent = val.toFixed(1)
  if (window.filterState) window.filterState.imdbRating = val
  // Sync old slider
  const oldSlider = document.getElementById('imdb-rating')
  const oldValue = document.getElementById('imdb-rating-value')
  if (oldSlider) oldSlider.value = val
  if (oldValue) oldValue.textContent = val.toFixed(1)
})

swipeTmdbRating?.addEventListener('input', e => {
  const val = parseFloat(e.target.value)
  if (swipeTmdbValue) swipeTmdbValue.textContent = val.toFixed(1)
  if (window.filterState) window.filterState.tmdbRating = val
  const oldSlider = document.getElementById('tmdb-rating')
  const oldValue = document.getElementById('tmdb-rating-value')
  if (oldSlider) oldSlider.value = val
  if (oldValue) oldValue.textContent = val.toFixed(1)
})

swipeVoteCount?.addEventListener('input', e => {
  const val = parseInt(e.target.value)
  if (swipeVoteValue) swipeVoteValue.textContent = val.toLocaleString()
  if (window.filterState) window.filterState.voteCount = val
  const oldSlider = document.getElementById('vote-count')
  const oldValue = document.getElementById('vote-count-value')
  if (oldSlider) oldSlider.value = val
  if (oldValue) oldValue.textContent = val.toLocaleString()
})

// Year range inputs
document.getElementById('swipe-year-min')?.addEventListener('change', e => {
  const val = parseInt(e.target.value) || 1895
  if (window.filterState) window.filterState.yearRange.min = val
  const oldInput = document.getElementById('year-min')
  if (oldInput) oldInput.value = val
})

document.getElementById('swipe-year-max')?.addEventListener('change', e => {
  const val = parseInt(e.target.value) || new Date().getFullYear()
  if (window.filterState) window.filterState.yearRange.max = val
  const oldInput = document.getElementById('year-max')
  if (oldInput) oldInput.value = val
})

// Runtime range inputs
document.getElementById('swipe-runtime-min')?.addEventListener('change', e => {
  const val = parseInt(e.target.value) || 0
  if (window.filterState) window.filterState.runtimeRange.min = val
  const oldInput = document.getElementById('runtime-min')
  if (oldInput) oldInput.value = val
})

document.getElementById('swipe-runtime-max')?.addEventListener('change', e => {
  const val = parseInt(e.target.value) || 300
  if (window.filterState) window.filterState.runtimeRange.max = val
  const oldInput = document.getElementById('runtime-max')
  if (oldInput) oldInput.value = val
})

// Availability controls
const swipeAvailabilityAnywhere = document.getElementById(
  'swipe-availability-anywhere'
)
const swipeAvailabilitySubscriptions = document.getElementById(
  'swipe-availability-subscriptions'
)
const swipeAvailabilityFree = document.getElementById('swipe-availability-free')
const swipeSubscriptionChildren = Array.from(
  document.querySelectorAll(
    '#swipe-subscriptions-options input[type="checkbox"][value]'
  )
)
const swipeFreeStreamingChildren = Array.from(
  document.querySelectorAll('#swipe-free-options input[type="checkbox"][value]')
)

swipeAvailabilityAnywhere?.addEventListener('change', e => {
  if (e.target.checked) {
    setAvailabilityState(getDefaultAvailabilityState())
  } else {
    const selectedSubscriptionServices = swipeSubscriptionChildren
      .filter(input => input.checked)
      .map(input => input.value)
    const selectedSet = new Set(selectedSubscriptionServices)
    const selectedFreeServices = swipeFreeStreamingChildren
      .filter(input => input.checked)
      .map(input => input.value)
    const personalSet = new Set(
      getAvailableSubscriptionOptions().personalSources.map(service =>
        String(service).trim().toLowerCase()
      )
    )
    const paidSet = new Set(
      parsePaidServices().map(service => String(service).trim().toLowerCase())
    )
    const freeStreamingEnabled = Boolean(swipeAvailabilityFree?.checked)
    setAvailabilityState({
      anywhere: false,
      roomPersonalMedia: selectedSubscriptionServices.some(service =>
        personalSet.has(String(service).trim().toLowerCase())
      ),
      paidSubscriptions: selectedSubscriptionServices.some(service =>
        paidSet.has(String(service).trim().toLowerCase())
      ),
      freeStreaming: freeStreamingEnabled,
      subscriptionServices: Array.from(selectedSet),
      freeStreamingServices: freeStreamingEnabled ? selectedFreeServices : [],
    })
  }
})
;[swipeAvailabilitySubscriptions, swipeAvailabilityFree].forEach(input => {
  input?.addEventListener('change', () => {
    const personalSet = new Set(
      getAvailableSubscriptionOptions().personalSources.map(service =>
        String(service).trim().toLowerCase()
      )
    )
    const paidSet = new Set(
      parsePaidServices().map(service => String(service).trim().toLowerCase())
    )

    if (input === swipeAvailabilitySubscriptions) {
      if (swipeAvailabilitySubscriptions.checked) {
        const visible = getVisibleSubscriptionOptions()
        swipeSubscriptionChildren.forEach(child => {
          if (visible.includes(child.value)) child.checked = true
        })
      } else {
        swipeSubscriptionChildren.forEach(child => {
          child.checked = false
        })
      }
    }

    if (input === swipeAvailabilityFree) {
      if (swipeAvailabilityFree.checked) {
        const visibleFree = getVisibleFreeStreamingOptions()
        swipeFreeStreamingChildren.forEach(child => {
          if (visibleFree.includes(child.value)) child.checked = true
        })
      } else {
        swipeFreeStreamingChildren.forEach(child => {
          child.checked = false
        })
      }
    }

    const selectedAfterToggle = swipeSubscriptionChildren
      .filter(child => child.checked)
      .map(child => child.value)
    const selectedFreeAfterToggle = swipeFreeStreamingChildren
      .filter(child => child.checked)
      .map(child => child.value)
    const freeStreamingEnabled = Boolean(swipeAvailabilityFree?.checked)

    const next = {
      anywhere: false,
      roomPersonalMedia: selectedAfterToggle.some(service =>
        personalSet.has(String(service).trim().toLowerCase())
      ),
      paidSubscriptions: selectedAfterToggle.some(service =>
        paidSet.has(String(service).trim().toLowerCase())
      ),
      freeStreaming: freeStreamingEnabled,
      subscriptionServices: selectedAfterToggle,
      freeStreamingServices: freeStreamingEnabled
        ? selectedFreeAfterToggle
        : [],
    }
    setAvailabilityState(next)
  })
})

swipeSubscriptionChildren.forEach(input => {
  input.addEventListener('change', () => {
    const selected = swipeSubscriptionChildren
      .filter(child => child.checked)
      .map(child => child.value)
    const personalSet = new Set(
      getAvailableSubscriptionOptions().personalSources.map(service =>
        String(service).trim().toLowerCase()
      )
    )
    const paidSet = new Set(
      parsePaidServices().map(service => String(service).trim().toLowerCase())
    )

    const freeStreamingEnabled = Boolean(swipeAvailabilityFree?.checked)
    const selectedFreeServices = swipeFreeStreamingChildren
      .filter(child => child.checked)
      .map(child => child.value)

    const next = {
      anywhere: false,
      roomPersonalMedia: selected.some(service =>
        personalSet.has(String(service).trim().toLowerCase())
      ),
      paidSubscriptions: selected.some(service =>
        paidSet.has(String(service).trim().toLowerCase())
      ),
      freeStreaming: freeStreamingEnabled,
      subscriptionServices: selected,
      freeStreamingServices: freeStreamingEnabled ? selectedFreeServices : [],
    }
    setAvailabilityState(next)
  })
})

swipeFreeStreamingChildren.forEach(input => {
  input.addEventListener('change', () => {
    const selectedSubscriptions = swipeSubscriptionChildren
      .filter(child => child.checked)
      .map(child => child.value)
    const selectedFreeServices = swipeFreeStreamingChildren
      .filter(child => child.checked)
      .map(child => child.value)
    const personalSet = new Set(
      getAvailableSubscriptionOptions().personalSources.map(service =>
        String(service).trim().toLowerCase()
      )
    )
    const paidSet = new Set(
      parsePaidServices().map(service => String(service).trim().toLowerCase())
    )
    const freeStreamingEnabled = Boolean(swipeAvailabilityFree?.checked)

    const next = {
      anywhere: false,
      roomPersonalMedia: selectedSubscriptions.some(service =>
        personalSet.has(String(service).trim().toLowerCase())
      ),
      paidSubscriptions: selectedSubscriptions.some(service =>
        paidSet.has(String(service).trim().toLowerCase())
      ),
      freeStreaming: freeStreamingEnabled,
      subscriptionServices: selectedSubscriptions,
      freeStreamingServices: freeStreamingEnabled ? selectedFreeServices : [],
    }
    setAvailabilityState(next)
  })
})

// Fallback delegated handler for all swipe-filter dropdown controls.
// This keeps button labels/default-state selections synchronized in wizard mode
// even if an individual control-specific listener misses an edge case.
document
  .getElementById('swipe-filter-modal')
  ?.addEventListener('change', () => {
    if (!window.filterState) return

    window.filterState.genres = Array.from(
      document.querySelectorAll(
        '#swipe-genre-list input[type="checkbox"]:checked'
      )
    )
      .map(cb => Number.parseInt(cb.value, 10))
      .filter(Number.isFinite)
    updateSwipeGenreButton(window.filterState.genres)

    window.filterState.languages = Array.from(
      document.querySelectorAll(
        '#swipe-language-list input[type="checkbox"]:checked'
      )
    ).map(cb => cb.value)
    updateSwipeLanguageButton(window.filterState.languages)

    window.filterState.countries = Array.from(
      document.querySelectorAll(
        '#swipe-country-list input[type="checkbox"]:checked'
      )
    ).map(cb => cb.value)
    updateSwipeCountryButton(window.filterState.countries)

    window.filterState.contentRatings = Array.from(
      document.querySelectorAll(
        '#swipe-rating-list input[type="checkbox"]:checked'
      )
    ).map(cb => cb.value)
    updateSwipeContentRatingButton(window.filterState.contentRatings)

    const selectedSort = document.querySelector(
      'input[name="swipe-sort"]:checked'
    )
    if (selectedSort) {
      const dirBtn = document.getElementById('swipe-sort-direction-btn')
      const direction = dirBtn?.dataset.direction || 'desc'
      const baseSort = String(selectedSort.value || 'popularity.desc').replace(
        /\.(asc|desc)$/,
        ''
      )
      window.filterState.sortBy = `${baseSort}.${direction}`
      updateSwipeSortButton(window.filterState.sortBy)
    }
  })

// Fallback delegated handler for availability updates.
// This keeps the dropdown label/state in sync even if individual checkbox
// listeners miss an edge-case interaction path.
document
  .getElementById('swipe-availability-list')
  ?.addEventListener('change', event => {
    const target = event.target
    if (!(target instanceof HTMLInputElement) || target.type !== 'checkbox') {
      return
    }

    const selectedSubscriptions = swipeSubscriptionChildren
      .filter(child => child.checked)
      .map(child => child.value)
    const selectedFreeServices = swipeFreeStreamingChildren
      .filter(child => child.checked)
      .map(child => child.value)
    const personalSet = new Set(
      getAvailableSubscriptionOptions().personalSources.map(service =>
        String(service).trim().toLowerCase()
      )
    )
    const paidSet = new Set(
      parsePaidServices().map(service => String(service).trim().toLowerCase())
    )

    if (swipeAvailabilityAnywhere?.checked) {
      setAvailabilityState(getDefaultAvailabilityState())
      return
    }

    const freeStreamingEnabled = Boolean(swipeAvailabilityFree?.checked)
    setAvailabilityState({
      anywhere: false,
      roomPersonalMedia: selectedSubscriptions.some(service =>
        personalSet.has(String(service).trim().toLowerCase())
      ),
      paidSubscriptions: selectedSubscriptions.some(service =>
        paidSet.has(String(service).trim().toLowerCase())
      ),
      freeStreaming: freeStreamingEnabled,
      subscriptionServices: selectedSubscriptions,
      freeStreamingServices: freeStreamingEnabled ? selectedFreeServices : [],
    })
  })

// Apply button
swipeFilterApply?.addEventListener('click', e => {
  e.preventDefault()
  const normalizedForSave = normalizeAvailabilityState(
    window.filterState?.availability
  )
  setAvailabilityState(normalizedForSave)

  if (swipeFilterMode === 'defaults') {
    const normalized = normalizeFilterStateForDefaults(window.filterState)
    if (normalized) {
      const snapshot = JSON.stringify(normalized)
      localStorage.setItem(SWIPE_DEFAULTS_STORAGE_KEY, snapshot)
      refreshDefaultsSummary()
      if (swipeFilterModal?.classList.contains('inline-defaults-mode')) {
        document.dispatchEvent(
          new CustomEvent('comparr:wizard-defaults-saved', {
            detail: { snapshot },
          })
        )
      } else {
        setSettingsStatus('Default swipe filters saved.')
        pulseSettingsStatus('success')
        clearSettingsStatusAfterDelay(3000)
      }
    }
    closeSwipeFilterModal()
    return
  }

  window.__resetMovies = true
  if (typeof triggerNewBatch === 'function') triggerNewBatch()
  closeSwipeFilterModal()
  updateSwipeFilterButtonState()
})

// Reset button
swipeFilterReset?.addEventListener('click', () => {
  const currentYear = new Date().getFullYear()

  // Reset filterState
  if (window.filterState) {
    window.filterState.yearRange = { min: 1895, max: currentYear }
    window.filterState.genres = []
    window.filterState.contentRatings = []
    window.filterState.availability = getDefaultAvailabilityState()
    window.filterState.showPlexOnly = false
    window.filterState.languages = swipeFilterMode === 'defaults' ? [] : ['en']
    window.filterState.countries = []
    window.filterState.imdbRating = 0
    window.filterState.tmdbRating = 0
    window.filterState.runtimeRange = { min: 0, max: 300 }
    window.filterState.voteCount = 0
    window.filterState.sortBy = 'popularity.desc'
  }

  // Reset UI
  document
    .querySelectorAll(
      '#swipe-genre-list input[type="checkbox"], #swipe-country-list input[type="checkbox"], #swipe-rating-list input[type="checkbox"]'
    )
    .forEach(cb => {
      cb.checked = false
    })
  document
    .querySelectorAll('#swipe-language-list input[type="checkbox"]')
    .forEach(cb => {
      cb.checked = swipeFilterMode === 'defaults' ? false : cb.value === 'en'
    })
  document
    .querySelectorAll('#swipe-filter-modal input[type="radio"]')
    .forEach(radio => {
      radio.checked = radio.value === 'popularity.desc'
    })

  const yearMin = document.getElementById('swipe-year-min')
  const yearMax = document.getElementById('swipe-year-max')
  const runtimeMin = document.getElementById('swipe-runtime-min')
  const runtimeMax = document.getElementById('swipe-runtime-max')
  const sortDirBtn = document.getElementById('swipe-sort-direction-btn')

  if (yearMin) yearMin.value = ''
  if (yearMax) yearMax.value = ''
  if (runtimeMin) runtimeMin.value = ''
  if (runtimeMax) runtimeMax.value = ''
  if (swipeImdbRating) swipeImdbRating.value = 0
  if (swipeImdbValue) swipeImdbValue.textContent = '0.0'
  if (swipeTmdbRating) swipeTmdbRating.value = 0
  if (swipeTmdbValue) swipeTmdbValue.textContent = '0.0'
  if (swipeVoteCount) swipeVoteCount.value = 0
  if (swipeVoteValue) swipeVoteValue.textContent = '0'
  setAvailabilityState(getDefaultAvailabilityState())

  if (sortDirBtn) {
    sortDirBtn.dataset.direction = 'desc'
    sortDirBtn.textContent = '↓'
  }

  // Reset dropdown button texts
  updateSwipeGenreButton([])
  updateSwipeLanguageButton(swipeFilterMode === 'defaults' ? [] : ['en'])
  updateSwipeCountryButton([])
  updateSwipeContentRatingButton([])
  updateSwipeSortButton('popularity.desc')

  if (swipeFilterMode === 'live') {
    // Sync with old Filters tab
    const oldResetBtn = document.getElementById('reset-filters')
    if (oldResetBtn) oldResetBtn.click()

    updateSwipeFilterButtonState()
  } else {
    localStorage.removeItem(SWIPE_DEFAULTS_STORAGE_KEY)
    refreshDefaultsSummary()
  }
})

// Initialize swipe filter dropdowns
setupSwipeFilterDropdowns()
refreshDefaultsSummary()

// Update filter button state on page load
setTimeout(updateSwipeFilterButtonState, 100)

// ===== MATCH POPUP FUNCTIONS =====
function showMatchPopup(matchData) {
  const popup = document.getElementById('match-popup')
  const overlay = document.getElementById('match-popup-overlay')
  const usersSpan = document.getElementById('match-popup-users')
  const movieSpan = document.getElementById('match-popup-movie')

  if (!popup || !overlay) {
    console.error('Match popup elements not found in DOM')
    return
  }

  // Format the users list
  const currentUser = sessionStorage.getItem('userName')
  const users = matchData.users || []
  const displayUsers = currentUser
    ? users.filter(user => user !== currentUser)
    : users
  const userList = displayUsers.length > 0 ? displayUsers : users

  let usersText = ''
  if (userList.length === 1) {
    usersText = userList[0]
  } else if (userList.length === 2) {
    usersText = `${userList[0]} and ${userList[1]}`
  } else if (userList.length > 2) {
    usersText = `${userList.slice(0, -1).join(', ')}, and ${
      userList[userList.length - 1]
    }`
  }

  // Update popup content
  usersSpan.textContent = usersText
  movieSpan.textContent = matchData.movie?.title || 'this movie'

  // Show popup with animation
  overlay.classList.add('active')
  setTimeout(() => {
    popup.classList.add('active')
  }, 10)
}

function hideMatchPopup() {
  const popup = document.getElementById('match-popup')
  const overlay = document.getElementById('match-popup-overlay')

  if (!popup || !overlay) return

  popup.classList.remove('active')
  setTimeout(() => {
    overlay.classList.remove('active')
  }, 300)
}

// Match popup button handlers
document.addEventListener('DOMContentLoaded', () => {
  const viewMatchesBtn = document.getElementById('match-view-btn')
  const keepSwipingBtn = document.getElementById('match-keep-swiping-btn')
  const overlay = document.getElementById('match-popup-overlay')

  if (viewMatchesBtn) {
    viewMatchesBtn.addEventListener('click', () => {
      hideMatchPopup()
      // Switch to matches tab
      const matchesTab = document.querySelector('[data-tab="tab-matches"]')
      if (matchesTab) {
        matchesTab.click()
      }
    })
  }

  if (keepSwipingBtn) {
    keepSwipingBtn.addEventListener('click', () => {
      hideMatchPopup()
    })
  }

  if (overlay) {
    overlay.addEventListener('click', () => {
      hideMatchPopup()
    })
  }
})

/* boot */
main().catch(err => console.error('❌Uncaught error in main():', err))
