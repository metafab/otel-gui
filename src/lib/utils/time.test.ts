import { describe, it, expect } from 'vitest'
import {
  formatDuration,
  formatTimestamp,
  getDurationMs,
  formatRelativeTime,
} from '$lib/utils/time'

describe('formatDuration', () => {
  it('formats sub-millisecond in microseconds', () => {
    // 500 ns → 0µs (truncated), 1000 ns → 1µs
    expect(formatDuration('1000000000', '1000001000')).toBe('1µs')
  })

  it('formats 500µs', () => {
    expect(formatDuration('1000000000', '1000500000')).toBe('500µs')
  })

  it('formats milliseconds with one decimal', () => {
    // 12.3 ms = 12_300_000 ns
    expect(formatDuration('1000000000', '1012300000')).toBe('12.3ms')
  })

  it('formats whole milliseconds (zero tenths)', () => {
    expect(formatDuration('1000000000', '1050000000')).toBe('50.0ms')
  })

  it('formats a 1-second duration', () => {
    expect(formatDuration('1000000000', '2000000000')).toBe('1.00s')
  })

  it('formats sub-1-minute seconds with decimals', () => {
    // 2500 ms = 2.50s
    expect(formatDuration('0', '2500000000')).toBe('2.50s')
  })

  it('formats durations >= 60s in minutes', () => {
    // 90 seconds = 1.5 min
    expect(formatDuration('0', '90000000000')).toBe('1.5m')
  })

  it('handles negative durations (clock skew) with warning prefix', () => {
    const result = formatDuration('2000000000', '1000000000')
    expect(result).toMatch(/^⚠/)
    expect(result).toContain('1.00s')
  })

  it('handles zero duration', () => {
    expect(formatDuration('1000000000', '1000000000')).toBe('0µs')
  })
})

describe('getDurationMs', () => {
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

describe('formatTimestamp', () => {
  it('returns valid ISO string', () => {
    const result = formatTimestamp('1544712660000000000')
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })

  it('encodes epoch start correctly', () => {
    expect(formatTimestamp('0')).toBe('1970-01-01T00:00:00.000Z')
  })
})

describe('formatRelativeTime', () => {
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
