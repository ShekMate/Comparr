export class IpRateLimiter {
  private attempts = new Map<string, { count: number; windowStart: number }>()

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
    private readonly maxTrackedIps = 10_000
  ) {}

  check(ip: string): boolean {
    const key = String(ip || 'unknown')
    const now = Date.now()

    for (const [trackedIp, data] of this.attempts.entries()) {
      if (now - data.windowStart > this.windowMs) {
        this.attempts.delete(trackedIp)
      }
    }

    while (this.attempts.size > this.maxTrackedIps) {
      const oldestKey = this.attempts.keys().next().value
      if (!oldestKey) break
      this.attempts.delete(oldestKey)
    }

    const current = this.attempts.get(key)
    if (!current || now - current.windowStart > this.windowMs) {
      this.attempts.set(key, { count: 1, windowStart: now })
      return true
    }

    if (current.count >= this.maxRequests) {
      return false
    }

    current.count += 1
    this.attempts.set(key, current)
    return true
  }
}

export const loginRateLimiter = new IpRateLimiter(10, 60_000)
export const apiRateLimiter = new IpRateLimiter(20, 60_000)
