import { describe, expect, it } from 'vitest'

import {
  resolveReturnTarget,
  shouldUseHistoryBackForTarget,
} from './returnNavigation'

describe(resolveReturnTarget, () => {
  it('returns fallback when returnTo is missing or invalid', () => {
    const options = {
      fallback: '/',
      baseOrigin: 'http://localhost',
      expectedPathname: '/',
      invalidTabs: ['logs', 'map'],
    } as const

    expect(resolveReturnTarget(undefined, options)).toBe('/')
    expect(resolveReturnTarget('   ', options)).toBe('/')
    expect(resolveReturnTarget('https://evil.test', options)).toBe('/')
    expect(resolveReturnTarget('//evil.test', options)).toBe('/')
    expect(resolveReturnTarget('/traces/foo', options)).toBe('/')
  })

  it('applies tab normalization callback before returning', () => {
    const result = resolveReturnTarget('/?tab=traces&search=checkout', {
      fallback: '/',
      baseOrigin: 'http://localhost',
      expectedPathname: '/',
      invalidTabs: ['logs', 'map'],
      normalizeTab: (tab, searchParams) => {
        if (tab === 'traces') {
          searchParams.delete('tab')
        }
      },
    })

    expect(result).toBe('/?search=checkout')
  })

  it('returns fallback when tab is explicitly disallowed', () => {
    const result = resolveReturnTarget('/?tab=map&search=checkout', {
      fallback: '/',
      baseOrigin: 'http://localhost',
      expectedPathname: '/',
      invalidTabs: ['logs', 'map'],
    })

    expect(result).toBe('/')
  })
})

describe(shouldUseHistoryBackForTarget, () => {
  it('returns true only when referrer exactly matches target URL parts', () => {
    expect(
      shouldUseHistoryBackForTarget(
        'http://localhost/?search=checkout',
        'http://localhost',
        '/?search=checkout',
      ),
    ).toBe(true)

    expect(
      shouldUseHistoryBackForTarget(
        'http://localhost/?search=checkout',
        'http://localhost',
        '/?search=payments',
      ),
    ).toBe(false)

    expect(
      shouldUseHistoryBackForTarget(
        'https://example.com/?search=checkout',
        'http://localhost',
        '/?search=checkout',
      ),
    ).toBe(false)
  })
})
