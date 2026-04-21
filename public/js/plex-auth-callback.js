;(function () {
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(
        { type: 'comparr-plex-auth-complete' },
        window.location.origin
      )
    }
  } catch {
    // ignore opener messaging errors
  }
  window.close()
})()
