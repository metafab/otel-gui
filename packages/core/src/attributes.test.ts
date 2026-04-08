import { describe, it, expect } from 'vitest'
import { flattenAttributes, extractAnyValue } from './attributes.js'

describe(flattenAttributes, () => {
  it('returns empty object for undefined input', () => {
    expect(flattenAttributes(undefined)).toEqual({})
  })

  it('returns empty object for empty array', () => {
    expect(flattenAttributes([])).toEqual({})
  })

  it('returns empty object for non-array input', () => {
    expect(flattenAttributes(null as any)).toEqual({})
  })

  it('handles stringValue', () => {
    expect(
      flattenAttributes([{ key: 'http.method', value: { stringValue: 'GET' } }]),
    ).toEqual({ 'http.method': 'GET' })
  })

  it('handles boolValue', () => {
    expect(
      flattenAttributes([{ key: 'feature.enabled', value: { boolValue: true } }]),
    ).toEqual({ 'feature.enabled': true })
  })

  it('handles intValue (string-encoded int64)', () => {
    expect(
      flattenAttributes([{ key: 'http.status_code', value: { intValue: '200' } }]),
    ).toEqual({ 'http.status_code': 200 })
  })

  it('handles doubleValue', () => {
    expect(
      flattenAttributes([{ key: 'cpu.usage', value: { doubleValue: 0.75 } }]),
    ).toEqual({ 'cpu.usage': 0.75 })
  })

  it('handles arrayValue', () => {
    const result = flattenAttributes([
      {
        key: 'tags',
        value: {
          arrayValue: {
            values: [{ stringValue: 'foo' }, { stringValue: 'bar' }],
          },
        },
      },
    ])
    expect(result).toEqual({ tags: ['foo', 'bar'] })
  })

  it('handles empty arrayValue', () => {
    const result = flattenAttributes([{ key: 'tags', value: { arrayValue: {} } }])
    expect(result).toEqual({ tags: [] })
  })

  it('handles kvlistValue (nested key-value list)', () => {
    const result = flattenAttributes([
      {
        key: 'metadata',
        value: {
          kvlistValue: {
            values: [
              { key: 'user.id', value: { stringValue: '123' } },
              { key: 'tenant', value: { stringValue: 'acme' } },
            ],
          },
        },
      },
    ])
    expect(result).toEqual({ metadata: { 'user.id': '123', tenant: 'acme' } })
  })

  it('handles bytesValue', () => {
    const result = flattenAttributes([{ key: 'raw', value: { bytesValue: 'aGVsbG8=' } }])
    expect(result).toEqual({ raw: 'aGVsbG8=' })
  })

  it('skips entries missing key or value', () => {
    const result = flattenAttributes([
      { key: 'valid', value: { stringValue: 'yes' } },
      { value: { stringValue: 'no-key' } } as any,
      { key: 'no-value' } as any,
    ])
    expect(result).toEqual({ valid: 'yes' })
  })

  it('flattens multiple attributes into one object', () => {
    const result = flattenAttributes([
      { key: 'service.name', value: { stringValue: 'api' } },
      { key: 'service.version', value: { stringValue: '1.2.3' } },
      { key: 'pid', value: { intValue: '42' } },
    ])
    expect(result).toEqual({
      'service.name': 'api',
      'service.version': '1.2.3',
      pid: 42,
    })
  })
})

describe(extractAnyValue, () => {
  it('returns undefined for falsy input', () => {
    expect(extractAnyValue(null)).toBeUndefined()
    expect(extractAnyValue(undefined)).toBeUndefined()
  })

  it('returns undefined for unrecognised variant', () => {
    expect(extractAnyValue({ unknownField: 'x' })).toBeUndefined()
  })

  it('handles boolValue false (falsy but valid)', () => {
    expect(extractAnyValue({ boolValue: false })).toBe(false)
  })

  it('handles intValue 0', () => {
    expect(extractAnyValue({ intValue: '0' })).toBe(0)
  })
})
