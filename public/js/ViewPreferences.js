// deno-lint-ignore-file
const STORAGE_KEY = 'comparrViewPrefs'

const TABLE_DEFAULTS = {
  year: true,
  genres: true,
  contentRating: true,
  runtime: true,
  imdb: true,
  tmdb: false,
  director: false,
  writers: false,
  language: false,
  releaseDate: false,
}

const POSTER_DEFAULTS = {
  showTitle: true,
  showYear: true,
  showContentRating: true,
  showGenres: false,
  showTmdb: false,
  showImdb: false,
  showRuntime: false,
  showAvailability: false,
  showRequest: false,
}

const MODE_DEFAULTS = {
  'tab-likes':           'poster',
  'tab-seen':            'table',
  'tab-dislikes':        'table',
  'tab-recommendations': 'poster',
  'tab-matches':         'poster',
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function save(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {}
}

export function getViewMode(sectionId) {
  const data = load()
  return data[sectionId]?.mode || MODE_DEFAULTS[sectionId] || 'overview'
}

export function setViewMode(sectionId, mode) {
  const data = load()
  if (!data[sectionId]) data[sectionId] = {}
  data[sectionId].mode = mode
  save(data)
}

export function getPosterSize(sectionId) {
  const data = load()
  return data[sectionId]?.posterSize || 'medium'
}

export function setPosterSize(sectionId, size) {
  const data = load()
  if (!data[sectionId]) data[sectionId] = {}
  data[sectionId].posterSize = size
  save(data)
}

export function getTableOptions(sectionId) {
  const data = load()
  return Object.assign({}, TABLE_DEFAULTS, data[sectionId]?.tableOptions || {})
}

export function setTableOption(sectionId, key, value) {
  const data = load()
  if (!data[sectionId]) data[sectionId] = {}
  if (!data[sectionId].tableOptions) data[sectionId].tableOptions = {}
  data[sectionId].tableOptions[key] = value
  save(data)
}

export function getPosterOptions(sectionId) {
  const data = load()
  return Object.assign({}, POSTER_DEFAULTS, data[sectionId]?.posterOptions || {})
}

export function setPosterOption(sectionId, key, value) {
  const data = load()
  if (!data[sectionId]) data[sectionId] = {}
  if (!data[sectionId].posterOptions) data[sectionId].posterOptions = {}
  data[sectionId].posterOptions[key] = value
  save(data)
}
