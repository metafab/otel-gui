// Time formatting utilities for OTLP nanosecond timestamps

export function formatDuration(startNano: string, endNano: string): string {
  // Convert nanosecond strings to BigInt for precision
  let durationNs = BigInt(endNano) - BigInt(startNano)

  // Handle negative durations (clock skew, out-of-order timestamps)
  const isNegative = durationNs < 0n
  if (isNegative) {
    durationNs = -durationNs // Use absolute value
  }

  if (durationNs < 1_000_000n) {
    // Sub-millisecond: show microseconds
    const durationUs = Number(durationNs / 1_000n)
    return `${isNegative ? '⚠ ' : ''}${durationUs}µs`
  } else if (durationNs < 1_000_000_000n) {
    // Milliseconds with 1 decimal (preserve precision via remainder)
    const ms = Number(durationNs / 1_000_000n)
    const fractionalNs = Number(durationNs % 1_000_000n)
    const tenths = Math.floor(fractionalNs / 100_000)
    return `${isNegative ? '⚠ ' : ''}${ms}.${tenths}ms`
  } else if (durationNs < 60_000_000_000n) {
    // Seconds with 2 decimals
    const durationMs = Number(durationNs) / 1_000_000
    return `${isNegative ? '⚠ ' : ''}${(durationMs / 1000).toFixed(2)}s`
  } else {
    // Minutes with 1 decimal
    const durationMs = Number(durationNs) / 1_000_000
    return `${isNegative ? '⚠ ' : ''}${(durationMs / 60_000).toFixed(1)}m`
  }
}

/**
 * Converts nanoseconds to milliseconds for Date constructor
 */
export function formatTimestamp(nanoString: string): string {
  //
  const ms = Number(BigInt(nanoString) / 1_000_000n)
  return new Date(ms).toISOString()
}

/**
 * Returns a human-readable local time string
 */
export function formatTimestampLocal(nanoString: string): string {
  const ms = Number(BigInt(nanoString) / 1_000_000n)
  return new Date(ms).toLocaleString()
}

export function getDurationMs(startNano: string, endNano: string): number {
  const durationNs = BigInt(endNano) - BigInt(startNano)
  return Number(durationNs / 1_000_000n)
}

export function formatRelativeTime(
  baseNano: string,
  eventNano: string,
): string {
  const deltaNs = BigInt(eventNano) - BigInt(baseNano)
  const absDeltaNs = deltaNs < 0n ? -deltaNs : deltaNs
  const sign = deltaNs >= 0n ? '+' : '-'

  if (absDeltaNs < 1_000_000n) {
    const deltaUs = Number(absDeltaNs / 1_000n)
    return `${sign}${deltaUs}µs`
  } else {
    // Preserve precision via remainder
    const ms = Number(absDeltaNs / 1_000_000n)
    const fractionalNs = Number(absDeltaNs % 1_000_000n)
    const tenths = Math.floor(fractionalNs / 100_000)
    return `${sign}${ms}.${tenths}ms`
  }
}
