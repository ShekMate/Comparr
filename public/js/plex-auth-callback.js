;(function () {
  try {
    const payload = {
      type: 'comparr-plex-auth-complete',
      origin: window.location.origin,
      href: window.location.href,
      ts: Date.now(),
    }

    if (window.opener && !window.opener.closed) {
      // Use wildcard target so slight host/proxy origin mismatches do not
      // silently break callback handoff. Parent validates payload shape.
      window.opener.postMessage(payload, '*')
    }
  } catch (err) {
    console.error('[plex-callback] postMessage failed', err)
  }

  // Small delay avoids message-vs-close race conditions in some browsers.
  setTimeout(() => {
    window.close()
  }, 150)
})()
