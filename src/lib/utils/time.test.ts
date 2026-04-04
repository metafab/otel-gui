import { describe, it, expect } from 'vitest'
import {
  formatDuration,
  formatDurationFromMs,
  formatDurationFromNs,
  formatTimestamp,
  getDurationMs,
  formatRelativeTime,
} from '$lib/utils/time'

describe(formatDuration, () => {
  it('correctly subtracts nanosecond strings', () => {
    expect(formatDuration('0', '1000000000').simple).toBe('1s')
  })

  it('handles start > end (clock skew) by producing a negative duration', () => {
    expect(formatDuration('2000000000', '1000000000').simple).toBe('⚠ 1s')
  })

  it('handles equal nanosecond strings', () => {
    expect(formatDuration('1000000000', '1000000000')).toEqual({
      simple: '0',
      detailed: '0',
    })
  })
})

describe(formatDurationFromMs, () => {
  it('converts milliseconds to the correct duration', () => {
    expect(formatDurationFromMs(1000).simple).toBe('1s')
    expect(formatDurationFromMs(1.5).simple).toBe('1.5ms')
  })

  it('handles zero', () => {
    expect(formatDurationFromMs(0)).toEqual({ simple: '0', detailed: '0' })
  })
})

describe(formatDurationFromNs, () => {
  it('formats zero as "0" for both simple and detailed', () => {
    expect(formatDurationFromNs(0n)).toEqual({ simple: '0', detailed: '0' })
  })

  it('sub-microsecond range (< 1µs): simple and detailed are in nanoseconds', () => {
    expect(formatDurationFromNs(500n)).toEqual({
      simple: '500ns',
      detailed: '500ns',
    })
    expect(formatDurationFromNs(1n)).toEqual({
      simple: '1ns',
      detailed: '1ns',
    })
    expect(formatDurationFromNs(999n)).toEqual({
      simple: '999ns',
      detailed: '999ns',
    })
  })

  it('microsecond range (1µs – <1ms): simple is in microseconds; detailed is in nanoseconds', () => {
    expect(formatDurationFromNs(1_000n)).toEqual({
      simple: '1μs',
      detailed: '1,000ns',
    })
    expect(formatDurationFromNs(500_000n)).toEqual({
      simple: '500μs',
      detailed: '500,000ns',
    })
    expect(formatDurationFromNs(999_999n)).toEqual({
      simple: '999μs',
      detailed: '999,999ns',
    })
  })

  it('millisecond range (1ms – <1s): simple trims trailing zeros; detailed is in microseconds', () => {
    expect(formatDurationFromNs(1_000_000n)).toEqual({
      simple: '1ms',
      detailed: '1,000μs',
    })
    expect(formatDurationFromNs(1_500_000n)).toEqual({
      simple: '1.5ms',
      detailed: '1,500μs',
    })
    expect(formatDurationFromNs(12_300_000n)).toEqual({
      simple: '12.3ms',
      detailed: '12,300μs',
    })
    expect(formatDurationFromNs(50_000_000n)).toEqual({
      simple: '50ms',
      detailed: '50,000μs',
    })
  })

  it('second range (1s – <60s): simple trims trailing zeros; detailed is in milliseconds', () => {
    expect(formatDurationFromNs(1_000_000_000n)).toEqual({
      simple: '1s',
      detailed: '1,000ms',
    })
    expect(formatDurationFromNs(2_500_000_000n)).toEqual({
      simple: '2.5s',
      detailed: '2,500ms',
    })
    expect(formatDurationFromNs(1_550_000_000n)).toEqual({
      simple: '1.55s',
      detailed: '1,550ms',
    })
    expect(formatDurationFromNs(59_999_999_999n)).toEqual({
      simple: '60s',
      detailed: '60,000ms',
    })
  })

  it('minute range (≥ 60s): simple is compound Xm Ys; detailed is in seconds', () => {
    expect(formatDurationFromNs(60_000_000_000n)).toEqual({
      simple: '1m',
      detailed: '60s',
    })
    expect(formatDurationFromNs(90_000_000_000n)).toEqual({
      simple: '1m 30s',
      detailed: '90s',
    })
    expect(formatDurationFromNs(120_000_000_000n)).toEqual({
      simple: '2m',
      detailed: '120s',
    })
  })

  describe('negative durations (clock skew)', () => {
    it('negative seconds: ⚠ prefix, trailing zeros trimmed', () => {
      expect(formatDurationFromNs(-1_000_000_000n)).toEqual({
        simple: '⚠ 1s',
        detailed: '⚠ 1,000ms',
      })
    })

    it('negative sub-ms: ⚠ prefix, detailed is in nanoseconds', () => {
      expect(formatDurationFromNs(-500_000n)).toEqual({
        simple: '⚠ 500μs',
        detailed: '⚠ 500,000ns',
      })
    })
  })
})

describe(getDurationMs, () => {
  it('returns correct millisecond duration', () => {
    // 500 ms
    expect(getDurationMs('1000000000', '1500000000')).toBe(500)
  })

  it('returns 0 for equal timestamps', () => {
    expect(getDurationMs('1000000000', '1000000000')).toBe(0)
  })

  it('handles large nanosecond values without precision loss', () => {
    // 1s = 1000ms
    expect(getDurationMs('1700000000000000000', '1700000001000000000')).toBe(
      1000,
    )
  })
})

describe(formatTimestamp, () => {
  it('returns valid ISO string', () => {
    const result = formatTimestamp('1544712660000000000')
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })

  it('encodes epoch start correctly', () => {
    expect(formatTimestamp('0')).toBe('1970-01-01T00:00:00.000Z')
  })
})

describe(formatRelativeTime, () => {
  it('formats positive relative µs offset', () => {
    expect(formatRelativeTime('1000000000', '1000500000')).toBe('+500µs')
  })

  it('formats positive ms offset', () => {
    expect(formatRelativeTime('1000000000', '1050000000')).toBe('+50.0ms')
  })

  it('formats negative ms offset', () => {
    expect(formatRelativeTime('1050000000', '1000000000')).toBe('-50.0ms')
  })

  it('formats zero offset', () => {
    expect(formatRelativeTime('1000000000', '1000000000')).toBe('+0µs')
  })
})
