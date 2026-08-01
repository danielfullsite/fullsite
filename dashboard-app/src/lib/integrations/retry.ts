// Exponential backoff with full jitter — used for all outbound provider API calls.

export interface RetryOptions {
  maxAttempts?: number
  baseDelayMs?: number
  maxDelayMs?: number
  /** Return true if the error/response is worth retrying. Default: always retry. */
  isRetryable?: (err: unknown) => boolean
}

export class RetryExhaustedError extends Error {
  constructor(
    public readonly attempts: number,
    public readonly lastError: unknown
  ) {
    super(`Retry exhausted after ${attempts} attempts: ${String(lastError)}`)
    this.name = 'RetryExhaustedError'
  }
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 500,
    maxDelayMs = 10_000,
    isRetryable = () => true,
  } = opts

  let lastError: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt)
    } catch (e) {
      lastError = e
      if (attempt === maxAttempts || !isRetryable(e)) {
        throw new RetryExhaustedError(attempt, e)
      }
      const exp = baseDelayMs * 2 ** (attempt - 1)
      const capped = Math.min(exp, maxDelayMs)
      const jitter = Math.random() * capped * 0.25
      await new Promise<void>(r => setTimeout(r, capped + jitter))
    }
  }
  throw new RetryExhaustedError(maxAttempts, lastError)
}

/** Returns true for transient HTTP errors worth retrying (5xx, timeout). */
export function isTransientHttpError(statusCode: number): boolean {
  return statusCode === 429 || (statusCode >= 500 && statusCode < 600)
}
