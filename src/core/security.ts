const encoder = new TextEncoder()

export const timingSafeEqual = (a: string, b: string): boolean => {
  const left = encoder.encode(String(a ?? ''))
  const right = encoder.encode(String(b ?? ''))

  const maxLength = Math.max(left.length, right.length)
  let mismatch = left.length ^ right.length

  for (let i = 0; i < maxLength; i++) {
    const l = i < left.length ? left[i] : 0
    const r = i < right.length ? right[i] : 0
    mismatch |= l ^ r
  }

  return mismatch === 0
}
