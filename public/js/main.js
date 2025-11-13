// /public/js/main.js
// deno-lint-ignore-file

import { ComparrAPI } from './ComparrAPI.js'
import CardView from './CardView.js?v=3';
import { MatchesView } from './MatchesView.js'

// Global API reference so functions outside main() can access it
let api;

// ===== ADD THESE HELPER FUNCTIONS HERE =====

// --- Normalize any legacy poster paths to our canonical local proxy
function normalizePoster(u) {
  if (!u) return '';
  // Strip known local prefixes so we can inspect the core path
  let core = u;
  if (core.startsWith('/tmdb-poster/')) core = core.slice('/tmdb-poster'.length);
  if (core.startsWith('/poster/'))      core = core.slice('/poster'.length);

  // Detect raw Plex thumb IDs like "/74101/thumb/1760426051" and avoid proxying them as TMDb posters
  if (/^\/\d+\/thumb\/\d+/.test(core)) return '';
  
  if (u.startsWith('/cached-poster/') || u.startsWith('/tmdb-poster/')) return u;   // already good
  if (u.startsWith('/poster/')) return '/tmdb-poster/' + u.slice('/poster/'.length); // legacy -> canonical
  if (u.startsWith('http://') || u.startsWith('https://')) return u;                // full CDN URL
  return '/tmdb-poster' + (u.startsWith('/') ? u : '/' + u);                        // raw TMDB path
}

// Helper function to get genre names from IDs
function getGenreNames(genreIds) {
  const genreMap = {
    28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy',
    80: 'Crime', 99: 'Documentary', 18: 'Drama', 10751: 'Family',
    14: 'Fantasy', 36: 'History', 27: 'Horror', 10402: 'Music',
    9648: 'Mystery', 10749: 'Romance', 878: 'Sci-Fi', 10770: 'TV Movie',
    53: 'Thriller', 10752: 'War', 37: 'Western'
  };
  return (genreIds || []).map(id => genreMap[id]).filter(Boolean);
}

// Helper function to format runtime
function formatRuntime(minutes) {
  if (!minutes) return null;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours > 0) {
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
  return `${mins}m`;
}
// ===== END OF HELPER FUNCTIONS =====

// ===== DROPDOWN BUTTON TEXT UPDATE FUNCTIONS =====
// Helper function to get display names for various filter types
const filterDisplayNames = {
  // Genres
  28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy',
  80: 'Crime', 99: 'Documentary', 18: 'Drama', 10751: 'Family',
  14: 'Fantasy', 36: 'History', 27: 'Horror', 10402: 'Music',
  9648: 'Mystery', 10749: 'Romance', 878: 'Science Fiction', 10770: 'TV Movie',
  53: 'Thriller', 10752: 'War', 37: 'Western',
  
  // Languages
  'en': 'English', 'es': 'Spanish', 'fr': 'French', 'de': 'German',
  'it': 'Italian', 'pt': 'Portuguese', 'ja': 'Japanese', 'ko': 'Korean',
  'zh': 'Chinese', 'hi': 'Hindi', 'ar': 'Arabic', 'ru': 'Russian',
  'nl': 'Dutch', 'sv': 'Swedish', 'no': 'Norwegian',
  
  // Countries
  'US': 'United States', 'GB': 'United Kingdom', 'CA': 'Canada',
  'AU': 'Australia', 'FR': 'France', 'DE': 'Germany', 'ES': 'Spain',
  'IT': 'Italy', 'JP': 'Japan', 'KR': 'South Korea', 'CN': 'China',
  'IN': 'India', 'BR': 'Brazil', 'MX': 'Mexico', 'NL': 'Netherlands',
  'SE': 'Sweden', 'NO': 'Norway', 'DK': 'Denmark'
};

const DEFAULT_YEAR_MIN = 2000;
const DEFAULT_VOTE_COUNT = 250;
const DEFAULT_LANGUAGES = ['en'];

// Update dropdown button text based on selected items
function updateDropdownButtonText(buttonId, selectedItems, placeholderText, mapFunction = null) {
  const button = document.getElementById(buttonId);
  if (!button) return;
  
  const arrow = '<span class="dropdown-arrow">&#9660;</span>';
  
  if (!selectedItems || selectedItems.length === 0) {
    button.innerHTML = `${placeholderText} ${arrow}`;
    return;
  }
  
  // Map items to display names if provided
  const displayItems = mapFunction ? selectedItems.map(mapFunction) : selectedItems;
  
  if (displayItems.length === 1) {
    button.innerHTML = `${displayItems[0]} ${arrow}`;
  } else if (displayItems.length === 2) {
    button.innerHTML = `${displayItems[0]}, ${displayItems[1]} ${arrow}`;
  } else {
    button.innerHTML = `${displayItems.length} selected ${arrow}`;
  }
}

// Update genre dropdown button
function updateGenreButton(selectedGenres) {
  updateDropdownButtonText(
    'genre-dropdown-toggle',
    selectedGenres,
    'Select Genres',
    (genreId) => filterDisplayNames[genreId] || 'Unknown'
  );
}

// Update language dropdown button
function updateLanguageButton(selectedLanguages) {
  updateDropdownButtonText(
    'language-dropdown-toggle',
    selectedLanguages,
    'Select Languages',
    (langCode) => filterDisplayNames[langCode] || langCode.toUpperCase()
  );
}

// Update country dropdown button
function updateCountryButton(selectedCountries) {
  updateDropdownButtonText(
    'country-dropdown-toggle',
    selectedCountries,
    'Select Countries',
    (countryCode) => filterDisplayNames[countryCode] || countryCode
  );
}

// Watch filter modal button updates
function updateWatchGenreButton(selectedGenres) {
  updateDropdownButtonText(
    'watch-genre-toggle',
    selectedGenres,
    'Select Genres',
    (genreId) => filterDisplayNames[genreId] || 'Unknown'
  );
}

function updateWatchLanguageButton(selectedLanguages) {
  updateDropdownButtonText(
    'watch-language-toggle',
    selectedLanguages,
    'Select Languages',
    (langCode) => filterDisplayNames[langCode] || langCode.toUpperCase()
  );
}

function updateWatchCountryButton(selectedCountries) {
  updateDropdownButtonText(
    'watch-country-toggle',
    selectedCountries,
    'Select Countries',
    (countryCode) => filterDisplayNames[countryCode] || countryCode
  );
}

// Update content rating dropdown button
function updateContentRatingButton(selectedRatings) {
  updateDropdownButtonText(
    'rating-dropdown-toggle',
    selectedRatings,
    'Select Ratings',
    (rating) => rating
  );
}

// Watch filter modal content rating button update
function updateWatchContentRatingButton(selectedRatings) {
  updateDropdownButtonText(
    'watch-rating-toggle',
    selectedRatings,
    'Select Ratings',
    (rating) => rating
  );
}
// ===== END DROPDOWN BUTTON TEXT UPDATE FUNCTIONS =====

/* --------------------- tabs --------------------- */
function initTabs() {
  const tabbar = document.querySelector('.tabbar')
  if (!tabbar) return

  const buttons = tabbar.querySelectorAll('[data-tab]')
  const panels  = document.querySelectorAll('.tab-panel')
  const dropdown = document.querySelector('.dropdown')
  const dropdownToggle = document.querySelector('.dropdown-toggle')
  const dropdownItems = document.querySelectorAll('.dropdown-item')

  // PREVENT DUPLICATE EVENT LISTENERS
  if (dropdownToggle && dropdownToggle.dataset.initialized) {
    return // Already initialized, don't add duplicate listeners
  }

  const activate = id => {
    buttons.forEach(b => b.classList.toggle('is-active', b.dataset.tab === id))
    dropdownItems.forEach(item => item.classList.toggle('active', item.dataset.tab === id))
    panels.forEach(p => { p.hidden = (p.id !== id) })
  
    // Update dropdown toggle text if a dropdown item is active
    const activeDropdownItem = Array.from(dropdownItems).find(item => item.dataset.tab === id)
    if (activeDropdownItem) {
      dropdownToggle.innerHTML = `<i class="fas fa-star"></i> ${activeDropdownItem.textContent}`
      dropdownToggle.classList.add('is-active')
    } else {
      dropdownToggle.innerHTML = '<i class="fas fa-star"></i> Ratings'
      dropdownToggle.classList.remove('is-active')
    }
  }

  // Handle dropdown toggle
  dropdownToggle?.addEventListener('click', (e) => {
    e.stopPropagation()
    dropdown.classList.toggle('show')
  })

  // Close dropdown when clicking outside
  document.addEventListener('click', () => {
    dropdown.classList.remove('show')
  })

  // tab switching
  buttons.forEach(btn => btn.addEventListener('click', () => {
    const tabId = btn.dataset.tab;
    activate(tabId);
    
    // Handle Watch list auto-refresh
    if (tabId === 'tab-likes') {
      startWatchListAutoRefresh();
      setTimeout(refreshWatchListStatus, 500);
      // Reset expand/collapse button state
      if (typeof resetExpandCollapseButton === 'function') {
        resetExpandCollapseButton();
      }
    } else {
      stopWatchListAutoRefresh();
    }
  }))
  
  dropdownItems.forEach(item => {
    item.addEventListener('click', () => {
      const tabId = item.dataset.tab;
      activate(tabId);
      dropdown.classList.remove('show');
      
      // Handle Watch list auto-refresh
      if (tabId === 'tab-likes') {
        startWatchListAutoRefresh();
        setTimeout(refreshWatchListStatus, 500);
        // Reset expand/collapse button state
        if (typeof resetExpandCollapseButton === 'function') {
          resetExpandCollapseButton();
        }
      } else {
        stopWatchListAutoRefresh();
      }
    })
  })
  // Mark as initialized
  if (dropdownToggle) {
    dropdownToggle.dataset.initialized = 'true'
  }

  // Activate first tab by default
  if (buttons[0]) activate(buttons[0].dataset.tab)
  
  // Handle refresh button click
  const refreshBtn = document.getElementById('refresh-watch-btn');
  if (refreshBtn && !refreshBtn.dataset.initialized) {
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.disabled = true;
      const icon = refreshBtn.querySelector('i');
      icon.classList.add('fa-spin');
      
      await refreshWatchListStatus();
      
      icon.classList.remove('fa-spin');
      refreshBtn.disabled = false;
    });
    
    refreshBtn.dataset.initialized = 'true';
  }
} 

function sortWatchList(sortBy) {
  console.log('🔧 sortWatchList called with:', sortBy);
  
  const likesList = document.querySelector('.likes-list');
  if (!likesList) {
    console.warn('⚠️ .likes-list not found!');
    return;
  }
  
  const cards = Array.from(likesList.querySelectorAll('.watch-card'));
  console.log('🔍 Found cards:', cards.length);
  
  // Store original order for date sorting
  if (!likesList.dataset.originalOrder) {
    likesList.dataset.originalOrder = cards.map(c => c.dataset.guid).join(',');
  }
  
  // Parse sortBy into field and direction
  let sortField, sortDirection;
  if (sortBy.includes('-')) {
    // New format: "field-direction"
    const parts = sortBy.split('-');
    sortField = parts[0];
    sortDirection = parts[1];
  } else {
    // Old format: keep for backwards compatibility
    sortField = sortBy;
    sortDirection = 'desc';
  }
  
  cards.sort((a, b) => {
    const titleA = a.querySelector('.watch-card-title-compact').textContent.trim();
    const titleB = b.querySelector('.watch-card-title-compact').textContent.trim();
    
    const yearA = parseInt(a.querySelector('.watch-card-year').textContent.match(/\d+/)?.[0] || 0);
    const yearB = parseInt(b.querySelector('.watch-card-year').textContent.match(/\d+/)?.[0] || 0);
    
    // Extract all three ratings
    const getRatings = (card) => {
      const ratingEl = card.querySelector('.watch-card-ratings');
      if (!ratingEl) return { imdb: 0, rt: 0, tmdb: 0 };
      
      const innerHTML = ratingEl.innerHTML;
      
      // Extract IMDb rating: <img src="..." alt="IMDb"> 7.5
      const imdbMatch = innerHTML.match(/imdb\.svg[^>]*>\s*([\d.]+)/i);
      const imdb = imdbMatch ? parseFloat(imdbMatch[1]) : 0;
      
      // Extract RT rating: <img src="..." alt="RT"> 85%
      const rtMatch = innerHTML.match(/rottentomatoes\.svg[^>]*>\s*([\d.]+)%/i);
      const rt = rtMatch ? parseFloat(rtMatch[1]) : 0;
      
      // Extract TMDb rating: <img src="..." alt="TMDb"> 7.5
      const tmdbMatch = innerHTML.match(/tmdb\.svg[^>]*>\s*([\d.]+)/i);
      const tmdb = tmdbMatch ? parseFloat(tmdbMatch[1]) : 0;
      
      return { imdb, rt, tmdb };
    };
    
    const ratingsA = getRatings(a);
    const ratingsB = getRatings(b);
    
    // Get popularity and vote count from data attributes
    const popularityA = parseFloat(a.dataset.popularity || 0);
    const popularityB = parseFloat(b.dataset.popularity || 0);
    const votesA = parseInt(a.dataset.voteCount || 0);
    const votesB = parseInt(b.dataset.voteCount || 0);
    
    let result = 0;
    
    // Determine sort based on field
    switch(sortField) {
      case 'title':
        result = titleA.localeCompare(titleB);
        break;
      case 'year':
      case 'release_date':
        result = yearA - yearB;
        break;
      case 'imdb':
        result = ratingsA.imdb - ratingsB.imdb;
        break;
      case 'rt':
        result = ratingsA.rt - ratingsB.rt;
        break;
      case 'tmdb':
        result = ratingsA.tmdb - ratingsB.tmdb;
        break;
      case 'popularity':
        result = popularityA - popularityB;
        break;
      case 'vote_count':
        result = votesA - votesB;
        break;
      case 'date':
        // Use original insertion order
        const originalOrder = likesList.dataset.originalOrder.split(',');
        const indexA = originalOrder.indexOf(a.dataset.guid);
        const indexB = originalOrder.indexOf(b.dataset.guid);
        result = indexA - indexB;
        break;
      default:
        result = 0;
    }
    
    // Apply direction (asc = normal, desc = reverse)
    return sortDirection === 'asc' ? result : -result;
  });
  
  // CRITICAL FIX: Remove all cards first, then re-add in sorted order
  cards.forEach(card => card.remove());
  cards.forEach(card => likesList.appendChild(card));
  
  console.log('✅ Sort complete!');
}

