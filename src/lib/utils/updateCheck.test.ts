import { describe, it, expect, vi } from 'vitest'
import {
  parseVersion,
  isNewer,
  checkForUpdate,
  dismissUpdate,
  UPDATE_CHECK_KEY,
  UPDATE_CHECK_TTL,
  type UpdateCheckStorage,
} from '$lib/utils/updateCheck'

// ---------------------------------------------------------------------------
// parseVersion
// ---------------------------------------------------------------------------

describe(parseVersion, () => {
  it('parses a plain semver string', () => {
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3])
  })

  it('strips a leading "v"', () => {
    expect(parseVersion('v2.10.0')).toEqual([2, 10, 0])
  })

  it('handles a single component', () => {
    expect(parseVersion('5')).toEqual([5, 0, 0])
  })

  it('handles two components', () => {
    expect(parseVersion('3.1')).toEqual([3, 1, 0])
  })

  it('returns zeros for an empty string', () => {
    expect(parseVersion('')).toEqual([0, 0, 0])
  })
})

// ---------------------------------------------------------------------------
// isNewer
// ---------------------------------------------------------------------------

describe(isNewer, () => {
  it('returns true when major is greater', () => {
    expect(isNewer([2, 0, 0], [1, 9, 9])).toBe(true)
  })

  it('returns true when minor is greater (same major)', () => {
    expect(isNewer([1, 3, 0], [1, 2, 9])).toBe(true)
  })

  it('returns true when patch is greater (same major.minor)', () => {
    expect(isNewer([1, 2, 4], [1, 2, 3])).toBe(true)
  })

  it('returns false when versions are equal', () => {
    expect(isNewer([1, 2, 3], [1, 2, 3])).toBe(false)
  })

  it('returns false when a is older (major)', () => {
    expect(isNewer([0, 9, 9], [1, 0, 0])).toBe(false)
  })

  it('returns false when a is older (minor)', () => {
    expect(isNewer([1, 1, 5], [1, 2, 0])).toBe(false)
  })

  it('returns false when a is older (patch)', () => {
    expect(isNewer([1, 2, 2], [1, 2, 3])).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStorage(initial: Record<string, string> = {}): UpdateCheckStorage & {
  data: Record<string, string>
} {
  const data: Record<string, string> = { ...initial }
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v
    },
  }
}

function makeFetch(tag: string, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    json: () => Promise.resolve(ok ? { tag_name: tag } : null),
  } as unknown as Response)
}

const NOW = 1_000_000_000_000 // fixed "now" timestamp (ms)

// ---------------------------------------------------------------------------
// checkForUpdate
// ---------------------------------------------------------------------------

