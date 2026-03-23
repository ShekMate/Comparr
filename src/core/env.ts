// core/env.ts - Pure environment variable accessors with no dependencies.
// Import from here (not config.ts) when you need getDataDir in files that
// config.ts itself depends on (e.g. settings.ts) to avoid circular imports.
export const getDataDir = () => Deno.env.get('DATA_DIR') ?? '/data'
