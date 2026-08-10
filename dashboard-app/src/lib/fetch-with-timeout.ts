const DEFAULT_FETCH_TIMEOUT_MS = 10_000

/**
 * Bound raw fetch calls so a stalled network cannot leave the UI loading forever.
 * The caller's AbortSignal remains authoritative when one is provided.
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController()
  const abortFromCaller = () => controller.abort()

  if (init.signal?.aborted) controller.abort()
  else init.signal?.addEventListener('abort', abortFromCaller, { once: true })

  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeoutId)
    init.signal?.removeEventListener('abort', abortFromCaller)
  }
}

export function isFetchAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}
