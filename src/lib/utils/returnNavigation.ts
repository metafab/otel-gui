export interface ResolveReturnTargetOptions {
  fallback: string
  baseOrigin?: string
  expectedPathname: string
  invalidTabs: readonly string[]
  normalizeTab?: (tab: string | null, searchParams: URLSearchParams) => void
}

export function resolveReturnTarget(
  rawReturnTo: string | null | undefined,
  options: ResolveReturnTargetOptions,
): string {
  const raw = rawReturnTo?.trim()
  if (!raw) return options.fallback

  if (!raw.startsWith('/') || raw.startsWith('//')) {
    return options.fallback
  }

  try {
    const parsed = new URL(raw, options.baseOrigin ?? 'http://localhost')

    if (parsed.pathname !== options.expectedPathname) {
      return options.fallback
    }

    const tab = parsed.searchParams.get('tab')
    if (tab && options.invalidTabs.includes(tab)) {
      return options.fallback
    }

    options.normalizeTab?.(tab, parsed.searchParams)

    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return options.fallback
  }
}

export function shouldUseHistoryBackForTarget(
  referrer: string,
  currentOrigin: string,
  target: string,
): boolean {
  if (!referrer) return false

  try {
    const referrerUrl = new URL(referrer)
    const targetUrl = new URL(target, currentOrigin)

    return (
      referrerUrl.origin === currentOrigin &&
      referrerUrl.pathname === targetUrl.pathname &&
      referrerUrl.search === targetUrl.search &&
      referrerUrl.hash === targetUrl.hash
    )
  } catch {
    return false
  }
}