// Make it globally available
window.sortWatchList = sortWatchList;

/* ------------- login (prevents page nav) -------- */
async function login(api) {
  const loginSection = document.querySelector('.login-section')
  const passwordForm = document.querySelector('.js-password-form')
  const loginForm = document.querySelector('.js-login-form')
  const generateBtn = document.querySelector('.js-generate-room-code')
  const roomCodeLine = document.querySelector('.js-room-code-line')

  let verifiedPassword = null

  // Handle password verification first
  await new Promise(resolve => {
    const handlePasswordSubmit = async e => {
      e.preventDefault()
      const fd = new FormData(passwordForm)
      const accessPassword = fd.get('accessPassword')
      if (!accessPassword) return

      // Store password and show login form
      verifiedPassword = accessPassword
      passwordForm.style.display = 'none'
      loginForm.style.display = 'block'
      
      // Scroll to top of page
      window.scrollTo({ top: 0, behavior: 'smooth' })
      
      // restore cached values
      const savedUser = localStorage.getItem('user')
      const savedCode = localStorage.getItem('roomCode')
      if (savedUser) loginForm.elements.name.value = savedUser
      if (savedCode) loginForm.elements.roomCode.value = savedCode

      resolve()
    }
    passwordForm.addEventListener('submit', handlePasswordSubmit)
  })

  // Generate code
  generateBtn?.addEventListener('click', () => {
    const map = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789'
    const code = Array.from({ length: 4 }, () => map[Math.floor(Math.random() * map.length)]).join('')
    loginForm.elements.roomCode.value = code
  })

  return new Promise(resolve => {
    const handleSubmit = async e => {
      e.preventDefault()

      const fd = new FormData(loginForm)
      const name = fd.get('name')
      const code = fd.get('roomCode')
      if (!name || !code) return

      try {
        const data = await api.login(name, code, verifiedPassword)
        loginForm.removeEventListener('submit', handleSubmit)

        // hide login
        await loginSection.animate({ opacity: ['1','0'] }, { duration: 250, easing: 'ease-in-out', fill: 'both' }).finished
        loginSection.hidden = true

        // remember
        localStorage.setItem('user', name)
        localStorage.setItem('roomCode', code)

        roomCodeLine.dataset.roomCode = code
        document.body.scrollIntoView()

        // reveal app sections
        await Promise.all(
          [...document.querySelectorAll('.rate-section, .matches-section, #tab-likes, #tab-dislikes')]
            .map(node => {
              node.hidden = false
              return node.animate({ opacity: ['0','1'] }, { duration: 250, easing: 'ease-in-out', fill: 'both' }).finished
            })
        )

        initTabs()
        resolve({ ...data, user: name, roomCode: code })
      } catch (err) {
        // Show password form again on login failure
        loginForm.style.display = 'none'
        passwordForm.style.display = 'block'
        passwordForm.elements.accessPassword.value = ''
        alert(err.message)
      }
    }

    loginForm.addEventListener('submit', handleSubmit)
  })
}

// Given server history, append rows to Watch/Pass tab UIs.
// Replace the appendRatedRow function in main.js with this updated version

