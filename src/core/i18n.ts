import * as log from 'jsr:@std/log'
import {
  getLinkType,
  getPlexLibraryName,
  getRootPath,
  getVersion,
} from './config.ts'

const translations: Map<string, Record<string, string>> = new Map()

export const getTranslationPaths = async () => {
  const translationPaths: string[] = []
  for await (const entry of await Deno.readDir(Deno.cwd() + '/i18n')) {
    if (entry.isFile && entry.name.endsWith('.json')) {
      translationPaths.push(Deno.cwd() + '/i18n/' + entry.name)
    }
  }
  return translationPaths
}

const populateTranslations = async () => {
  const translationPaths = await getTranslationPaths()
  for (const translationPath of translationPaths) {
    const translation = await Deno.readTextFile(translationPath).then(text => {
      try {
        return JSON.parse(text)
      } catch {
        return null
      }
    })
    if (!translation || typeof translation.LANG !== 'string') continue
    translations.set(translation.LANG, translation)
  }
}

const interpolate = (text: string, context: Record<string, string>) => {
  let interpolatedText = text
  for (const [, match, name] of text.matchAll(/(\$\{([a-z0-9_]+)\})/gi)) {
    interpolatedText = interpolatedText.replace(match, context[name])
  }
  return interpolatedText
}

const getAcceptedLanguage = (
  headers: Headers,
  availableLanguages: string[]
): string => {
  const header = String(headers.get('accept-language') || '').trim()
  if (!header) return 'en'

  const ranked = header
    .split(',')
    .map(part => {
      const [rawTag, ...params] = part.trim().split(';')
      const qParam = params.find(param => param.trim().startsWith('q='))
      const q = qParam ? Number(qParam.trim().slice(2)) : 1
      return {
        tag: rawTag.toLowerCase(),
        q: Number.isFinite(q) ? q : 1,
      }
    })
    .sort((a, b) => b.q - a.q)

  const available = new Set(availableLanguages.map(lang => lang.toLowerCase()))

  for (const candidate of ranked) {
    if (available.has(candidate.tag)) {
      return availableLanguages.find(
        lang => lang.toLowerCase() === candidate.tag
      )!
    }

    const base = candidate.tag.split('-')[0]
    if (base && available.has(base)) {
      return availableLanguages.find(lang => lang.toLowerCase() === base)!
    }
  }

  return 'en'
}

export const getLinkTypeForRequest = (headers: Headers): 'app' | 'http' => {
  const ua = headers.get('user-agent')!

  // I tried the deep link on Android but it didn't work...
  if (/(iPhone|iPad)/.test(ua) && getLinkType() === 'app') {
    return 'app'
  }

  return 'http'
}

export const translateHTML = async (
  html: Uint8Array,
  headers: Headers
): Promise<string> => {
  if (translations.size === 0) {
    try {
      await populateTranslations()
    } catch (err) {
      log.error(`Encountered an error reading translation files: ${err}`)
    }
  }

  const language = getAcceptedLanguage(headers, [...translations.keys()])

  const translationContext: Record<string, string> = translations.has(language)
    ? translations.get(language)!
    : translations.get('en')!

  const decoder = new TextDecoder()
  const htmlText = decoder.decode(html)

  const context = {
    ...translationContext,
    ROOT_PATH: getRootPath(),
    VERSION: await getVersion(),
    CONFIG_MATCHES_TARGET_TYPE:
      getLinkTypeForRequest(headers) === 'app' ? '_self' : '_blank',
    PLEX_LIBRARY_NAME: getPlexLibraryName(),
  }

  const interpolatedHtml = interpolate(htmlText, context)

  return interpolatedHtml
}
