import { describe, expect, it } from 'vitest'
import {
  matchesAttributeFilter,
  parseAttributeFilter,
  type AttributeFilter,
} from './logAttributeFilters.js'

function parse(text: string): AttributeFilter {
  const filter = parseAttributeFilter(text)
  if (!filter) throw new Error(`expected "${text}" to parse`)
  return filter
}

describe(parseAttributeFilter, () => {
  it.each([
    ['http.route', 'exists', 'http.route', undefined],
    ['!http.route', 'notExists', 'http.route', undefined],
    ['a=b', 'equals', 'a', 'b'],
    ['a!=b', 'notEquals', 'a', 'b'],
    ['a~b', 'contains', 'a', 'b'],
    ['a!~b', 'notContains', 'a', 'b'],
    ['  a = b ', 'equals', 'a', ' b'],
    ['a=b=c', 'equals', 'a', 'b=c'],
    ['a=', 'equals', 'a', ''],
    ['url.full=/x?y~z', 'equals', 'url.full', '/x?y~z'],
  ])('parses %s', (text, op, key, value) => {
    const filter = parse(text)
    expect(filter).toMatchObject({ op, key })
    expect(filter.value).toBe(value)
  })

  it.each(['', '   ', '=b', '~b', '!=b', '!~b', '!a=b', '!a~b', '!'])(
    'rejects %j',
    (text) => {
      expect(parseAttributeFilter(text)).toBeNull()
    },
  )

  it('normalizes the raw text', () => {
    expect(parse('  a!~B ').raw).toBe('a!~B')
  })
})

describe(matchesAttributeFilter, () => {
  const attrs = {
    region: 'eu-west-1',
    'http.status_code': 200,
    retry: true,
    tags: ['a', 'b'],
    empty: '',
  }

  it('checks existence', () => {
    expect(matchesAttributeFilter(attrs, parse('region'))).toBe(true)
    expect(matchesAttributeFilter(attrs, parse('empty'))).toBe(true)
    expect(matchesAttributeFilter(attrs, parse('missing'))).toBe(false)
    expect(matchesAttributeFilter(attrs, parse('!missing'))).toBe(true)
    expect(matchesAttributeFilter(attrs, parse('!region'))).toBe(false)
    expect(matchesAttributeFilter({}, parse('region'))).toBe(false)
    expect(matchesAttributeFilter(undefined, parse('!region'))).toBe(true)
  })

  it('treats keys as case-sensitive', () => {
    expect(matchesAttributeFilter(attrs, parse('Region'))).toBe(false)
    expect(matchesAttributeFilter(attrs, parse('Region=eu-west-1'))).toBe(false)
    expect(matchesAttributeFilter(attrs, parse('!Region'))).toBe(true)
  })

  it('compares values exactly and case-sensitively with = and !=', () => {
    expect(matchesAttributeFilter(attrs, parse('region=eu-west-1'))).toBe(true)
    expect(matchesAttributeFilter(attrs, parse('region=EU-WEST-1'))).toBe(false)
    expect(matchesAttributeFilter(attrs, parse('region=eu'))).toBe(false)
    expect(matchesAttributeFilter(attrs, parse('region!=us'))).toBe(true)
    expect(matchesAttributeFilter(attrs, parse('region!=eu-west-1'))).toBe(
      false,
    )
    expect(matchesAttributeFilter(attrs, parse('missing!=x'))).toBe(true)
    expect(matchesAttributeFilter(attrs, parse('missing=x'))).toBe(false)
    expect(matchesAttributeFilter(attrs, parse('empty='))).toBe(true)
  })

  it('compares non-string values by their string form', () => {
    expect(matchesAttributeFilter(attrs, parse('http.status_code=200'))).toBe(
      true,
    )
    expect(matchesAttributeFilter(attrs, parse('retry=true'))).toBe(true)
    expect(matchesAttributeFilter(attrs, parse('tags=["a","b"]'))).toBe(true)
  })

  it('matches ~ and !~ case-insensitively', () => {
    expect(matchesAttributeFilter(attrs, parse('region~WEST'))).toBe(true)
    expect(matchesAttributeFilter(attrs, parse('region~south'))).toBe(false)
    expect(matchesAttributeFilter(attrs, parse('missing~x'))).toBe(false)
    expect(matchesAttributeFilter(attrs, parse('region!~WEST'))).toBe(false)
    expect(matchesAttributeFilter(attrs, parse('region!~south'))).toBe(true)
    expect(matchesAttributeFilter(attrs, parse('missing!~x'))).toBe(true)
  })
})
