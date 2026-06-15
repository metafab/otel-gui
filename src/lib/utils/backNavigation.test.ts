import { describe, expect, it } from 'vitest'
import { shouldUseHistoryBack } from './backNavigation'

describe('shouldUseHistoryBack', () => {
  it('returns true for same-origin root referrers', () => {
    expect(
      shouldUseHistoryBack(
        'http://localhost/?search=checkout',
        'http://localhost',
        '/',
      ),
    ).toBe(true)
  })

  it('returns false for empty or invalid referrers', () => {
    expect(shouldUseHistoryBack('', 'http://localhost', '/')).toBe(false)
    expect(shouldUseHistoryBack('not a url', 'http://localhost', '/')).toBe(
      false,
    )
  })

  it('returns false for cross-origin or different-path referrers', () => {
    expect(
      shouldUseHistoryBack('https://example.com/', 'http://localhost', '/'),
    ).toBe(false)
    expect(
      shouldUseHistoryBack(
        'http://localhost/traces/123',
        'http://localhost',
        '/',
      ),
    ).toBe(false)
  })
})
