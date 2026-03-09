;(() => {
  document.addEventListener('click', event => {
    const btn = event.target?.closest?.('.js-generate-room-code')
    if (!btn) return

    const roomInput = document.querySelector('input[name="roomCode"]')
    const generatedInput = document.querySelector('input[name="generatedRoomCode"]')
    if (!roomInput && !generatedInput) return

    const map = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789'
    let code = ''
    for (let i = 0; i < 6; i++) {
      const value = crypto.getRandomValues(new Uint32Array(1))[0]
      code += map[value % map.length]
    }

    if (generatedInput) generatedInput.value = code
    if (roomInput) roomInput.value = code
    try {
      localStorage.setItem('roomCode', code)
    } catch (_) {
      // ignore storage failures
    }
  })
})()