async function appendRatedRow({ basePath, likesList, dislikesList, seenList }, movie, wantsToWatch) {
  if (!movie) return;
  
  if (wantsToWatch === true) {
    const cardId = `movie-${movie.guid.replace(/[^a-zA-Z0-9]/g, '-')}`;
    
    // Extract TMDb ID or IMDb ID from guid if available
    let movieId = null;
    let tmdbId = null; // Separate variable for numeric TMDb ID
    
    if (movie.guid?.startsWith('tmdb://')) {
      movieId = movie.guid.replace('tmdb://', '');
      tmdbId = movieId; // TMDb ID is the same as movieId for tmdb:// guids
    } else if (movie.guid?.includes('themoviedb://')) {
      const match = movie.guid.match(/themoviedb:\/\/(\d+)/);
      if (match) {
        movieId = match[1];
        tmdbId = match[1];
      }
    } else if (movie.guid?.includes('imdb://')) {
      const match = movie.guid.match(/imdb:\/\/(tt\d+)/);
      if (match) movieId = match[1]; // This will be like "tt1234567"
    } else if (movie.imdbId) {
      movieId = movie.imdbId; // Use stored IMDb ID
    }
    
    // Also check for TMDb ID stored directly on the movie object (from enrichment)
    if (!tmdbId && (movie.tmdbId || movie.tmdb_id)) {
      tmdbId = String(movie.tmdbId || movie.tmdb_id);
    }
    
    // FALLBACK: Extract TMDb ID from streamingLink if available
    if (!tmdbId && movie.streamingLink) {
      const match = movie.streamingLink.match(/themoviedb\.org\/movie\/(\d+)/);
      if (match) {
        tmdbId = match[1];
        console.log(`  Extracted TMDb ID ${tmdbId} from streamingLink for ${movie.title}`);
      }
    }
    
    // Create card for Watch tab
    const card = document.createElement('div');
    card.className = 'watch-card';
    card.dataset.movieId = movieId;
    card.dataset.guid = movie.guid;

    const normalizedTmdbId = tmdbId ? String(tmdbId) : '';
    const normalizedTitleKey = `${(movie.title || '').trim().toLowerCase()}::${movie.year || ''}`;

    if (likesList) {
      const removedGuids = [];
      likesList.querySelectorAll('.watch-card').forEach(existing => {
        const existingTmdb = existing.dataset.tmdbId || '';
        const existingGuid = existing.dataset.guid || '';
        const existingTitleKey = existing.dataset.titleKey || '';

        if (
          (normalizedTmdbId && existingTmdb && existingTmdb === normalizedTmdbId) ||
          (movie.guid && existingGuid && existingGuid === movie.guid) ||
          (normalizedTitleKey && existingTitleKey && existingTitleKey === normalizedTitleKey)
        ) {
          removedGuids.push(existingGuid);
          existing.remove();
        }
      });

      if (removedGuids.length > 0 && likesList.dataset.originalOrder) {
        const order = likesList.dataset.originalOrder.split(',').filter(Boolean);
        likesList.dataset.originalOrder = order.filter(g => !removedGuids.includes(g)).join(',');
      }
    }

    // Extract numeric TMDb ID for API calls
    if (movie.guid?.startsWith('tmdb://')) {
      card.dataset.tmdbId = movie.guid.replace('tmdb://', '');
    } else if (movie.guid?.includes('themoviedb://')) {
      const match = movie.guid.match(/themoviedb:\/\/(\d+)/);
      if (match) card.dataset.tmdbId = match[1];
    } else if (movie.tmdbId || movie.tmdb_id) {
      // Use TMDb ID from enrichment if available
      card.dataset.tmdbId = String(movie.tmdbId || movie.tmdb_id);
    } else if (movie.streamingLink) {
      // FALLBACK: Extract from streaming link
      const match = movie.streamingLink.match(/themoviedb\.org\/movie\/(\d+)/);
      if (match) card.dataset.tmdbId = match[1];
    }
    
    // Store filterable data on the card
    card.dataset.genres = JSON.stringify(movie.genre_ids || []);
    card.dataset.languages = JSON.stringify(movie.original_language ? [movie.original_language] : []);
    card.dataset.countries = JSON.stringify(movie.production_countries?.map(c => c.iso_3166_1) || []);
    card.dataset.contentRating = movie.contentRating || '';
    card.dataset.runtime = movie.runtime || '';
    card.dataset.voteCount = movie.vote_count || 0;
    card.dataset.popularity = movie.popularity || 0;
    card.dataset.titleKey = normalizedTitleKey;

    if (normalizedTmdbId && !card.dataset.tmdbId) {
      card.dataset.tmdbId = normalizedTmdbId;
    }
    
    const streamingServices = getStreamingServices(movie);
    const allServices = [...(streamingServices.subscription || []), ...(streamingServices.free || [])];
    const isInPlex = allServices.some(s => s.name === window.PLEX_LIBRARY_NAME);
       
    // Check if request service is configured
    const requestServiceConfigured = await checkRequestServiceStatus();
    
    // Get the streaming link (TMDb watch page with JustWatch deep links)
    const streamingLink = movie.streamingLink || null;
    
    // DEBUG: Check if link exists
    console.log('🧩 DEBUG streamingLink:', streamingLink);
    console.log('🧩 DEBUG movie:', movie.title, movie.guid);
    
    // Helper to render service list items - NOW WITH CLICKABLE LINKS
    const renderServiceItems = (services) => {
      if (!services || services.length === 0) return '<div class="service-item">None available</div>';
      
      // If we have a streamingLink, wrap the entire list in a link container
      if (streamingLink) {
        return `
          <a href="${streamingLink}" target="_blank" rel="noopener noreferrer" class="service-link-wrapper">
            ${services.map(s => {
              const logoUrl = s.logo_path 
                ? (s.logo_path.startsWith('/assets/') 
                    ? `${basePath}${s.logo_path}` 
                    : `https://image.tmdb.org/t/p/original${s.logo_path}`)
                : null;
              
              return `<div class="service-item">
                ${logoUrl ? `<img src="${logoUrl}" alt="${s.name}" class="service-logo-small">` : ''}
                <span>${s.name}</span>
              </div>`;
            }).join('')}
            <div class="service-footer">
              <i class="fas fa-external-link-alt"></i> View on JustWatch
            </div>
          </a>
        `;
      }
      
      // Fallback if no link available
      return services.map(s => {
        const logoUrl = s.logo_path 
          ? (s.logo_path.startsWith('/assets/') 
              ? `${basePath}${s.logo_path}` 
              : `https://image.tmdb.org/t/p/original${s.logo_path}`)
          : null;
        
        return `<div class="service-item">
          ${logoUrl ? `<img src="${logoUrl}" alt="${s.name}" class="service-logo-small">` : ''}
          <span>${s.name}</span>
        </div>`;
      }).join('');
    };
    
    const hasSubscription = streamingServices.subscription && 
                           streamingServices.subscription.filter(s => s.name !== window.PLEX_LIBRARY_NAME).length > 0;
    const hasFree = streamingServices.free && streamingServices.free.length > 0;
    
    // DEBUG: Log button rendering conditions
    console.log('🧩 Button rendering debug for', movie.title);
    console.log('  isInPlex:', isInPlex);
    console.log('  movieId:', movieId);
    console.log('  requestServiceConfigured:', requestServiceConfigured);
    console.log('  Will show:', isInPlex ? 'AllVids badge' : (movieId && requestServiceConfigured) ? 'Add to Plex button' : 'Nothing');
    
    // Get metadata for badges - use the same field names as CardView
    const genres = movie.genres || [];  // Array of genre names like ["Comedy", "Horror"]
    const genreDisplay = genres.length > 0 ? genres.slice(0, 2).join(', ') : null;
    
    // DEBUG: Log all possible runtime fields
    console.log('🧩 Runtime debug for', movie.title);
    console.log('  movie.runtime:', movie.runtime);
    console.log('  movie.tmdbRuntime:', movie.tmdbRuntime);
    console.log('  movie.runtimeMinutes:', movie.runtimeMinutes);
    console.log('  movie.duration:', movie.duration);
    
    // Try multiple runtime fields like CardView does
    const runtimeMin = (() => {
      const minuteCandidates = [
        Number(movie.runtime),
        Number(movie.tmdbRuntime),
        Number(movie.runtimeMinutes)
      ].filter(v => Number.isFinite(v) && v > 0);
      if (minuteCandidates.length && minuteCandidates[0] < 1000) return Math.round(minuteCandidates[0]);
      if (Number.isFinite(movie.duration) && movie.duration > 0) return Math.round(movie.duration / 60000);
      return null;
    })();
    const runtimeDisplay = runtimeMin ? formatRuntime(runtimeMin) : null;
    
    console.log('  🧠 runtimeMin calculated:', runtimeMin);
    console.log('  🧠 runtimeDisplay:', runtimeDisplay);
    
    const contentRating = movie.contentRating;
    
    // Build the metadata badges section - only show if data exists
    const metadataBadges = [];
    
    if (contentRating) {
      metadataBadges.push(`<span class="metadata-badge badge-rating">
        <i class="fas fa-tag"></i> ${contentRating}
      </span>`);
    }
    
    if (genreDisplay) {
      metadataBadges.push(`<span class="metadata-badge badge-genre">
        <i class="fas fa-film"></i> ${genreDisplay}
      </span>`);
    }
    
    if (runtimeDisplay) {
      metadataBadges.push(`<span class="metadata-badge badge-runtime">
        <i class="fas fa-clock"></i> ${runtimeDisplay}
      </span>`);
    }
    
    const metadataBadgesHTML = metadataBadges.length > 0 
      ? `<div class="watch-card-metadata">${metadataBadges.join('')}</div>`
      : '';

    card.innerHTML = `
      <!-- Collapsed header (always visible) -->
      <div class="watch-card-collapsed" onclick="this.closest('.watch-card').classList.toggle('expanded')">
        <div class="watch-card-header-compact">
          <div class="watch-card-title-compact">
            ${movie.title} <span class="watch-card-year">(${movie.year || 'N/A'})</span>
          </div>
          <div class="expand-icon"><i class="fas fa-chevron-down"></i></div>
        </div>
      </div>
         
      <!-- Expandable details (hidden by default) -->
      <div class="watch-card-details">
        <div class="watch-card-poster">
          <img src="${(() => { const p = normalizePoster(movie.art || movie.thumb || ''); return p.startsWith('http') ? p : (basePath + p); })()}" alt="${movie.title}">
        </div>
        <div class="watch-card-content">
          ${movie.summary ? `<p class="watch-card-summary">${movie.summary}</p>` : ''}
          ${metadataBadgesHTML}
          ${movie.rating ? `<div class="watch-card-ratings">${movie.rating}</div>` : ''}
    
        <div class="watch-card-actions">
          <div class="service-dropdown">
            <button class="service-dropdown-btn ${!hasSubscription ? 'disabled' : ''}" type="button" ${!hasSubscription ? 'disabled' : ''}>
              SUBSCRIPTION
            </button>
            ${hasSubscription ? `
              <div class="service-dropdown-menu">
                ${renderServiceItems(streamingServices.subscription.filter(s => s.name !== window.PLEX_LIBRARY_NAME))}
              </div>
            ` : ''}
          </div>
          
          <div class="service-dropdown">
            <button class="service-dropdown-btn ${!hasFree ? 'disabled' : ''}" type="button" ${!hasFree ? 'disabled' : ''}>
              FREE
            </button>
            ${hasFree ? `
              <div class="service-dropdown-menu">
                ${renderServiceItems(streamingServices.free)}
              </div>
            ` : ''}
          </div>
          
          ${isInPlex ? `
            <div class="plex-status">
              <i class="fas fa-check-circle"></i> ${window.PLEX_LIBRARY_NAME}
            </div>
          ` : tmdbId && requestServiceConfigured ? `
            <button class="add-to-plex-btn" data-movie-id="${movieId}">
              <i class="fas fa-plus"></i> ADD TO PLEX
            </button>
          ` : ``}
        </div>
        
        <!-- Move to other lists buttons -->
        <div class="list-actions">
          <button class="list-action-btn move-to-seen" data-guid="${movie.guid}" title="Mark as Seen">
            <i class="fas fa-eye"></i>
          </button>
          <button class="list-action-btn move-to-pass" data-guid="${movie.guid}" title="Move to Pass">
            <i class="fas fa-thumbs-down"></i>
          </button>
          <button class="list-action-btn refresh-movie-btn" data-movie-id="${tmdbId || movieId || ''}" title="Refresh ratings and status">
            <i class="fas fa-sync-alt"></i>
          </button>
        </div>
      </div>
    </div>
  `;
    
    likesList?.appendChild(card);

    if (likesList) {
      const currentOrder = likesList.dataset.originalOrder
        ? likesList.dataset.originalOrder.split(',').filter(Boolean)
        : [];
      const filteredOrder = currentOrder.filter(g => g !== movie.guid);
      filteredOrder.push(movie.guid);
      likesList.dataset.originalOrder = filteredOrder.join(',');
    }
    
    // Add dropdown toggle handlers (only for enabled buttons)
    const dropdownBtns = card.querySelectorAll('.service-dropdown-btn:not(.disabled)');
    dropdownBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const dropdown = btn.nextElementSibling;
        if (!dropdown) return;
        
        const isOpen = dropdown.classList.contains('show');
        
        // Close all other dropdowns
        document.querySelectorAll('.service-dropdown-menu.show').forEach(menu => {
          if (menu !== dropdown) {
            menu.classList.remove('show');
            menu.previousElementSibling.classList.remove('open');
          }
        });
        
        // Toggle this dropdown
        dropdown.classList.toggle('show');
        btn.classList.toggle('open');
        
        // Stop propagation so outside click handler doesn't immediately close it
        e.stopPropagation();
      });
    });
    
    // CRITICAL FIX: Allow links inside dropdown to work
    const dropdowns = card.querySelectorAll('.service-dropdown-menu');
    dropdowns.forEach(dropdown => {
      dropdown.addEventListener('click', (e) => {
        // If clicking on a link, let it navigate naturally
        // Just stop propagation so outside click handler doesn't close dropdown
        if (!e.target.closest('a')) {
          e.stopPropagation();
        }
      });
    });
    
    // Close dropdowns when clicking outside
    const closeHandler = (e) => {
      if (!card.contains(e.target)) {
        card.querySelectorAll('.service-dropdown-menu.show').forEach(menu => {
          menu.classList.remove('show');
          menu.previousElementSibling.classList.remove('open');
        });
      }
    };
    document.addEventListener('click', closeHandler);
    
    // Add click handler for Add to Plex button
    if (!isInPlex && tmdbId && requestServiceConfigured) {
      const addBtn = card.querySelector('.add-to-plex-btn');
      addBtn?.addEventListener('click', () => handleMovieRequest(parseInt(tmdbId), movie.title, addBtn));
    }
    
    // Add click handler for Refresh button - always works now, uses guid fallback
    const refreshBtn = card.querySelector('.refresh-movie-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        const icon = refreshBtn.querySelector('i');
        
        // Show loading state
        refreshBtn.disabled = true;
        icon.classList.add('fa-spin');
        
        try {
          // Get identifier - prefer tmdbId from card, fallback to guid
          const guid = card.dataset.guid;
          const cardTmdbId = card.dataset.tmdbId;
          const idOrGuid = cardTmdbId || guid;
          
          if (!idOrGuid) {
            throw new Error('No ID available for refresh');
          }

          const response = await fetch(`/api/refresh-movie/${encodeURIComponent(idOrGuid)}`);
          let data = null;
          try { data = await response.json(); } catch {}
          if (!response.ok) {
            console.error('❌Refresh failed', {
              status: response.status,
              rid: data?.rid,
              stage: data?.stage,
              error: data?.error
            });
            const detail = data?.error ? `: ${data.error}` : '';
            throw new Error('Failed to refresh' + detail);
          } else {
            if (data?.rid) {
              console.debug('Refresh ok', { rid: data.rid });
            }
          }

          // If we didn't have a tmdbId before but got one from enrichment, update the card
          if (!cardTmdbId && data.tmdbId) {
            card.dataset.tmdbId = data.tmdbId;
            console.log('✅ Updated card with tmdbId:', data.tmdbId);
          }

          
          // Update the rating display - always update even if empty to show that refresh completed
          const ratingEl = card.querySelector('.watch-card-ratings');
          if (ratingEl) {
            // If we have ratings, update them. If not but rating exists in response, use it
            if (data.rating) {
              ratingEl.innerHTML = data.rating;
            } else if (data.rating_imdb || data.rating_rt || data.rating_tmdb) {
              // Build rating HTML from individual ratings if rating string not provided
              const basePath = document.body.dataset.basePath || '';
              const ratingParts = [];
              if (data.rating_imdb) ratingParts.push(`<img src="${basePath}/assets/logos/imdb.svg" alt="IMDb" class="rating-logo"> ${data.rating_imdb}`);
              if (data.rating_rt) ratingParts.push(`<img src="${basePath}/assets/logos/rottentomatoes.svg" alt="RT" class="rating-logo"> ${data.rating_rt}%`);
              if (data.rating_tmdb) ratingParts.push(`<img src="${basePath}/assets/logos/tmdb.svg" alt="TMDb" class="rating-logo"> ${data.rating_tmdb}`);
              ratingEl.innerHTML = ratingParts.length > 0 ? ratingParts.join(' <span class="rating-separator">&bull;</span> ') : '';
            }
          }
          
          // Update Plex status / Add to Plex button
          const actionsContainer = card.querySelector('.watch-card-actions');
          const existingBtn = actionsContainer.querySelector('.add-to-plex-btn');
          const existingStatus = actionsContainer.querySelector('.plex-status');
          
          if (data.inPlex) {
            // Replace button with Plex status badge
            if (existingBtn) {
              existingBtn.outerHTML = `
                <div class="plex-status">
                  <i class="fas fa-check-circle"></i> ${window.PLEX_LIBRARY_NAME}
                </div>
              `;
            }
          } else if (!existingBtn && !existingStatus && requestServiceConfigured) {
            // Add the button if it wasn't there before (use potentially updated tmdbId from card dataset)
            const refreshBtnElement = actionsContainer.querySelector('.refresh-movie-btn');
            if (refreshBtnElement) {
              const finalTmdbId = parseInt(card.dataset.tmdbId);
              if (finalTmdbId) {
                refreshBtnElement.insertAdjacentHTML('beforebegin', `
                  <button class="add-to-plex-btn" data-movie-id="${finalTmdbId}">
                    <i class="fas fa-plus"></i> ADD TO PLEX
                  </button>
                `);
                // Add handler to the new button
                const newAddBtn = actionsContainer.querySelector('.add-to-plex-btn');
                newAddBtn?.addEventListener('click', () => handleMovieRequest(finalTmdbId, movie.title, newAddBtn));
              }
            }
          }
          
          // Update streaming services (match Watch-card dropdowns)
          if (data.streamingServices) {
            const dropdowns = card.querySelectorAll('.service-dropdown');
            const subMenu = dropdowns[0]?.querySelector('.service-dropdown-menu');
            const freeMenu = dropdowns[1]?.querySelector('.service-dropdown-menu');

            // SUBSCRIPTION
            if (subMenu) {
              const services = (data.streamingServices.subscription || [])
                .filter(s => s.name !== window.PLEX_LIBRARY_NAME);
              subMenu.innerHTML = renderServiceItems(services, data.streamingLink);
            }

            // FREE
            if (freeMenu) {
              const services = data.streamingServices.free || [];
              freeMenu.innerHTML = renderServiceItems(services, data.streamingLink);
            }
          }

          
          // Show success feedback - just change icon
          icon.classList.remove('fa-sync-alt', 'fa-spin');
          icon.classList.add('fa-check');
          
          setTimeout(() => {
            icon.classList.remove('fa-check');
            icon.classList.add('fa-sync-alt');
            refreshBtn.disabled = false;
          }, 2000);
          
        } catch (err) {
          console.error('❌Failed to refresh movie:', err);
          try {
            const txt = await err?.response?.text?.();
            console.error('❌Server said:', txt);
          } catch {}

          
          // Show error feedback - just change icon
          icon.classList.remove('fa-spin', 'fa-sync-alt');
          icon.classList.add('fa-exclamation-triangle');
          
          setTimeout(() => {
            icon.classList.remove('fa-exclamation-triangle');
            icon.classList.add('fa-sync-alt');
            refreshBtn.disabled = false;
          }, 2000);
        }
      });
    }
    
    // Add event listeners for list action buttons
    const moveToSeenBtn = card.querySelector('.move-to-seen');
    const moveToPassBtn = card.querySelector('.move-to-pass');
    
    if (moveToSeenBtn) {
      console.log('🧠 Attaching Watch->Seen button handler for:', movie.title);
      moveToSeenBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const guid = moveToSeenBtn.dataset.guid;
        console.log('🧠 Watch->Seen button clicked! GUID:', guid);
        await moveMovieBetweenLists(guid, 'watch', 'seen');
      });
    } else {
      console.warn('⚠️ No move-to-seen button found for:', movie.title);
    }
    
    if (moveToPassBtn) {
      console.log('🧠 Attaching Watch->Pass button handler for:', movie.title);
      moveToPassBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const guid = moveToPassBtn.dataset.guid;
        console.log('🧠 Watch->Pass button clicked! GUID:', guid);
        await moveMovieBetweenLists(guid, 'watch', 'pass');
      });
    } else {
      console.warn('⚠️ No move-to-pass button found for:', movie.title);
    }
  } else if (wantsToWatch === false) {
    // Create card for Pass tab (same format as Watch tab but no streaming)
    const card = document.createElement('div');
    card.className = 'watch-card';
    card.dataset.guid = movie.guid;
    
    // Extract TMDb ID from various possible sources
    if (movie.guid && movie.guid.startsWith('tmdb://')) {
      card.dataset.tmdbId = movie.guid.replace('tmdb://', '');
    } else if (movie.guid && /\/(\d+)$/.test(movie.guid)) {
      const match = movie.guid.match(/\/(\d+)$/);
      if (match) card.dataset.tmdbId = match[1];
    } else if (movie.tmdbId || movie.tmdb_id) {
      card.dataset.tmdbId = String(movie.tmdbId || movie.tmdb_id);
    } else if (movie.guid && /movie\/(\d+)/.test(movie.guid)) {
      const match = movie.guid.match(/movie\/(\d+)/);
      if (match) card.dataset.tmdbId = match[1];
    }
    
    // Store filterable data on the card
    card.dataset.genres = JSON.stringify(movie.genre_ids || []);
    card.dataset.languages = JSON.stringify(movie.original_language ? [movie.original_language] : []);
    card.dataset.countries = JSON.stringify(movie.production_countries?.map(c => c.iso_3166_1) || []);
    card.dataset.contentRating = movie.contentRating || '';
    card.dataset.runtime = movie.runtime || '';
    card.dataset.voteCount = movie.vote_count || 0;
    card.dataset.popularity = movie.popularity || 0;
    
    card.innerHTML = `
      <!-- Collapsed header (always visible) -->
      <div class="watch-card-collapsed" onclick="this.closest('.watch-card').classList.toggle('expanded')">
        <div class="watch-card-header-compact">
          <div class="watch-card-title-compact">
            ${movie.title} <span class="watch-card-year">(${movie.year || 'N/A'})</span>
          </div>
          <div class="expand-icon"><i class="fas fa-chevron-down"></i></div>
        </div>
      </div>
      
      <!-- Expandable details (hidden by default) -->
      <div class="watch-card-details">
        <div class="watch-card-poster">
          <img src="${(() => { const p = normalizePoster(movie.art || movie.thumb || ''); return p.startsWith('http') ? p : (basePath + p); })()}" alt="${movie.title}">
        </div>
  
        <div class="watch-card-content">
          ${movie.summary ? `<p class="watch-card-summary">${movie.summary}</p>` : ''}
          ${movie.rating ? `<div class="watch-card-ratings">${movie.rating}</div>` : ''}
        
          <!-- Move to other lists buttons -->
          <div class="list-actions">
            <button class="list-action-btn move-to-watch" data-guid="${movie.guid}" title="Move to Watch">
              <i class="fas fa-thumbs-up"></i>
            </button>
            <button class="list-action-btn move-to-seen" data-guid="${movie.guid}" title="Mark as Seen">
              <i class="fas fa-eye"></i>
            </button>
          </div>
        </div>
      </div>
    `;
    
    // Add event listeners for pass list actions
    const moveToWatchBtn = card.querySelector('.move-to-watch');
    const moveToSeenBtn = card.querySelector('.move-to-seen');
    
    if (moveToWatchBtn) {
      console.log('🧠 Attaching Pass->Watch button handler for:', movie.title);
      moveToWatchBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const guid = moveToWatchBtn.dataset.guid;
        console.log('🧠 Pass->Watch button clicked! GUID:', guid);
        await moveMovieBetweenLists(guid, 'pass', 'watch');
      });
    } else {
      console.warn('⚠️ No move-to-watch button found for:', movie.title);
    }
    
    if (moveToSeenBtn) {
      console.log('🧠 Attaching Pass->Seen button handler for:', movie.title);
      moveToSeenBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const guid = moveToSeenBtn.dataset.guid;
        console.log('🧠 Pass->Seen button clicked! GUID:', guid);
        await moveMovieBetweenLists(guid, 'pass', 'seen');
      });
    } else {
      console.warn('⚠️ No move-to-seen button found for:', movie.title);
    }
    
    dislikesList?.appendChild(card);
    
  } else if (wantsToWatch === null) {
    // Create card for Seen tab (same format as Watch tab but no streaming)
    const card = document.createElement('div');
    card.className = 'watch-card';
    card.dataset.guid = movie.guid;
    
    // Extract TMDb ID from various possible sources
    if (movie.guid && movie.guid.startsWith('tmdb://')) {
      card.dataset.tmdbId = movie.guid.replace('tmdb://', '');
    } else if (movie.guid && /\/(\d+)$/.test(movie.guid)) {
      const match = movie.guid.match(/\/(\d+)$/);
      if (match) card.dataset.tmdbId = match[1];
    } else if (movie.tmdbId || movie.tmdb_id) {
      card.dataset.tmdbId = String(movie.tmdbId || movie.tmdb_id);
    } else if (movie.guid && /movie\/(\d+)/.test(movie.guid)) {
      const match = movie.guid.match(/movie\/(\d+)/);
      if (match) card.dataset.tmdbId = match[1];
    }
    
    // Store filterable data on the card
    card.dataset.genres = JSON.stringify(movie.genre_ids || []);
    card.dataset.languages = JSON.stringify(movie.original_language ? [movie.original_language] : []);
    card.dataset.countries = JSON.stringify(movie.production_countries?.map(c => c.iso_3166_1) || []);
    card.dataset.contentRating = movie.contentRating || '';
    card.dataset.runtime = movie.runtime || '';
    card.dataset.voteCount = movie.vote_count || 0;
    card.dataset.popularity = movie.popularity || 0;
    
    card.innerHTML = `
      <!-- Collapsed header (always visible) -->
      <div class="watch-card-collapsed" onclick="this.closest('.watch-card').classList.toggle('expanded')">
        <div class="watch-card-header-compact">
          <div class="watch-card-title-compact">
            ${movie.title} <span class="watch-card-year">(${movie.year || 'N/A'})</span>
          </div>
          <div class="expand-icon"><i class="fas fa-chevron-down"></i></div>
        </div>
      </div>
      
      <!-- Expandable details (hidden by default) -->
      <div class="watch-card-details">
        <div class="watch-card-poster">
          <img src="${(() => { const p = normalizePoster(movie.art || movie.thumb || ''); return p.startsWith('http') ? p : (basePath + p); })()}" alt="${movie.title}">
        </div>
  
        <div class="watch-card-content">
          ${movie.summary ? `<p class="watch-card-summary">${movie.summary}</p>` : ''}
          ${movie.rating ? `<div class="watch-card-ratings">${movie.rating}</div>` : ''}
        
          <!-- Move to other lists buttons -->
          <div class="list-actions">
            <button class="list-action-btn move-to-watch" data-guid="${movie.guid}" title="Move to Watch">
              <i class="fas fa-thumbs-up"></i>
            </button>
            <button class="list-action-btn move-to-pass" data-guid="${movie.guid}" title="Move to Pass">
              <i class="fas fa-thumbs-down"></i>
            </button>
          </div>
        </div>
      </div>
    `;
    
    // Add event listeners for seen list actions
    const moveToWatchBtn = card.querySelector('.move-to-watch');
    const moveToPassBtn = card.querySelector('.move-to-pass');
    
    if (moveToWatchBtn) {
      console.log('🧠 Attaching Seen->Watch button handler for:', movie.title);
      moveToWatchBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const guid = moveToWatchBtn.dataset.guid;
        console.log('🧠 Seen->Watch button clicked! GUID:', guid);
        await moveMovieBetweenLists(guid, 'seen', 'watch');
      });
    } else {
      console.warn('⚠️ No move-to-watch button found for:', movie.title);
    }
    
    if (moveToPassBtn) {
      console.log('🧠 Attaching Seen->Pass button handler for:', movie.title);
      moveToPassBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const guid = moveToPassBtn.dataset.guid;
        console.log('🧠 Seen->Pass button clicked! GUID:', guid);
        await moveMovieBetweenLists(guid, 'seen', 'pass');
      });
    } else {
      console.warn('⚠️ No move-to-pass button found for:', movie.title);
    }
    
    seenList?.appendChild(card);
  }
}

