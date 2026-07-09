import { describe, it, expect } from 'vitest'
import { normalizeQuery, valueContains, matchAttributes } from './search.js'

describe(normalizeQuery, () => {
  it('trims and lowercases', () => {
    expect(normalizeQuery('  Timeout ')).toBe('timeout')
  })
})

describe(valueContains, () => {
  it('matches strings case-insensitively', () => {
    expect(valueContains('Connection Timeout', 'timeout')).toBe(true)
    expect(valueContains('all good', 'timeout')).toBe(false)
  })

  it('matches numbers and booleans by their string form', () => {
    expect(valueContains(504, '504')).toBe(true)
    expect(valueContains(true, 'true')).toBe(true)
  })

  it('recurses into arrays', () => {
    expect(valueContains(['ok', 'retrying', 'failed'], 'retry')).toBe(true)
    expect(valueContains(['ok'], 'retry')).toBe(false)
  })

  it('recurses into nested records', () => {
    expect(valueContains({ inner: { code: 'ETIMEDOUT' } }, 'etimedout')).toBe(
      true,
    )
  })

  it('never matches null/undefined', () => {
    expect(valueContains(null, 'x')).toBe(false)
    expect(valueContains(undefined, 'x')).toBe(false)
  })
})

describe(matchAttributes, () => {
  it('matches on attribute values and reports the key breadcrumb', () => {
    expect(
      matchAttributes({ 'http.method': 'GET', 'http.status': 500 }, '500'),
    ).toEqual(['attribute:http.status'])
  })

  it('matches on the attribute key name alone', () => {
    expect(matchAttributes({ 'http.route': '/users' }, 'route')).toEqual([
      'attribute:http.route',
    ])
  })

  it('returns every matching key', () => {
    const hits = matchAttributes(
      { 'db.system': 'postgres', 'db.name': 'postgres_main' },
      'postgres',
    )
    expect(hits.sort()).toEqual(['attribute:db.name', 'attribute:db.system'])
  })

  it('returns empty array for no match or missing bag', () => {
    expect(matchAttributes({ a: 'b' }, 'zzz')).toEqual([])
    expect(matchAttributes(undefined, 'x')).toEqual([])
  })
})
