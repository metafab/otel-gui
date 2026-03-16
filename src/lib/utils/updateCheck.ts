export const UPDATE_CHECK_KEY = 'update-check-cache'
export const UPDATE_CHECK_TTL = 60 * 60 * 1000 // 1 hour

export type SemVer = [number, number, number]

export interface UpdateCheckStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface UpdateCheckOptions {
  fetchFn?: (url: string, init?: RequestInit) => Promise<Response>
  storage?: UpdateCheckStorage
  now?: () => number
  cacheKey?: string
  cacheTtl?: number
}

/**
 * Parses a semver string (with optional leading "v") into a [major, minor, patch] tuple.
 */
export function parseVersion(v: string): SemVer {
  const parts = v.replace(/^v/, '').split('.').map(Number)
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0]
}

/**
 * Returns true if version `a` is strictly newer than version `b`.
 */
export function isNewer(a: SemVer, b: SemVer): boolean {
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true
    if (a[i] < b[i]) return false
  }
  return false
}

/**
 * Checks GitHub for a newer release of otel-gui.
 *
 * Returns the latest version tag string if a newer, non-dismissed version is
 * available; returns null if the current version is up-to-date, dismissed, or
 * if the check fails.
 *
 * Uses a localStorage-backed cache (TTL: 1 hour) to avoid hitting the GitHub
 * rate limit on every page load.
 */
export async function checkForUpdate(
  currentVersion: string,
  options: UpdateCheckOptions = {},
): Promise<string | null> {
  const {
    fetchFn = fetch,
    storage = localStorage,
    now = Date.now,
    cacheKey = UPDATE_CHECK_KEY,
    cacheTtl = UPDATE_CHECK_TTL,
  } = options

  // Try the cache first
  try {
    const raw = storage.getItem(cacheKey)
    if (raw) {
      const { ts, tag } = JSON.parse(raw) as { ts: number; tag: string }
      if (now() - ts < cacheTtl) {
        const dismissed = storage.getItem(`update-dismissed-v${tag}`) === '1'
        if (!dismissed && isNewer(parseVersion(tag), parseVersion(currentVersion))) {
          return tag
        }
        return null
      }
    }
  } catch {
    /* malformed cache — fall through to fetch */
  }

  // Cache is stale or missing; fetch from GitHub
  try {
    const r = await fetchFn(
      'https://api.github.com/repos/metafab/otel-gui/releases/latest',
      { headers: { Accept: 'application/vnd.github+json' } },
    )
    if (!r.ok) return null
    const data = (await r.json()) as { tag_name?: string } | null
    if (!data?.tag_name) return null

    const tag = data.tag_name.replace(/^v/, '')
    storage.setItem(cacheKey, JSON.stringify({ ts: now(), tag }))

    const dismissed = storage.getItem(`update-dismissed-v${tag}`) === '1'
    if (!dismissed && isNewer(parseVersion(tag), parseVersion(currentVersion))) {
      return tag
    }
    return null
  } catch {
    return null
  }
}

/**
 * Persists the user's choice to dismiss the update notice for `version`.
 */
export function dismissUpdate(
  version: string,
  storage: UpdateCheckStorage = localStorage,
): void {
  storage.setItem(`update-dismissed-v${version}`, '1')
}