describe(checkForUpdate, () => {
  describe('with a fresh cache', () => {
    it('returns tag when newer and not dismissed', async () => {
      const storage = makeStorage({
        [UPDATE_CHECK_KEY]: JSON.stringify({ ts: NOW - 60_000, tag: '2.0.0' }),
      })
      const result = await checkForUpdate('1.0.0', {
        storage,
        now: () => NOW,
        fetchFn: vi.fn(),
      })
      expect(result).toBe('2.0.0')
    })

    it('returns null when cached tag equals current version', async () => {
      const storage = makeStorage({
        [UPDATE_CHECK_KEY]: JSON.stringify({ ts: NOW - 60_000, tag: '1.0.0' }),
      })
      const result = await checkForUpdate('1.0.0', {
        storage,
        now: () => NOW,
        fetchFn: vi.fn(),
      })
      expect(result).toBeNull()
    })

    it('returns null when cached tag is older than current version', async () => {
      const storage = makeStorage({
        [UPDATE_CHECK_KEY]: JSON.stringify({ ts: NOW - 60_000, tag: '0.9.0' }),
      })
      const result = await checkForUpdate('1.0.0', {
        storage,
        now: () => NOW,
        fetchFn: vi.fn(),
      })
      expect(result).toBeNull()
    })

    it('returns null when update is dismissed', async () => {
      const storage = makeStorage({
        [UPDATE_CHECK_KEY]: JSON.stringify({ ts: NOW - 60_000, tag: '2.0.0' }),
        'update-dismissed-v2.0.0': '1',
      })
      const result = await checkForUpdate('1.0.0', {
        storage,
        now: () => NOW,
        fetchFn: vi.fn(),
      })
      expect(result).toBeNull()
    })

    it('does not call fetch when cache is fresh', async () => {
      const storage = makeStorage({
        [UPDATE_CHECK_KEY]: JSON.stringify({ ts: NOW - 60_000, tag: '2.0.0' }),
      })
      const fetchFn = vi.fn()
      await checkForUpdate('1.0.0', { storage, now: () => NOW, fetchFn })
      expect(fetchFn).not.toHaveBeenCalled()
    })
  })

  describe('with a stale or absent cache', () => {
    it('fetches from GitHub and returns tag when newer', async () => {
      const storage = makeStorage()
      const fetchFn = makeFetch('v3.1.0')
      const result = await checkForUpdate('1.0.0', {
        storage,
        now: () => NOW,
        fetchFn,
      })
      expect(result).toBe('3.1.0')
    })

    it('stores the fetched tag in the cache', async () => {
      const storage = makeStorage()
      await checkForUpdate('1.0.0', {
        storage,
        now: () => NOW,
        fetchFn: makeFetch('v2.0.0'),
      })
      const cached = JSON.parse(storage.data[UPDATE_CHECK_KEY])
      expect(cached).toEqual({ ts: NOW, tag: '2.0.0' })
    })

    it('returns null when fetched tag is not newer', async () => {
      const storage = makeStorage()
      const result = await checkForUpdate('3.0.0', {
        storage,
        now: () => NOW,
        fetchFn: makeFetch('v2.0.0'),
      })
      expect(result).toBeNull()
    })

    it('returns null when fetched tag is dismissed', async () => {
      const storage = makeStorage({ 'update-dismissed-v2.0.0': '1' })
      const result = await checkForUpdate('1.0.0', {
        storage,
        now: () => NOW,
        fetchFn: makeFetch('v2.0.0'),
      })
      expect(result).toBeNull()
    })

    it('returns null when the HTTP response is not ok', async () => {
      const storage = makeStorage()
      const result = await checkForUpdate('1.0.0', {
        storage,
        now: () => NOW,
        fetchFn: makeFetch('v2.0.0', false),
      })
      expect(result).toBeNull()
    })

    it('returns null when tag_name is missing from the response', async () => {
      const storage = makeStorage()
      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ message: 'Not Found' }),
      } as unknown as Response)
      const result = await checkForUpdate('1.0.0', {
        storage,
        now: () => NOW,
        fetchFn,
      })
      expect(result).toBeNull()
    })

    it('returns null when fetch throws (network error)', async () => {
      const storage = makeStorage()
      const fetchFn = vi.fn().mockRejectedValue(new Error('network failure'))
      const result = await checkForUpdate('1.0.0', {
        storage,
        now: () => NOW,
        fetchFn,
      })
      expect(result).toBeNull()
    })

    it('falls through to fetch when cache is malformed JSON', async () => {
      const storage = makeStorage({ [UPDATE_CHECK_KEY]: 'not-json{{{' })
      const fetchFn = makeFetch('v2.0.0')
      const result = await checkForUpdate('1.0.0', {
        storage,
        now: () => NOW,
        fetchFn,
      })
      expect(result).toBe('2.0.0')
      expect(fetchFn).toHaveBeenCalledOnce()
    })

    it('fetches when cache is exactly TTL ms old (expired)', async () => {
      const storage = makeStorage({
        [UPDATE_CHECK_KEY]: JSON.stringify({
          ts: NOW - UPDATE_CHECK_TTL,
          tag: '2.0.0',
        }),
      })
      const fetchFn = makeFetch('v3.0.0')
      const result = await checkForUpdate('1.0.0', {
        storage,
        now: () => NOW,
        fetchFn,
      })
      expect(fetchFn).toHaveBeenCalledOnce()
      expect(result).toBe('3.0.0')
    })
  })
})

// ---------------------------------------------------------------------------
// dismissUpdate
// ---------------------------------------------------------------------------

describe(dismissUpdate, () => {
  it('sets the dismissed key in storage', () => {
    const storage = makeStorage()
    dismissUpdate('2.0.0', storage)
    expect(storage.data['update-dismissed-v2.0.0']).toBe('1')
  })

  it('does not affect other keys', () => {
    const storage = makeStorage({ 'update-dismissed-v1.0.0': '1' })
    dismissUpdate('2.0.0', storage)
    expect(storage.data['update-dismissed-v1.0.0']).toBe('1')
    expect(storage.data['update-dismissed-v2.0.0']).toBe('1')
  })
})