// Function to move movies between lists
async function moveMovieBetweenLists(guid, fromList, toList) {
  console.log('🔧 moveMovieBetweenLists called:', { guid, fromList, toList });
  
  try {
    // Check if api is available
    if (!api) {
      console.error('❌ API not available!');
      showNotification('Error: API not initialized');
      return;
    }
    
    // Map list names to wantsToWatch values
    const listToValue = {
      'watch': true,
      'pass': false,
      'seen': null
    };
    
    const newValue = listToValue[toList];
    console.log('🧠 New value for wantsToWatch:', newValue);
    
    // Send the response to update the movie's status
    console.log('🗂️ Sending response to API...');
    await api.respond({ guid, wantsToWatch: newValue });
    console.log('✅ API response sent');
    
    // Get the card to extract movie data from it
    const oldCard = document.querySelector(`.watch-card[data-guid="${guid}"]`);
    if (!oldCard) {
      console.error('❌ Card not found with guid:', guid);
      showNotification('Error: Card not found');
      return;
    }
    console.log('🧠 Found old card in DOM');
    
    // Extract movie data from the card's DOM elements and dataset
    const titleEl = oldCard.querySelector('.watch-card-title-compact');
    const titleText = titleEl ? titleEl.textContent.trim() : '';
    const yearMatch = titleText.match(/\((\d{4})\)/);
    const title = titleText.replace(/\s*\(\d{4}\)\s*$/, '').trim();
    const year = yearMatch ? yearMatch[1] : '';
    
    const posterImg = oldCard.querySelector('.watch-card-poster img');
    const art = posterImg ? posterImg.src.replace(/\?w=\d+$/, '').replace(window.location.origin, '').replace(document.body.dataset.basePath || '', '') : '';
    
    const summaryEl = oldCard.querySelector('.watch-card-summary');
    const summary = summaryEl ? summaryEl.textContent.trim() : '';
    
    const ratingEl = oldCard.querySelector('.watch-card-ratings');
    const rating = ratingEl ? ratingEl.innerHTML : '';
    
    // Reconstruct movie object from card data
    const movie = {
      guid,
      title,
      year,
      art,
      summary,
      rating,
      // Get additional data from dataset
      genre_ids: oldCard.dataset.genres ? JSON.parse(oldCard.dataset.genres) : [],
      original_language: oldCard.dataset.languages ? JSON.parse(oldCard.dataset.languages)[0] : undefined,
      production_countries: oldCard.dataset.countries ? JSON.parse(oldCard.dataset.countries).map(c => ({ iso_3166_1: c })) : [],
      contentRating: oldCard.dataset.contentRating || '',
      runtime: oldCard.dataset.runtime || '',
      vote_count: parseInt(oldCard.dataset.voteCount) || 0,
      tmdb_id: oldCard.dataset.tmdbId || '',
    };
    
    console.log('🧠 Reconstructed movie data:', movie.title);
    
    // Remove from old list
    console.log('🧠 Removing card from old list');
    oldCard.remove();
    
    // Add to new list
    const basePath = '';
    const likesList = document.querySelector('.watch-list.likes-list');
    const dislikesList = document.querySelector('.dislikes-list');
    const seenList = document.querySelector('.seen-list');
    
    console.log('🧠 Found lists:', { 
      likesList: !!likesList, 
      dislikesList: !!dislikesList, 
      seenList: !!seenList 
    });
    
    console.log('🧩 Calling appendRatedRow...');
    await appendRatedRow(
      { basePath, likesList, dislikesList, seenList },
      movie,
      newValue
    );
    console.log('✅ appendRatedRow complete');
    
    // Show notification
    const listNames = {
      'watch': 'Watch List',
      'pass': 'Pass List',
      'seen': 'Seen List'
    };
    showNotification(`Moved "${movie.title}" to ${listNames[toList]}`);
    
  } catch (error) {
    console.error('❌Error moving movie between lists:', error);
    console.error('Stack trace:', error.stack);
    showNotification('Failed to move movie. Please try again.');
  }
}

function getStreamingServices(movie) {
  if (movie.streamingServices) {
    // Handle new format { subscription: [], free: [] }
    if (movie.streamingServices.subscription || movie.streamingServices.free) {
      return movie.streamingServices;
    }
    
    // Handle old array format - treat as subscription
    if (Array.isArray(movie.streamingServices) && movie.streamingServices.length > 0) {
      return {
        subscription: movie.streamingServices.map(s => 
          typeof s === 'string' ? { id: 0, name: s, logo_path: null, type: 'subscription' } : s
        ),
        free: []
      };
    }
  }
  
  // Fallback for Plex-only (no legacy /poster/ check)
  const isInPlex = !!movie.guid && (
    movie.guid.includes('plex://') ||
    (!movie.guid.includes('tmdb://') && !movie.guid.includes('imdb://'))
  );
  
  if (isInPlex) {
    return {
      subscription: [{ id: 0, name: window.PLEX_LIBRARY_NAME, logo_path: '/assets/logos/allvids.svg', type: 'subscription' }],
      free: []
    };
  }
  
  return { subscription: [], free: [] };
}

// Check if request service is configured (with caching)
let requestServiceConfiguredCache = null;
async function checkRequestServiceStatus() {
  // Return cached value if available
  if (requestServiceConfiguredCache !== null) {
    return requestServiceConfiguredCache;
  }
  
  try {
    const response = await fetch('/api/request-service-status');
    if (response.ok) {
      const data = await response.json();
      requestServiceConfiguredCache = data.configured;
      return requestServiceConfiguredCache;
    }
  } catch (err) {
    console.warn('⚠️ Failed to check request service status:', err);
  }
  requestServiceConfiguredCache = false;
  return false;
}

// Handle movie request
async function handleMovieRequest(tmdbId, movieTitle, buttonElement) {
  if (!tmdbId) {
    alert('Cannot request this movie: No TMDb ID available');
    return;
  }
  
  buttonElement.disabled = true;
  buttonElement.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Requesting...';
  
  try {
    const response = await fetch('/api/request-movie', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ tmdbId }),
    });
    
    const result = await response.json();
    
    if (result.success) {
      buttonElement.innerHTML = '<i class="fas fa-check"></i> Requested';
      buttonElement.classList.add('requested');
      
      showNotification(`"${movieTitle}" has been requested!`);
      
      // Trigger immediate Radarr cache refresh
      fetch('/api/refresh-radarr-cache', { method: 'POST' }).catch(err => 
        console.error('❌Failed to trigger cache refresh:', err)
      );
      
      // Check status again in 30 seconds
      setTimeout(refreshWatchListStatus, 30000);
    } else {
      buttonElement.innerHTML = '<i class="fas fa-download"></i> ADD TO PLEX';
      buttonElement.disabled = false;
      alert(`Failed to request "${movieTitle}": ${result.message || 'Unknown error'}`);
    }
  } catch (err) {
    console.error('❌Error requesting movie:', err);
    buttonElement.innerHTML = '<i class="fas fa-download"></i> ADD TO PLEX';
    buttonElement.disabled = false;
    alert(`Error requesting "${movieTitle}".`);
  }
}

// Watch List Auto-Refresh System
let watchListRefreshInterval = null;

/**
 * Process a list of items with a concurrency limit to avoid blocking the main thread.
 * @template T,R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, index: number) => Promise<R>} handler
 * @returns {Promise<R[]>}
 */
