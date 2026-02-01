import { ServerRequest } from 'https://deno.land/std@0.79.0/http/server.ts'
import {
  extname,
  join,
  normalize,
} from 'https://deno.land/std@0.79.0/path/posix.ts'
import * as log from 'https://deno.land/std@0.79.0/log/mod.ts'
import { translateHTML } from '../../core/i18n.ts'

function normalizeURL(url: string): string {
  let normalizedUrl = url
  try {
    normalizedUrl = decodeURI(normalizedUrl)
  } catch (e) {
    if (!(e instanceof URIError)) {
      throw e
    }
  }
  normalizedUrl = normalize(normalizedUrl)
  const startOfParams = normalizedUrl.indexOf('?')
  return startOfParams > -1
    ? normalizedUrl.slice(0, startOfParams)
    : normalizedUrl
}

export const serveFile = async (req: ServerRequest, basePath = 'public') => {
  const publicRoot = join(Deno.cwd(), basePath.replace(/^\/+/, ''));
  const urlPath = normalizeURL(req.url).replace(/^\/+/, ''); // strip leading '/'
  // Use index.html for root path (handles both '/' and '/?query=params')
  const reqPathRaw = urlPath === '' ? 'index.html' : urlPath;

  const normalizedPath = join(publicRoot, reqPathRaw);

  log.debug(`serveFile(${normalizedPath})`);

  try {
    const stat = await Deno.stat(normalizedPath);
    if (!stat.isFile) {
      throw new Error(`Only file serving is enabled.`);
    }

    let body: Uint8Array | string = await Deno.readFile(normalizedPath);

    if (extname(normalizedPath) === '.html') {
      body = await translateHTML(body, req.headers);
    }

    return await req.respond({
      body,
      headers: new Headers({
        'content-type': getContentType(normalizedPath),
      }),
    });
  } catch (err) {
    // --- DEBUG for missing posters: show the final filesystem path that caused 404
    try {
      const urlPath = normalizeURL(req.url);
      if (urlPath.startsWith('/tmdb-poster/')) {
        log.warning(
          `[POSTER DEBUG] 404 while serving poster -> URL: ${urlPath} | FS: ${normalizedPath}`
        );
      }
    } catch {
      // ignore
    }

    return await req.respond({ status: 404, body: 'Not Found' });
  }
};


const getContentType = (path: string): string => {
  const MIME_MAP: Record<string, string> = {
    '.html': 'text/html',
    '.json': 'application/json',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.js': 'application/javascript',
  }

  return MIME_MAP[extname(path)] ?? 'text/plain'
}
