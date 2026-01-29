// src/core/rate-limiter.ts
// Token bucket rate limiter for API calls

/**
 * Token bucket rate limiter.
 * Allows burst capacity while enforcing a sustained rate limit.
 */
export class RateLimiter {
  private tokens: number
  private lastRefill: number
  private readonly maxTokens: number
  private readonly refillRate: number // tokens per second

  /**
   * @param maxTokens Maximum burst capacity
   * @param refillRate Tokens added per second (sustained rate)
   */
  constructor(maxTokens: number, refillRate: number) {
    this.maxTokens = maxTokens
    this.refillRate = refillRate
    this.tokens = maxTokens
    this.lastRefill = Date.now()
  }

  private refill() {
    const now = Date.now()
    const elapsed = (now - this.lastRefill) / 1000
    const newTokens = elapsed * this.refillRate
    this.tokens = Math.min(this.maxTokens, this.tokens + newTokens)
    this.lastRefill = now
  }

  /**
   * Wait until a token is available, then consume it.
   * Returns the wait time in ms (0 if no wait was needed).
   */
  async acquire(): Promise<number> {
    this.refill()

    if (this.tokens >= 1) {
      this.tokens -= 1
      return 0
    }

    // Calculate wait time for next token
    const deficit = 1 - this.tokens
    const waitMs = (deficit / this.refillRate) * 1000
    await new Promise(resolve => setTimeout(resolve, waitMs))

    this.refill()
    this.tokens -= 1
    return waitMs
  }

  /**
   * Check if a token is available without consuming it.
   */
  canAcquire(): boolean {
    this.refill()
    return this.tokens >= 1
  }

  /**
   * Get current token count (for debugging).
   */
  getTokens(): number {
    this.refill()
    return this.tokens
  }
}

// Shared rate limiters for external APIs
// TMDb: ~40 requests per 10 seconds = 4/sec sustained, allow burst of 10
export const tmdbRateLimiter = new RateLimiter(10, 3.5)

// OMDb: 1000 requests per day for free tier = ~0.7/min, but we'll be conservative
// Most users won't hit this, but we'll limit to ~1/sec to be safe
export const omdbRateLimiter = new RateLimiter(5, 1)
