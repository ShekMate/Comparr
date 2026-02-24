// src/infra/constants/streamingProvidersMapping.ts

/**
 * Streaming provider parent-child mapping
 * Maps child variant names → parent provider names
 *
 * Based on tmdb_provider_parent_child_corrected.csv
 */
const PROVIDER_MAPPINGS: Record<string, string> = {
  // Amazon Prime Video variants
  'Amazon Prime Video': 'Amazon Prime',
  'Amazon Video': 'Amazon Prime',
  'Amazon Prime Video with Ads': 'Amazon Prime',
  'Amazon Prime Video Free with Ads': 'Amazon Prime',

  // Apple TV / Apple TV+ variants
  'Apple TV+': 'Apple TV / Apple TV+',
  'Apple TV Plus Amazon Channel': 'Apple TV / Apple TV+',

  // HBO Max / Max variants
  'HBO Max': 'Max',
  'HBO Max Amazon Channel': 'Max',
  'HBO Max  Amazon Channel': 'Max',
  'HBO Max  CNN Amazon Channel': 'Max',

  // Paramount+ variants
  'Paramount Plus': 'Paramount+',
  'Paramount+ with Showtime': 'Paramount+',
  'Paramount+ Amazon Channel': 'Paramount+',
  'Paramount Plus Apple TV Channel': 'Paramount+',
  'Paramount+ Roku Premium Channel': 'Paramount+',
  'Paramount+ Originals Amazon Channel': 'Paramount+',
  'Paramount+ MTV Amazon Channel': 'Paramount+',

  // Starz variants
  'Starz Amazon Channel': 'Starz',
  'Starz Apple TV Channel': 'Starz',
  'Starz Roku Premium Channel': 'Starz',

  // AMC+ variants
  'AMC+ Amazon Channel': 'AMC+',
  'AMC+ Roku Premium Channel': 'AMC+',
  'AMC Plus Apple TV Channel': 'AMC+',
  'AMC Plus Apple TV Channel ': 'AMC+',
  'AMC Plus Apple TV Channel  ': 'AMC+',

  // BritBox variants
  'BritBox Amazon Channel': 'BritBox',
  'Britbox Apple TV Channel': 'BritBox',

  // Acorn TV variants
  'AcornTV Amazon Channel': 'Acorn TV',
  'Acorn TV Apple TV': 'Acorn TV',

  // Hallmark variants
  'Hallmark TV Amazon Channel': 'Hallmark',
  'Hallmark+ Amazon Channel': 'Hallmark',
  'Hallmark+ Apple TV Channel': 'Hallmark',

  // Lifetime Movie Club variants
  'Lifetime Movie Club Amazon Channel': 'Lifetime Movie Club',
  'Lifetime Movie Club Apple TV Channel': 'Lifetime Movie Club',

  // Shudder variants
  'Shudder Amazon Channel': 'Shudder',
  'Shudder Apple TV Channel': 'Shudder',

  // HISTORY Vault variants
  'HISTORY Vault Amazon Channel': 'HISTORY Vault',
  'HISTORY Vault Apple TV Channel': 'HISTORY Vault',

  // UP Faith & Family variants
  'UP Faith & Family Amazon Channel': 'UP Faith & Family',
  'UP Faith & Family Apple TV Channel': 'UP Faith & Family',

  // Tastemade variants
  'Tastemade Amazon Channel': 'Tastemade',
  'Tastemade Apple TV Channel': 'Tastemade',

  // CuriosityStream variants
  'Curiosity Stream': 'CuriosityStream',
  'CuriosityStream Apple TV Channel': 'CuriosityStream',

  // Cinemax variants
  'Cinemax Amazon Channel': 'Cinemax',
  'Cinemax Apple TV Channel': 'Cinemax',

  // PBS variants
  'PBS Kids Amazon Channel': 'PBS',
  'PBS Masterpiece Amazon Channel': 'PBS',
  'PBS Documentaries Amazon Channel': 'PBS',
  'PBS Living Amazon Channel': 'PBS',

  // Netflix variants
  'Netflix Kids': 'Netflix',
  'Netflix Standard with Ads': 'Netflix',

  // Discovery+ variants
  'Discovery+ Amazon Channel': 'Discovery+',
  'Discovery +': 'Discovery+',

  // Peacock variants
  'Peacock Premium': 'Peacock',
  'Peacock Premium Plus': 'Peacock',

  // MGM+ variants
  'MGM Plus': 'MGM+',
  'MGM+ Amazon Channel': 'MGM+',
  'MGM Plus Roku Premium Channel': 'MGM+',

  // Revry variants
  'Revry Amazon Channel': 'Revry',

  // Hi-YAH variants
  'Hi-YAH Amazon Channel': 'Hi-YAH',

  // Film Movement Plus variants
  'Film Movement Plus Amazon Channel': 'Film Movement Plus',

  // BroadwayHD variants
  'Broadway HD Amazon Channel': 'BroadwayHD',

  // ALLBLK variants
  'ALLBLK Amazon Channel': 'ALLBLK',
  'ALLBLK Apple TV Channel': 'ALLBLK',

  // BET+ variants
  'BET+  Apple TV channel': 'BET+',
  'BET+ Apple TV Channel': 'BET+',

  // Carnegie Hall+ variants
  'Carnegie Hall+ Amazon Channel': 'Carnegie Hall+',
  'Carnegie Hall+ Apple TV Channel': 'Carnegie Hall+',

  // A&E variants
  'A&E Crime Central Apple TV Channel': 'A&E',

  // Crunchyroll variants
  'Crunchyroll Amazon Channel': 'Crunchyroll',

  // Shout! Factory variants
  'Shout! Factory Amazon Channel': 'Shout! Factory',
  'Shout! Factory TV': 'Shout! Factory',

  // Plex variants
  'Plex Channel': 'Plex',

  // Other common normalizations
  'Disney Plus': 'Disney+',
  'The Roku Channel': 'Roku Channel',
  'Amazon Freevee': 'Freevee',
  'Tubi TV': 'Tubi',
  'MovieSphere+ Amazon Channel': 'MovieSphere+',
}

/**
 * Normalize a streaming provider name to its parent brand
 */
export function normalizeProviderName(name: string): string {
  return PROVIDER_MAPPINGS[name] || name
}

/**
 * Get all unique parent provider names
 */
export function getParentProviders(): string[] {
  const parents = new Set<string>(Object.values(PROVIDER_MAPPINGS))
  return Array.from(parents).sort()
}

/**
 * Get all child variants for a parent provider
 */
export function getChildVariants(parentName: string): string[] {
  return Object.entries(PROVIDER_MAPPINGS)
    .filter(([_, parent]) => parent === parentName)
    .map(([child, _]) => child)
}

/**
 * Check if a provider name is a parent or child variant
 */
export function isKnownProvider(name: string): boolean {
  return (
    name in PROVIDER_MAPPINGS || Object.values(PROVIDER_MAPPINGS).includes(name)
  )
}