async function processWithConcurrency(items, limit, handler) {
  const results = new Array(items.length);
  let index = 0;

  const workerCount = Math.min(limit, items.length);
  if (workerCount === 0) return results;

  async function runNext() {
    while (index < items.length) {
      const currentIndex = index++;
      results[currentIndex] = await handler(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, runNext));
  return results;
}

async function refreshWatchListStatus() {
  console.log('🔧 Refreshing Watch list (Plex + Streaming)...');

  const watchCards = Array.from(document.querySelectorAll('.watch-card'));
  const results = await processWithConcurrency(watchCards, 6, async (card) => {
    const addBtn = card.querySelector('.add-to-plex-btn');
    const tmdbId = parseInt(card.dataset.tmdbId);

    if (!tmdbId) {
      return { plexUpdated: 0, streamingUpdated: 0 };
    }

    let plexUpdated = 0;
    let streamingUpdated = 0;

    try {
      // 1. Check Plex status (if button exists)
      if (addBtn) {
        const plexResponse = await fetch(`/api/check-movie-status?tmdbId=${tmdbId}`);
        if (plexResponse.ok) {
          const plexData = await plexResponse.json();

          if (plexData.inPlex) {
            const actionsContainer = card.querySelector('.watch-card-actions');
            const btnToReplace = actionsContainer.querySelector('.add-to-plex-btn');

            if (btnToReplace) {
              btnToReplace.outerHTML = `
                <div class="plex-status">
                  <i class="fas fa-check-circle"></i> ${window.PLEX_LIBRARY_NAME}
                </div>
              `;
              plexUpdated++;
            }
          }
        }
      }

      // 2. Check if "ADD TO PLEX" button should show "Requested" instead
      if (addBtn && !addBtn.classList.contains('requested')) {
        const requestResponse = await fetch(`/api/check-request-status?tmdbId=${tmdbId}`);
        if (requestResponse.ok) {
          const requestData = await requestResponse.json();

          // If movie is pending/processing in Jellyseerr/Overseerr, update button
          if (requestData.pending || requestData.processing) {
            addBtn.innerHTML = '<i class="fas fa-check"></i> Requested';
            addBtn.classList.add('requested');
            addBtn.disabled = true;
          }
        }
      }

      // 3. Refresh streaming data (for ALL movies, even if in Plex)
      const streamingResponse = await fetch(`/api/refresh-streaming/${tmdbId}`);
      if (streamingResponse.ok) {
        const streamingData = await streamingResponse.json();

        // **NEW: Also update the persisted data**
        await fetch(`/api/update-persisted-movie/${tmdbId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            streamingServices: streamingData.streamingServices,
            streamingLink: streamingData.streamingLink
          })
        });

        // Update SUBSCRIPTION and FREE dropdown menus (current Watch-card markup)
        const dropdowns = card.querySelectorAll('.service-dropdown');
        const subMenu = dropdowns[0]?.querySelector('.service-dropdown-menu');
        const freeMenu = dropdowns[1]?.querySelector('.service-dropdown-menu');

        // SUBSCRIPTION
        if (subMenu) {
          const services = (streamingData.streamingServices?.subscription || [])
            .filter(s => s.name !== window.PLEX_LIBRARY_NAME);
          subMenu.innerHTML = renderServiceItems(services, streamingData.streamingLink);
          streamingUpdated++;
        }

        // FREE
        if (freeMenu) {
          const services = streamingData.streamingServices?.free || [];
          freeMenu.innerHTML = renderServiceItems(services, streamingData.streamingLink);
        }
      }

    } catch (err) {
      console.error(`❌Failed to refresh TMDb ID ${tmdbId}:`, err);
    }

    return { plexUpdated, streamingUpdated };
  });

  const { plexUpdatedCount, streamingUpdatedCount } = results.reduce((acc, result = {}) => {
    acc.plexUpdatedCount += result.plexUpdated || 0;
    acc.streamingUpdatedCount += result.streamingUpdated || 0;
    return acc;
  }, { plexUpdatedCount: 0, streamingUpdatedCount: 0 });

  // Show notification with results
  const messages = [];
  if (plexUpdatedCount > 0) {
    messages.push(`${plexUpdatedCount} now in Plex`);
  }
  if (streamingUpdatedCount > 0) {
    messages.push(`${streamingUpdatedCount} streaming updated`);
  }

  if (messages.length > 0) {
    console.log(`✅ ${messages.join(', ')}`);
    showNotification(messages.join(' • '));
  } else {
    showNotification('Everything up to date!');
  }

  // Reset expand/collapse button state after refresh
  if (typeof resetExpandCollapseButton === 'function') {
    resetExpandCollapseButton();
  }
}

// Helper to render service items
function renderServiceItems(services, streamingLink) {
  if (!services || services.length === 0) {
    return '<div class="service-item">None available</div>';
  }
  
  const basePath = document.body.dataset.basePath || '';
  
  if (streamingLink) {
    return `
      <a href="${streamingLink}" target="_blank" rel="noopener noreferrer" class="service-link-wrapper">
        ${services.map(s => {
          const logoUrl = s.logo_path 
            ? (s.logo_path.startsWith('/assets/') 
                ? `${basePath}${s.logo_path}` 
                : `https://image.tmdb.org/t/p/original${s.logo_path}`)
            : null;
          
          return `<div class="service-item">
            ${logoUrl ? `<img src="${logoUrl}" alt="${s.name}" class="service-logo-small">` : ''}
            <span>${s.name}</span>
          </div>`;
        }).join('')}
        <div class="service-footer">
          <i class="fas fa-external-link-alt"></i> View on JustWatch
        </div>
      </a>
    `;
  }
  
  return services.map(s => {
    const logoUrl = s.logo_path 
      ? (s.logo_path.startsWith('/assets/') 
          ? `${basePath}${s.logo_path}` 
          : `https://image.tmdb.org/t/p/original${s.logo_path}`)
      : null;
    
    return `<div class="service-item">
      ${logoUrl ? `<img src="${logoUrl}" alt="${s.name}" class="service-logo-small">` : ''}
      <span>${s.name}</span>
    </div>`;
  }).join('');
}

function startWatchListAutoRefresh() {
  if (watchListRefreshInterval) {
    clearInterval(watchListRefreshInterval);
  }
  
  // Check once daily for both Plex and JustWatch
  watchListRefreshInterval = setInterval(checkDailyRefresh, 60 * 60 * 1000); // Check every hour
  console.log('🔧 Started daily auto-refresh check (hourly)');
  
  // Run initial check when tab opens
  checkDailyRefresh();
}

// Daily refresh tracking
const LAST_PLEX_REFRESH_KEY = 'lastPlexRefresh';
const LAST_JUSTWATCH_REFRESH_KEY = 'lastJustWatchRefresh';
const ONE_DAY = 24 * 60 * 60 * 1000;

function shouldRefreshPlex() {
  const lastRefresh = localStorage.getItem(LAST_PLEX_REFRESH_KEY);
  if (!lastRefresh) return true;
  
  const timeSinceRefresh = Date.now() - parseInt(lastRefresh);
  return timeSinceRefresh > ONE_DAY;
}

function shouldRefreshJustWatch() {
  const lastRefresh = localStorage.getItem(LAST_JUSTWATCH_REFRESH_KEY);
  if (!lastRefresh) return true;
  
  const timeSinceRefresh = Date.now() - parseInt(lastRefresh);
  return timeSinceRefresh > ONE_DAY;
}

async function checkDailyRefresh() {
  const needsPlex = shouldRefreshPlex();
  const needsJustWatch = shouldRefreshJustWatch();
  
  if (!needsPlex && !needsJustWatch) {
    console.log('✅ Daily refreshes already completed');
    return;
  }
  
  console.log(`🗂️ Daily auto-refresh: Plex=${needsPlex}, JustWatch=${needsJustWatch}`);
  
  const watchCards = Array.from(document.querySelectorAll('.watch-card'));

  const results = await processWithConcurrency(watchCards, 6, async (card) => {
    const addBtn = card.querySelector('.add-to-plex-btn');
    const tmdbId = parseInt(card.dataset.tmdbId);

    if (!tmdbId) {
      return { plexUpdated: 0, streamingUpdated: 0 };
    }

    let plexUpdated = 0;
    let streamingUpdated = 0;

    try {
      // 1. Check Plex status (if needed)
      if (needsPlex && addBtn) {
        const plexResponse = await fetch(`/api/check-movie-status?tmdbId=${tmdbId}`);
        if (plexResponse.ok) {
          const plexData = await plexResponse.json();

          if (plexData.inPlex) {
            const actionsContainer = card.querySelector('.watch-card-actions');
            const btnToReplace = actionsContainer.querySelector('.add-to-plex-btn');

            if (btnToReplace) {
              btnToReplace.outerHTML = `
                <div class="plex-status">
                  <i class="fas fa-check-circle"></i> ${window.PLEX_LIBRARY_NAME}
                </div>
              `;
              plexUpdated++;
            }
          }
        }
      }

      // 2. Refresh streaming data (if needed)
      if (needsJustWatch) {
        const streamingResponse = await fetch(`/api/refresh-streaming/${tmdbId}`);
        if (streamingResponse.ok) {
          const streamingData = await streamingResponse.json();

          // Update subscription services
          const subContainer = card.querySelector('.streaming-subscription .service-list');
          if (subContainer) {
            const services = streamingData.streamingServices.subscription || [];
            subContainer.innerHTML = renderServiceItems(services, streamingData.streamingLink);
            streamingUpdated++;
          }

          // Update free services
          const freeContainer = card.querySelector('.streaming-free .service-list');
          if (freeContainer) {
            const services = streamingData.streamingServices.free || [];
            freeContainer.innerHTML = renderServiceItems(services, streamingData.streamingLink);
          }
        }
      }

    } catch (err) {
      console.error(`❌Failed to refresh TMDb ID ${tmdbId}:`, err);
    }

    return { plexUpdated, streamingUpdated };
  });

  const { plexUpdatedCount, streamingUpdatedCount } = results.reduce((acc, result = {}) => {
    acc.plexUpdatedCount += result.plexUpdated || 0;
    acc.streamingUpdatedCount += result.streamingUpdated || 0;
    return acc;
  }, { plexUpdatedCount: 0, streamingUpdatedCount: 0 });

  // Update timestamps
  if (needsPlex) {
    localStorage.setItem(LAST_PLEX_REFRESH_KEY, Date.now().toString());
    if (plexUpdatedCount > 0) {
      console.log(`✅ Daily Plex refresh: ${plexUpdatedCount} movie(s) now in Plex`);
    }
  }
  
  if (needsJustWatch) {
    localStorage.setItem(LAST_JUSTWATCH_REFRESH_KEY, Date.now().toString());
    if (streamingUpdatedCount > 0) {
      console.log(`✅ Daily JustWatch refresh: ${streamingUpdatedCount} movie(s) updated`);
    }
  }
  
  // Show notification if anything updated
  const messages = [];
  if (plexUpdatedCount > 0) {
    messages.push(`${plexUpdatedCount} now in Plex`);
  }
  if (streamingUpdatedCount > 0) {
    messages.push(`${streamingUpdatedCount} streaming updated`);
  }
  
  if (messages.length > 0) {
    showNotification('Daily refresh: ' + messages.join(' • '));
  }
}

function stopWatchListAutoRefresh() {
  if (watchListRefreshInterval) {
    clearInterval(watchListRefreshInterval);
    watchListRefreshInterval = null;
    console.log('🔧 Stopped Watch list auto-refresh');
  }
}

function showNotification(message) {
  let notification = document.getElementById('watch-notification');
  if (!notification) {
    notification = document.createElement('div');
    notification.id = 'watch-notification';
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
    `;
    document.body.appendChild(notification);
    
    const style = document.createElement('style');
    style.textContent = `
      @keyframes slideIn {
        from { transform: translateX(400px); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
    `;
    document.head.appendChild(style);
  }
  
  notification.textContent = message;
  notification.style.display = 'block';
  
  setTimeout(() => {
    notification.style.display = 'none';
  }, 3000);
}

function showNoMoviesNotification() {
  let notification = document.getElementById('no-movies-notification');
  if (!notification) {
    notification = document.createElement('div');
    notification.id = 'no-movies-notification';
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
    `;
    document.body.appendChild(notification);
    
    const style = document.createElement('style');
    style.textContent = `
      @keyframes slideDown {
        from { transform: translate(-50%, -100px); opacity: 0; }
        to { transform: translate(-50%, 0); opacity: 1; }
      }
    `;
    document.head.appendChild(style);
  }
  
  notification.innerHTML = `
    <i class="fas fa-exclamation-triangle"></i> 
    No more movies found with current filters.<br>
    <small style="font-weight: 400; opacity: 0.9;">Try adjusting your filters or resetting them.</small>
  `;
  notification.style.display = 'block';
  
  setTimeout(() => {
    notification.style.opacity = '0';
    notification.style.transition = 'opacity 0.3s';
    setTimeout(() => {
      notification.style.display = 'none';
      notification.style.opacity = '1';
    }, 300);
  }, 5000);
}

/* -------------------- main ---------------------- */
const main = async () => {
  console.log('🚀 Comparr main() starting');
  const CARD_STACK_SIZE = 4

  api = new ComparrAPI()
  console.log('⏳ Waiting for login...');
  const loginData = await login(api)
  console.log('✅ Login successful:', loginData);
  const { matches, rated, user: userName, roomCode } = loginData

  document.body.classList.add('is-logged-in')
  
  // Track movies this user has already rated (to prevent showing them again)
  const normalizeGuid = (value) => {
    if (value == null) return '';
    return String(value).trim();
  };

  const ratedGuids = new Set(
    rated
      .map(r => normalizeGuid(r.movie?.guid ?? r.guid))
      .filter(Boolean)
  );
  console.log(`⚠️ User has already rated ${ratedGuids.size} movies`);

  const getNormalizedTmdbId = (movie) => {
    if (!movie) return null;

    const directId = movie.tmdbId ?? movie.tmdb_id ?? movie.tmdbID ?? movie.tmdbid;
    if (directId) {
      return String(directId).trim();
    }

    if (typeof movie.guid === 'string') {
      const guidMatch =
        movie.guid.match(/tmdb:\/\/(\d+)/i) ||
        movie.guid.match(/themoviedb:\/\/(\d+)/i);
      if (guidMatch) return guidMatch[1];
    }

    if (typeof movie.streamingLink === 'string') {
      const linkMatch = movie.streamingLink.match(/themoviedb\.org\/movie\/(\d+)/i);
      if (linkMatch) return linkMatch[1];
    }

    if (movie.ids?.tmdb) {
      return String(movie.ids.tmdb).trim();
    }

    return null;
  };

  // ALSO track rated TMDb IDs for cross-format matching (Plex GUID vs TMDb GUID)
  const ratedTmdbIds = new Set();
  for (const r of rated) {
    const normalizedGuid = normalizeGuid(r.movie?.guid ?? r.guid);
    if (normalizedGuid) ratedGuids.add(normalizedGuid);

    const normalized = getNormalizedTmdbId(r.movie);
    if (normalized) ratedTmdbIds.add(normalized);
  }
  console.log(`🎬 Tracking ${ratedTmdbIds.size} unique TMDb IDs from rated movies`);
  
  // Get Plex library name from environment or use default
  window.PLEX_LIBRARY_NAME = 'AllVids';
  
  const matchesView = new MatchesView(matches)
  
  // Match event listener - show popup and add to matches view
  api.addEventListener('match', e => {
    const matchData = e.data
    matchesView.add(matchData)
    showMatchPopup(matchData)
  })
  
  api.addEventListener('message', e => {
    const data = e.data
    if (data.type === 'matchRemoved') {
      const { guid } = data.payload
      const matchIndex = matchesView.matches.findIndex(m => m.movie.guid === guid)
      if (matchIndex !== -1) {
        matchesView.matches.splice(matchIndex, 1)
        matchesView.render()
      }
    }
  })

  const likesList    = document.querySelector('.likes-list')
  const dislikesList = document.querySelector('.dislikes-list')
  const seenList     = document.querySelector('.seen-list')
  const basePath     = document.body.dataset.basePath || ''
  const movieByGuid  = new Map()
  
  // Filter state - consolidated into one declaration
  const filterState = {
    yearRange: { min: DEFAULT_YEAR_MIN, max: new Date().getFullYear() },
    genres: [],
    contentRatings: [],
    //streamingServices: [],
    showPlexOnly: false,
    languages: [...DEFAULT_LANGUAGES],
    countries: [],
    // imdbRating: 0.0, //COMMENTED OUT
    tmdbRating: 0.0,
    runtimeRange: { min: 0, max: 300 },
    voteCount: DEFAULT_VOTE_COUNT,
    sortBy: 'popularity.desc',
    // rtRating: 0 //COMMENTED OUT
  }

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
    if (voteCountSliderEl) voteCountSliderEl.value = String(filterState.voteCount)
    if (voteCountValueEl) voteCountValueEl.textContent = filterState.voteCount.toLocaleString()
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
  
  // Where to Watch toggle handler (proper switch style)
  const plexOnlyToggle = document.getElementById('plex-only-toggle')
  const toggleLabels = document.querySelectorAll('.toggle-label-text')

  const handlePlexToggle = (e) => {
    filterState.showPlexOnly = e.target.checked
    
    // Update label styling
    toggleLabels.forEach((label, index) => {
      if (index === 0) { // "All Movies"
        label.classList.toggle('active', !e.target.checked)
      } else { // "My Plex Only"
        label.classList.toggle('active', e.target.checked)
      }
    })
    
    console.log('Where to Watch:', filterState.showPlexOnly ? 'My Plex Only' : 'All Movies')
    
    // Immediately clear any buffered movies fetched with the previous filter state
    // so the swipe stack doesn't continue to show non-Plex results.
    window.__resetMovies = true

    // If the user is already logged in, request a fresh batch right away so the
    // swipe deck reflects the Plex-only preference without waiting for the
    // Apply button.
    if (
      document.body.classList.contains('is-logged-in') &&
      typeof triggerNewBatch === 'function' &&
      typeof cardStackEventTarget !== 'undefined'
    ) {
      triggerNewBatch()
    }
  }

  plexOnlyToggle?.addEventListener('change', handlePlexToggle)
  // Add touchend for better mobile responsiveness
  plexOnlyToggle?.addEventListener('touchend', (e) => {
    // Let the change event handle the logic
    e.stopPropagation()
  }, { passive: false })

  // FIXED DROPDOWN SETUP
  function setupAllDropdowns() {
    console.log('🔧 Setting up dropdowns...');
    
    // Create overlay container for dropdowns
    let overlay = document.getElementById('filter-dropdown-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'filter-dropdown-overlay';
      overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 10000;
      `;
      document.body.appendChild(overlay);
    }

    const pairs = [
    {
      type: 'genre',
      toggle: document.getElementById('genre-dropdown-toggle'),
      list: document.getElementById('genre-dropdown-list'),
      checkboxes: document.querySelectorAll('.genre-checkbox input[type="checkbox"]')
    },
    {
      type: 'language',
      toggle: document.getElementById('language-dropdown-toggle'),
      list: document.getElementById('language-dropdown-list'),
      checkboxes: document.querySelectorAll('.language-checkbox input[type="checkbox"]')
    },
    {
      type: 'country',
      toggle: document.getElementById('country-dropdown-toggle'),
      list: document.getElementById('country-dropdown-list'),
      checkboxes: document.querySelectorAll('.country-checkbox input[type="checkbox"]')
    },
    {
      type: 'sort',
      toggle: document.getElementById('sort-dropdown-toggle'),
      list: document.getElementById('sort-dropdown-list'),
      radios: document.querySelectorAll('input[name="sort"]')
    },
    {
      type: 'rating',
      toggle: document.getElementById('rating-dropdown-toggle'),
      list: document.getElementById('rating-dropdown-list'),
      checkboxes: document.querySelectorAll('.rating-checkbox input[type="checkbox"]')
    }
  ];

    let currentOpen = null;

    function closeAllDropdowns() {
      pairs.forEach(p => {
        if (p.list) {
          p.list.style.display = 'none';
          p.list.style.pointerEvents = 'none';
        }
        if (p.toggle) {
          p.toggle.classList.remove('open');
        }
      });
      currentOpen = null;
    }

    function openDropdown(pair) {
      if (!pair.toggle || !pair.list) return;

      console.log(`🧠 Opening ${pair.type} dropdown`);
      
      const rect = pair.toggle.getBoundingClientRect();
      
      // Move to overlay and position
      overlay.appendChild(pair.list);
      
      // Force styles to override CSS
      pair.list.style.cssText = `
        position: fixed !important;
        top: ${rect.bottom + 4}px !important;
        left: ${rect.left}px !important;
        width: ${Math.max(rect.width, 200)}px !important;
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
      `;

      pair.toggle.classList.add('open');
      currentOpen = pair.type;
      
      console.log(`🧠 ${pair.type} dropdown visible at`, {
        top: pair.list.style.top,
        left: pair.list.style.left,
        display: pair.list.style.display
      });
    }

    // Attach click handlers
    pairs.forEach(pair => {
      if (!pair.toggle || !pair.list) {
        console.warn(`⚠️ Missing elements for ${pair.type}`);
        return;
      }

      // Toggle button handlers - both touch and click
      const handleToggle = (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        console.log(`🧠 ${pair.type} toggle activated`);
        
        if (currentOpen === pair.type) {
          closeAllDropdowns();
        } else {
          closeAllDropdowns();
          setTimeout(() => openDropdown(pair), 10);
        }
      };

      // Add both touch and click handlers for mobile support
      pair.toggle.addEventListener('touchend', handleToggle, { passive: false });
      pair.toggle.addEventListener('click', handleToggle);

      // Prevent clicks inside dropdown from closing it
      pair.list.addEventListener('click', (e) => {
        e.stopPropagation();
      });

      // Genre checkboxes
      if (pair.type === 'genre' && pair.checkboxes) {
        pair.checkboxes.forEach(cb => {
          cb.addEventListener('change', (e) => {
            const val = parseInt(e.target.value);
            if (e.target.checked) {
              if (!filterState.genres.includes(val)) {
                filterState.genres.push(val);
              }
            } else {
              filterState.genres = filterState.genres.filter(id => id !== val);
            }
            console.log('Genres:', filterState.genres);
            updateGenreButton(filterState.genres);
          });
        });
      }

      // Language checkboxes
      if (pair.type === 'language' && pair.checkboxes) {
        pair.checkboxes.forEach(cb => {
          cb.addEventListener('change', (e) => {
            const val = e.target.value;
            if (e.target.checked) {
              if (!filterState.languages.includes(val)) {
                filterState.languages.push(val);
              }
            } else {
              filterState.languages = filterState.languages.filter(l => l !== val);
            }
            console.log('Languages:', filterState.languages);
            updateLanguageButton(filterState.languages);
          });
        });
      }

      // Country checkboxes
      if (pair.type === 'country' && pair.checkboxes) {
        pair.checkboxes.forEach(cb => {
          cb.addEventListener('change', (e) => {
            const val = e.target.value;
            if (e.target.checked) {
              if (!filterState.countries.includes(val)) {
                filterState.countries.push(val);
              }
            } else {
              filterState.countries = filterState.countries.filter(c => c !== val);
            }
            console.log('Countries:', filterState.countries);
            updateCountryButton(filterState.countries);
          });
        });
      }

      // Sort radios
      if (pair.type === 'sort' && pair.radios) {
        pair.radios.forEach(radio => {
          radio.addEventListener('change', (e) => {
            if (e.target.checked) {
              filterState.sortBy = e.target.value;
              const text = e.target.parentElement.textContent.trim();
              pair.toggle.innerHTML = `${text} <span class="dropdown-arrow">▼</span>`;
              console.log('Sort:', filterState.sortBy);
              setTimeout(closeAllDropdowns, 100);
            }
          });
        });
      }
      
      // Content Rating checkboxes
      if (pair.type === 'rating' && pair.checkboxes) {
        pair.checkboxes.forEach(cb => {
          cb.addEventListener('change', (e) => {
            const rating = e.target.value;
            if (e.target.checked) {
              if (!filterState.contentRatings.includes(rating)) {
                filterState.contentRatings.push(rating);
              }
            } else {
              filterState.contentRatings = filterState.contentRatings.filter(r => r !== rating);
            }
            console.log('Content Ratings:', filterState.contentRatings);
            updateContentRatingButton(filterState.contentRatings);
          });
        });
      }
    });
    
    // Close on outside click
    document.addEventListener('click', (e) => {
      if (currentOpen) {
        const clickedInside = pairs.some(p => 
          p.toggle?.contains(e.target) || p.list?.contains(e.target)
        );
        if (!clickedInside) {
          closeAllDropdowns();
        }
      }
    });

    // Close on scroll/resize
    window.addEventListener('scroll', closeAllDropdowns, { passive: true });
    window.addEventListener('resize', closeAllDropdowns);

    console.log('✅ Dropdown setup complete');
  }

  setupAllDropdowns();
  syncFilterUIWithState();
  
  // =========================================================
  // Filter Sort Direction Button
  // =========================================================
  const sortDirectionBtn = document.getElementById('sort-direction-btn');
  
  // Handle direction button click
  sortDirectionBtn?.addEventListener('click', () => {
    // Get currently selected radio button
    const selectedRadio = document.querySelector('input[name="sort"]:checked');
    if (!selectedRadio) return;
    
    const currentValue = selectedRadio.value; // e.g., "popularity.desc"
    
    // Parse current value
    const parts = currentValue.split('.');
    const field = parts[0];
    const currentDirection = parts[1];
    
    // Toggle direction
    const newDirection = currentDirection === 'desc' ? 'asc' : 'desc';
    const newValue = `${field}.${newDirection}`;
    
    // Update filterState
    filterState.sortBy = newValue;
    
    // Update the selected radio (find or create it)
    let newRadio = document.querySelector(`input[name="sort"][value="${newValue}"]`);
    if (newRadio) {
      newRadio.checked = true;
    } else {
      // Radio doesn't exist, just update the current one's value
      selectedRadio.value = newValue;
      selectedRadio.checked = true;
    }
    
    // Update button arrow
    sortDirectionBtn.textContent = newDirection === 'desc' ? '↓' : '↑';
    
    // Update dropdown button text to show direction
    const sortDropdownToggle = document.getElementById('sort-dropdown-toggle');
    if (sortDropdownToggle) {
      const fieldName = selectedRadio.parentElement.textContent.trim();
      const directionText = newDirection === 'desc' ? ' ↓' : ' ↑';
      sortDropdownToggle.innerHTML = `${fieldName}${directionText} <span class="dropdown-arrow">▼</span>`;
    }
    
    console.log('Filter sort direction changed:', newValue);
  });  
    
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
  
  /* COMMENTED OUT - IMDb Rating Filter
  const imdbRatingSlider = document.getElementById('imdb-rating')
  const imdbRatingValue = document.getElementById('imdb-rating-value')
  imdbRatingSlider?.addEventListener('input', (e) => {
    const rating = parseFloat(e.target.value)
    filterState.imdbRating = rating
    imdbRatingValue.textContent = rating.toFixed(1)
  })
  */
  
  const tmdbRatingSlider = document.getElementById('tmdb-rating')
  const tmdbRatingValue = document.getElementById('tmdb-rating-value')
  tmdbRatingSlider?.addEventListener('input', (e) => {
    const rating = parseFloat(e.target.value)
    filterState.tmdbRating = rating
    tmdbRatingValue.textContent = rating.toFixed(1)
  })
  
  yearMinInput?.addEventListener('change', (e) => {
    const value = parseInt(e.target.value) || 1895
    filterState.yearRange.min = value
  })
  
  yearMaxInput?.addEventListener('change', (e) => {
    const value = parseInt(e.target.value) || currentYear
    filterState.yearRange.max = value
  })

  const runtimeMinInput = document.getElementById('runtime-min')
  const runtimeMaxInput = document.getElementById('runtime-max')
  
  runtimeMinInput?.addEventListener('change', (e) => {
    const value = parseInt(e.target.value) || 0
    filterState.runtimeRange.min = value
  })
  
  runtimeMaxInput?.addEventListener('change', (e) => {
    const value = parseInt(e.target.value) || 300
    filterState.runtimeRange.max = value
  })
  
  const voteCountSlider = document.getElementById('vote-count')
  const voteCountValue = document.getElementById('vote-count-value')
  voteCountSlider?.addEventListener('input', (e) => {
    const count = parseInt(e.target.value)
    filterState.voteCount = count
    voteCountValue.textContent = count.toLocaleString()
  })
  
  /* COMMENTED OUT - RT Rating Filter
  const rtRatingSlider = document.getElementById('rt-rating')
  const rtRatingValue = document.getElementById('rt-rating-value')
  rtRatingSlider?.addEventListener('input', (e) => {
    const rating = parseInt(e.target.value)
    filterState.rtRating = rating
    rtRatingValue.textContent = rating
  })
  */
  
  // Apply filters button
  const applyFiltersBtn = document.getElementById('apply-filters')
  const handleApplyFilters = (e) => {
    e.preventDefault()
    e.stopPropagation()
    
    window.__resetMovies = true  // Invalidate old buffer
    console.log('🧩 FILTER DEBUG - Applying filters:', JSON.stringify(filterState, null, 2))
    triggerNewBatch()
    const swipeButton = document.querySelector('[data-tab="tab-swipe"]')
    swipeButton?.click()
  }

  // Add both touch and click handlers for mobile support
  applyFiltersBtn?.addEventListener('touchend', handleApplyFilters, { passive: false })
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
      if (cardStack && cardStack.children.length === 0 && movieBuffer.length > 0) {
        console.log('📋 No cards visible, loading from buffer...')
        for (let i = 0; i < Math.min(CARD_STACK_SIZE, movieBuffer.length); i++) {
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

  const handleResetFilters = (e) => {
    e.preventDefault()
    e.stopPropagation()
    
    // Reset filterState to defaults
    filterState.yearRange = { min: DEFAULT_YEAR_MIN, max: currentYear }
    filterState.genres = []
    filterState.contentRatings = []
    //filterState.streamingServices = []
    filterState.languages = [...DEFAULT_LANGUAGES]
    filterState.countries = []
    //filterState.imdbRating = 0.0
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
    
    // Reset Where to Watch toggle
    const plexOnlyToggle = document.getElementById('plex-only-toggle')
    if (plexOnlyToggle) {
      plexOnlyToggle.checked = false
      filterState.showPlexOnly = false
      const toggleLabels = document.querySelectorAll('.toggle-label-text')
      toggleLabels.forEach((label, index) => {
        if (index === 0) {
          label.classList.add('active')
        } else {
          label.classList.remove('active')
        }
      })
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
      radio.checked = (radio.value === 'popularity.desc')
    })
    
    // Reset sort direction button
    const resetSortBtn = document.getElementById('sort-direction-btn');
    if (resetSortBtn) {
      resetSortBtn.textContent = '↓';
    }
    
    // Reset sort dropdown toggle text
    const resetSortToggle = document.getElementById('sort-dropdown-toggle');
    if (resetSortToggle) {
      resetSortToggle.innerHTML = 'Popularity <span class="dropdown-arrow">▼</span>';
    }
    
    // Reset dropdown button texts
    updateGenreButton(filterState.genres);
    
    // Reset sort radio buttons
    const sortRadios = document.querySelectorAll('input[name="sort"]')
    sortRadios.forEach(radio => {
      radio.checked = (radio.value === 'popularity.desc')
    })
    
    // Reset sort direction button
    const sortDirectionBtn = document.getElementById('sort-direction-btn');
    if (sortDirectionBtn) {
      sortDirectionBtn.textContent = '↓';
    }
    
    // Reset sort dropdown toggle text
    const sortDropdownToggle = document.getElementById('sort-dropdown-toggle');
    if (sortDropdownToggle) {
      sortDropdownToggle.innerHTML = 'Popularity <span class="dropdown-arrow">▼</span>';
    }
    
    // Reset dropdown button texts
    updateGenreButton(filterState.genres);
    updateLanguageButton(filterState.languages);
    updateCountryButton(filterState.countries);
    updateContentRatingButton(filterState.contentRatings);
    
    console.log('Filters reset to default')
  }

  // Add both touch and click handlers for mobile support
  resetFiltersBtn?.addEventListener('touchend', handleResetFilters, { passive: false })
  resetFiltersBtn?.addEventListener('click', handleResetFilters)
  
  let topCardEl = null
  const cardStackEventTarget = new EventTarget()
  cardStackEventTarget.addEventListener('newTopCard', () => {
    topCardEl = topCardEl?.nextSibling || null
    if (!topCardEl) {
      const cardStackEl = document.querySelector('.js-card-stack')
      cardStackEl?.style.setProperty('--empty-text', `var(--i18n-exhausted-cards)`)
    }
  })

  let movieBuffer = []
  let pendingGuids = new Set()
  let pendingTmdbIds = new Set()
  let isLoadingBatch = false
  let ensureMovieBufferPromise = null
  const BUFFER_MIN_SIZE = 8
  const BATCH_SIZE = 20

  window.ensureMovieBufferPromise = ensureMovieBufferPromise
  window.isLoadingBatch = isLoadingBatch

  // Prime request-service status and the initial swipe buffer in parallel
  console.log('🧊 Priming request status and initial movie batch...');
  const requestServiceStatusPromise = checkRequestServiceStatus()
  const initialBufferWarmPromise = ensureMovieBuffer()

  await requestServiceStatusPromise
  console.log('📦 Request service status cached');

  initialBufferWarmPromise?.catch(err => {
    console.warn('⚠️ Initial movie buffer warm failed:', err)
  })

  if (rated && rated.length > 0) {
    for (const item of rated) {
      if (item.movie) {
        appendRatedRow({ basePath, likesList, dislikesList, seenList }, item.movie, item.wantsToWatch)
      }
    }
  }

  
async function ensureMovieBuffer() {
  // If already loading, return the existing promise with timeout
  if (ensureMovieBufferPromise) {
    console.log('⏳ Already ensuring buffer, waiting...')
    try {
      await Promise.race([
        ensureMovieBufferPromise,
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Buffer promise timeout')), 10000)
        )
      ])
    } catch (e) {
      if (e.message === 'Buffer promise timeout') {
        console.warn('⚠️ Buffer promise timed out, resetting')
        ensureMovieBufferPromise = null
        window.ensureMovieBufferPromise = ensureMovieBufferPromise
        isLoadingBatch = false
        window.isLoadingBatch = isLoadingBatch
        // Retry the buffer load
        return ensureMovieBuffer()
      }
      throw e
    }
    return ensureMovieBufferPromise
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

  if (isLoadingBatch || movieBuffer.length >= BUFFER_MIN_SIZE) {
    return
  }

  isLoadingBatch = true
  window.isLoadingBatch = isLoadingBatch

  //FIX: Create and store the promise immediately
  ensureMovieBufferPromise = (async () => {
    try {
      const MAX_BATCH_ATTEMPTS = 4
      let attempts = 0
      let addedMovies = 0
      const bufferWasEmpty = movieBuffer.length === 0

      while (attempts < MAX_BATCH_ATTEMPTS && movieBuffer.length < BUFFER_MIN_SIZE) {
        attempts += 1
        console.log(`🗂️ Requesting new batch (attempt ${attempts}) with filters:`, filterState)
        const newBatch = await api.requestNextBatchWithFilters({
          ...filterState,
          runtimeMin: filterState.runtimeRange.min || undefined,
          runtimeMax: filterState.runtimeRange.max || undefined,
          voteCount: filterState.voteCount,
          sortBy: filterState.sortBy,
          rtRating: filterState.rtRating,
          batchSize: BATCH_SIZE
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
            console.log(`Filtering ${movie.title} - TMDb ID ${normalizedTmdbId} already rated`)
            return false
          }

          if (normalizedGuid && pendingGuids.has(normalizedGuid)) {
            console.log(`Skipping ${movie.title} - GUID already pending in swipe stack`)
            return false
          }

          if (normalizedTmdbId && pendingTmdbIds.has(normalizedTmdbId)) {
            console.log(`Skipping ${movie.title} - TMDb ID ${normalizedTmdbId} already pending`)
            return false
          }

          if (normalizedGuid && batchGuids.has(normalizedGuid)) {
            console.log(`Skipping ${movie.title} - duplicate GUID within batch`)
            return false
          }
          if (normalizedTmdbId && batchTmdbIds.has(normalizedTmdbId)) {
            console.log(`Skipping ${movie.title} - duplicate TMDb ID within batch`)
            return false
          }

          if (normalizedGuid) batchGuids.add(normalizedGuid)
          if (normalizedTmdbId) batchTmdbIds.add(normalizedTmdbId)
          return true
        })

        console.log(`🧠 Filtered to ${unseenMovies.length} unseen movies (${newBatch.length - unseenMovies.length} removed as rated/duplicates)`)

        if (unseenMovies.length === 0) {
          console.log('🔁 Batch yielded no new unseen movies, requesting another batch')
          continue
        }

        addedMovies += unseenMovies.length
        movieBuffer.push(...unseenMovies)

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

        if (!hasVisibleMovies) {
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

  // NEW loadMoviesWithFilters
  async function loadMoviesWithFilters() {
    window.__resetMovies = false

    try {
      await ensureMovieBuffer()
    
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
              topCardEl = document.querySelector('.js-card-stack > :first-child')
            }, 100)
          }
        }
      }
    
      await ensureMovieBuffer()
    
    } catch (error) {
      console.error('❌Error in initial movie loading:', error)
    }

    while (true) {
      const { guid, wantsToWatch } = await new Promise(resolve => {
        cardStackEventTarget.addEventListener('response', e => resolve(e.data), { once: true })
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
        appendRatedRow({ basePath, likesList, dislikesList, seenList }, m, wantsToWatch)
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
        new CardView(nextMovie, cardStackEventTarget)
        {
          const guidKey = normalizeGuid(nextMovie.guid) || nextMovie.guid
          if (guidKey) movieByGuid.set(guidKey, nextMovie)
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
const watchFilterBtn = document.getElementById('watch-filter-btn');
const watchFilterModal = document.getElementById('watch-filter-modal');
const watchFilterOverlay = document.getElementById('watch-filter-overlay');
const watchFilterClose = document.getElementById('watch-filter-close');
const watchFilterApply = document.getElementById('watch-filter-apply');
const watchFilterReset = document.getElementById('watch-filter-reset');

function openWatchFilterModal() {
  watchFilterModal?.classList.add('active');
  watchFilterOverlay?.classList.add('active');
}

function closeWatchFilterModal() {
  watchFilterModal?.classList.remove('active');
  watchFilterOverlay?.classList.remove('active');
}

watchFilterBtn?.addEventListener('click', openWatchFilterModal);
watchFilterClose?.addEventListener('click', closeWatchFilterModal);
watchFilterOverlay?.addEventListener('click', closeWatchFilterModal);

// =========================================================
// Watch List Sort Controls
// =========================================================
const watchSortDropdown = document.getElementById('watch-sort');
const watchSortDirectionBtn = document.getElementById('watch-sort-direction');

if (watchSortDirectionBtn && !watchSortDirectionBtn.dataset.direction) {
  watchSortDirectionBtn.dataset.direction = 'desc';
}

// Handle sort dropdown change with separate direction control
watchSortDropdown?.addEventListener('change', () => {
  const sortField = watchSortDropdown.value;
  const direction = watchSortDirectionBtn?.dataset.direction || 'desc';
  window.sortWatchList(`${sortField}-${direction}`);
});

// Handle direction button click - toggle between asc/desc
watchSortDirectionBtn?.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();

  const currentDirection = watchSortDirectionBtn.dataset.direction === 'asc' ? 'asc' : 'desc';
  const newDirection = currentDirection === 'desc' ? 'asc' : 'desc';
  watchSortDirectionBtn.dataset.direction = newDirection;
  watchSortDirectionBtn.textContent = newDirection === 'desc' ? '↓' : '↑';

  const sortField = watchSortDropdown?.value || 'date';
  window.sortWatchList(`${sortField}-${newDirection}`);
});

// =========================================================
// Expand/Collapse All Button
// =========================================================
const toggleExpandAllBtn = document.getElementById('toggle-expand-all-btn');
let allExpanded = false;

// Function to reset the expand/collapse button state
function resetExpandCollapseButton() {
  allExpanded = false;
  if (toggleExpandAllBtn) {
    toggleExpandAllBtn.classList.remove('all-expanded');
    toggleExpandAllBtn.title = 'Expand All';
  }
}

toggleExpandAllBtn?.addEventListener('click', () => {
  const likesList = document.querySelector('.likes-list');
  if (!likesList) return;
  
  const cards = likesList.querySelectorAll('.watch-card');
  
  if (allExpanded) {
    // Collapse all
    cards.forEach(card => card.classList.remove('expanded'));
    toggleExpandAllBtn.classList.remove('all-expanded');
    toggleExpandAllBtn.title = 'Expand All';
    allExpanded = false;
  } else {
    // Expand all
    cards.forEach(card => card.classList.add('expanded'));
    toggleExpandAllBtn.classList.add('all-expanded');
    toggleExpandAllBtn.title = 'Collapse All';
    allExpanded = true;
  }
});

watchFilterApply?.addEventListener('click', () => {
  console.log('🧠 Apply button clicked');
  
  // Collect filter values
  const filters = {
    genres: [],
    languages: [],
    countries: [],
    contentRatings: [],
    yearMin: parseInt(document.getElementById('watch-year-min')?.value) || null,
    yearMax: parseInt(document.getElementById('watch-year-max')?.value) || null,
    tmdbRating: parseFloat(document.getElementById('watch-tmdb-rating')?.value) || 0,
    voteCount: parseInt(document.getElementById('watch-vote-count')?.value) || 0,
    runtimeMin: parseInt(document.getElementById('watch-runtime-min')?.value) || null,
    runtimeMax: parseInt(document.getElementById('watch-runtime-max')?.value) || null,
    showPlexOnly: filterState.showPlexOnly,
  };
  
  // Collect checked genres
  document.querySelectorAll('#watch-genre-list input[type="checkbox"]:checked').forEach(cb => {
    filters.genres.push(cb.value);
  });
  
  // Collect checked languages
  document.querySelectorAll('#watch-language-list input[type="checkbox"]:checked').forEach(cb => {
    filters.languages.push(cb.value);
  });
  
  // Collect checked countries
  document.querySelectorAll('#watch-country-list input[type="checkbox"]:checked').forEach(cb => {
    filters.countries.push(cb.value);
  });
  
  // Collect checked content ratings
  document.querySelectorAll('#watch-rating-list input[type="checkbox"]:checked').forEach(cb => {
    filters.contentRatings.push(cb.value);
  });
  
  console.log('🧩 Filters to apply:', filters);
  
  // Apply filters to watch list
  applyWatchListFilters(filters);
  
  closeWatchFilterModal();
});

// Function to apply filters to the watch list - MOVED OUTSIDE
function applyWatchListFilters(filters) {
  console.log('🧩 applyWatchListFilters called with:', filters);
  
  const likesList = document.querySelector('.likes-list');
  if (!likesList) {
    console.warn('⚠️ .likes-list not found!');
    return;
  }
  
  const cards = Array.from(likesList.querySelectorAll('.watch-card'));
  console.log(`🔍 Found ${cards.length} cards to filter`);
  
  let hiddenCount = 0;
  
  cards.forEach(card => {
    let shouldShow = true;
    
    // Get movie data from the card
    const yearText = card.querySelector('.watch-card-year')?.textContent;
    const year = yearText ? parseInt(yearText.match(/\d+/)?.[0]) : null;
    
    // Get TMDB rating
    const ratingEl = card.querySelector('.watch-card-ratings');
    let tmdbRating = 0;
    if (ratingEl) {
      const innerHTML = ratingEl.innerHTML;
      const tmdbMatch = innerHTML.match(/tmdb\.svg[^>]*>\s*([\d.]+)/i);
      tmdbRating = tmdbMatch ? parseFloat(tmdbMatch[1]) : 0;
    }
    
    // Get stored filter data from card dataset
    const cardGenres = card.dataset.genres ? JSON.parse(card.dataset.genres) : [];
    const cardLanguages = card.dataset.languages ? JSON.parse(card.dataset.languages) : [];
    const cardCountries = card.dataset.countries ? JSON.parse(card.dataset.countries) : [];
    const cardRating = card.dataset.contentRating || '';
    const cardRuntime = parseInt(card.dataset.runtime) || 0;
    const cardVoteCount = parseInt(card.dataset.voteCount) || 0;
    
    console.log(`Checking card: year=${year}, genres=${cardGenres}`);
    
    // Genre filter - if genres selected, card must have at least one matching genre
    if (filters.genres.length > 0) {
      const hasMatchingGenre = filters.genres.some(filterGenre => 
        cardGenres.includes(parseInt(filterGenre))
      );
      if (!hasMatchingGenre) {
        console.log(`  🧩 Failed genre check`);
        shouldShow = false;
      }
    }
    
    // Language filter
    if (filters.languages.length > 0) {
      const hasMatchingLanguage = filters.languages.some(lang => 
        cardLanguages.includes(lang)
      );
      if (!hasMatchingLanguage) {
        console.log(`  🧩 Failed language check`);
        shouldShow = false;
      }
    }
    
    // Country filter
    if (filters.countries.length > 0) {
      const hasMatchingCountry = filters.countries.some(country => 
        cardCountries.includes(country)
      );
      if (!hasMatchingCountry) {
        console.log(`  🧩 Failed country check`);
        shouldShow = false;
      }
    }
    
    // Content rating filter
    if (filters.contentRatings.length > 0) {
      if (!filters.contentRatings.includes(cardRating)) {
        console.log(`  🧩 Failed content rating check`);
        shouldShow = false;
      }
    }
    
    // Year filter
    if (filters.yearMin && year && year < filters.yearMin) {
      console.log(`  🧩 Failed yearMin: ${year} < ${filters.yearMin}`);
      shouldShow = false;
    }
    if (filters.yearMax && year && year > filters.yearMax) {
      console.log(`  🧩 Failed yearMax: ${year} > ${filters.yearMax}`);
      shouldShow = false;
    }
    
    // TMDB Rating filter
    if (filters.tmdbRating > 0 && tmdbRating < filters.tmdbRating) {
      console.log(`  🧩 Failed tmdbRating: ${tmdbRating} < ${filters.tmdbRating}`);
      shouldShow = false;
    }
    
    // Runtime filter
    if (filters.runtimeMin && cardRuntime && cardRuntime < filters.runtimeMin) {
      console.log(`  🧩 Failed runtimeMin`);
      shouldShow = false;
    }
    if (filters.runtimeMax && cardRuntime && cardRuntime > filters.runtimeMax) {
      console.log(`  🧩 Failed runtimeMax`);
      shouldShow = false;
    }
    
    // Vote count filter
    if (filters.voteCount > 0 && cardVoteCount < filters.voteCount) {
      console.log(`  🧩 Failed voteCount`);
      shouldShow = false;
    }
    
    // Show Plex Only filter - only show movies that are in Plex
    if (filters.showPlexOnly) {
      // Check if the card has the plex-status element (indicates movie is in Plex)
      const hasPlexStatus = card.querySelector('.plex-status') !== null;
      if (!hasPlexStatus) {
        console.log(`  🧩 Failed showPlexOnly check - not in Plex`);
        shouldShow = false;
      }
    }
    
    // Show/hide card
    if (shouldShow) {
      card.style.display = '';
      console.log('🧠 Showing card');
    } else {
      card.style.display = 'none';
      hiddenCount++;
      console.log('🧠 Hiding card');
    }
  });
  
  // Show notification
  const visibleCards = cards.length - hiddenCount;
  console.log(`✅ Showing ${visibleCards} of ${cards.length} movies after filtering`);
  
  // Optional: Show a user-facing notification
  if (hiddenCount > 0) {
    showNotification(`Filtered: showing ${visibleCards} of ${cards.length} movies`);
  }
}

// Dropdown Controls for Watch Filter Modal
const watchDropdowns = [
  { toggle: 'watch-genre-toggle', list: 'watch-genre-list' },
  { toggle: 'watch-language-toggle', list: 'watch-language-list' },
  { toggle: 'watch-country-toggle', list: 'watch-country-list' },
  { toggle: 'watch-rating-toggle', list: 'watch-rating-list' }
];

watchDropdowns.forEach(({ toggle, list }) => {
  const toggleBtn = document.getElementById(toggle);
  const listEl = document.getElementById(list);

  toggleBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    
    console.log('Dropdown clicked:', toggle);
    console.log('List element:', listEl);
    console.log('Has active class before toggle:', listEl?.classList.contains('active'));
    
    // Close other dropdowns
    watchDropdowns.forEach(({ toggle: otherToggle, list: otherList }) => {
      if (otherToggle !== toggle) {
        document.getElementById(otherToggle)?.classList.remove('open');
        document.getElementById(otherList)?.classList.remove('active');
      }
    });

    // Toggle current dropdown
    toggleBtn.classList.toggle('open');
    listEl?.classList.toggle('active');
    
    console.log('Has active class after toggle:', listEl?.classList.contains('active'));
  });
});

// Watch filter modal - Genre checkboxes
document.querySelectorAll('#watch-genre-list input[type="checkbox"]').forEach(cb => {
  cb.addEventListener('change', () => {
    const selectedGenres = Array.from(
      document.querySelectorAll('#watch-genre-list input[type="checkbox"]:checked')
    ).map(checkbox => parseInt(checkbox.value));
    updateWatchGenreButton(selectedGenres);
  });
});

// Watch filter modal - Language checkboxes
document.querySelectorAll('#watch-language-list input[type="checkbox"]').forEach(cb => {
  cb.addEventListener('change', () => {
    const selectedLanguages = Array.from(
      document.querySelectorAll('#watch-language-list input[type="checkbox"]:checked')
    ).map(checkbox => checkbox.value);
    updateWatchLanguageButton(selectedLanguages);
  });
});

// Watch filter modal - Country checkboxes
document.querySelectorAll('#watch-country-list input[type="checkbox"]').forEach(cb => {
  cb.addEventListener('change', () => {
    const selectedCountries = Array.from(
      document.querySelectorAll('#watch-country-list input[type="checkbox"]:checked')
    ).map(checkbox => checkbox.value);
    updateWatchCountryButton(selectedCountries);
  });
});

// Watch filter modal - Content Rating checkboxes
document.querySelectorAll('#watch-rating-list input[type="checkbox"]').forEach(cb => {
  cb.addEventListener('change', () => {
    const selectedRatings = Array.from(
      document.querySelectorAll('#watch-rating-list input[type="checkbox"]:checked')
    ).map(checkbox => checkbox.value);
    updateWatchContentRatingButton(selectedRatings);
  });
});

// Close dropdowns when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('.dropdown-button') && !e.target.closest('.dropdown-list')) {
    watchDropdowns.forEach(({ toggle, list }) => {
      document.getElementById(toggle)?.classList.remove('open');
      document.getElementById(list)?.classList.remove('active');
    });
  }
});

// Slider Updates
const watchTmdbRating = document.getElementById('watch-tmdb-rating');
const watchTmdbValue = document.getElementById('watch-tmdb-rating-value');
const watchVoteCount = document.getElementById('watch-vote-count');
const watchVoteValue = document.getElementById('watch-vote-count-value');

watchTmdbRating?.addEventListener('input', (e) => {
  if (watchTmdbValue) {
    watchTmdbValue.textContent = parseFloat(e.target.value).toFixed(1);
  }
});

watchVoteCount?.addEventListener('input', (e) => {
  if (watchVoteValue) {
    watchVoteValue.textContent = parseInt(e.target.value).toLocaleString();
  }
});

watchFilterReset?.addEventListener('click', () => {
  document.querySelectorAll('#watch-filter-modal input[type="checkbox"]').forEach(cb => cb.checked = false);
  const yearMin = document.getElementById('watch-year-min');
  const yearMax = document.getElementById('watch-year-max');
  const runtimeMin = document.getElementById('watch-runtime-min');
  const runtimeMax = document.getElementById('watch-runtime-max');
  
  if (yearMin) yearMin.value = '';
  if (yearMax) yearMax.value = '';
  if (runtimeMin) runtimeMin.value = '';
  if (runtimeMax) runtimeMax.value = '';
  if (watchTmdbRating) watchTmdbRating.value = 0;
  if (watchTmdbValue) watchTmdbValue.textContent = '0.0';
  if (watchVoteCount) watchVoteCount.value = 0;
  if (watchVoteValue) watchVoteValue.textContent = '0';
  
  // Reset dropdown button texts
  updateWatchGenreButton([]);
  updateWatchLanguageButton([]);
  updateWatchCountryButton([]);
  updateWatchContentRatingButton([]);
});

// ===== MATCH POPUP FUNCTIONS =====
function showMatchPopup(matchData) {
  const popup = document.getElementById('match-popup');
  const overlay = document.getElementById('match-popup-overlay');
  const usersSpan = document.getElementById('match-popup-users');
  const movieSpan = document.getElementById('match-popup-movie');
  
  if (!popup || !overlay) {
    console.error('Match popup elements not found in DOM');
    return;
  }
  
  // Format the users list
  const users = matchData.users || [];
  let usersText = '';
  if (users.length === 1) {
    usersText = users[0];
  } else if (users.length === 2) {
    usersText = `${users[0]} and ${users[1]}`;
  } else if (users.length > 2) {
    usersText = `${users.slice(0, -1).join(', ')}, and ${users[users.length - 1]}`;
  }
  
  // Update popup content
  usersSpan.textContent = usersText;
  movieSpan.textContent = matchData.movie?.title || 'this movie';
  
  // Show popup with animation
  overlay.classList.add('active');
  setTimeout(() => {
    popup.classList.add('active');
  }, 10);
}

function hideMatchPopup() {
  const popup = document.getElementById('match-popup');
  const overlay = document.getElementById('match-popup-overlay');
  
  if (!popup || !overlay) return;
  
  popup.classList.remove('active');
  setTimeout(() => {
    overlay.classList.remove('active');
  }, 300);
}

// Match popup button handlers
document.addEventListener('DOMContentLoaded', () => {
  const viewMatchesBtn = document.getElementById('match-view-btn');
  const keepSwipingBtn = document.getElementById('match-keep-swiping-btn');
  const overlay = document.getElementById('match-popup-overlay');
  
  if (viewMatchesBtn) {
    viewMatchesBtn.addEventListener('click', () => {
      hideMatchPopup();
      // Switch to matches tab
      const matchesTab = document.querySelector('[data-tab="tab-matches"]');
      if (matchesTab) {
        matchesTab.click();
      }
    });
  }
  
  if (keepSwipingBtn) {
    keepSwipingBtn.addEventListener('click', () => {
      hideMatchPopup();
    });
  }
  
  if (overlay) {
    overlay.addEventListener('click', () => {
      hideMatchPopup();
    });
  }
});

/* boot */
main().catch(err => console.error('❌Uncaught error in main():', err))
