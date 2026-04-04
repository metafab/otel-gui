// Time formatting utilities for OTLP nanosecond timestamps

export function formatDuration(
  startNano: string,
  endNano: string,
): {
  simple: string
  detailed: string
} {
  // Convert nanosecond strings to BigInt for precision
  const durationNs = BigInt(endNano) - BigInt(startNano)

  return formatDurationFromNs(durationNs)
}

export function formatDurationFromMs(durationMs: number): {
  simple: string
  detailed: string
} {
  const durationNs = BigInt(durationMs * 1_000_000)

  return formatDurationFromNs(durationNs)
}

/**
 *  Formats a duration given in nanoseconds into human-readable simple and detailed forms.
 *  - Simple: concise unit with up to 2 decimals (e.g. "1.5s", "500ms", "200µs"), or compound for minutes (e.g. "1m 30s")
 *  - Detailed: more precise unit (e.g. "1,500ms" instead of "1.5s"), always in a single unit for easier comparison
 *  Handles negative durations by prefixing with "⚠" to indicate potential clock skew or out-of-order timestamps.
 */
export function formatDurationFromNs(durationNs: bigint): {
  simple: string
  detailed: string
} {
  if (durationNs === 0n) {
    return { simple: '0', detailed: '0' }
  }

  // Handle negative durations (clock skew, out-of-order timestamps)
  const isNegative = durationNs < 0n
  if (isNegative) {
    durationNs = -durationNs // Use absolute value
  }

  let result: { simple: string; detailed: string }

  if (durationNs < 1_000n) {
    // Sub-microsecond: show nanoseconds
    result = {
      simple: Number(durationNs).toLocaleString(undefined, {
        unit: 'nanosecond',
        style: 'unit',
        unitDisplay: 'narrow',
      }),
      detailed: durationNs.toLocaleString(undefined, {
        unit: 'nanosecond',
        style: 'unit',
        unitDisplay: 'narrow',
      }),
    }
  } else if (durationNs < 1_000_000n) {
    // Microseconds (integer)
    result = {
      simple: Number(durationNs / 1_000n).toLocaleString(undefined, {
        unit: 'microsecond',
        style: 'unit',
        unitDisplay: 'narrow',
      }),
      detailed: durationNs.toLocaleString(undefined, {
        unit: 'nanosecond',
        style: 'unit',
        unitDisplay: 'narrow',
      }),
    }
  } else if (durationNs < 1_000_000_000n) {
    // Milliseconds: up to 2 decimals, trailing zeros trimmed
    const ms = Number(durationNs) / 1_000_000
    result = {
      simple: ms.toLocaleString(undefined, {
        style: 'unit',
        unit: 'millisecond',
        unitDisplay: 'narrow',
        maximumFractionDigits: 2,
        minimumFractionDigits: 0,
      }),
      detailed: Number(durationNs / 1_000n).toLocaleString(undefined, {
        unit: 'microsecond',
        style: 'unit',
        unitDisplay: 'narrow',
      }),
    }
  } else if (durationNs < 60_000_000_000n) {
    // Seconds: up to 2 decimals, trailing zeros trimmed
    const ms = Number(durationNs) / 1_000_000
    result = {
      simple: (ms / 1000).toLocaleString(undefined, {
        style: 'unit',
        unit: 'second',
        unitDisplay: 'narrow',
        maximumFractionDigits: 2,
        minimumFractionDigits: 0,
      }),
      detailed: ms.toLocaleString(undefined, {
        unit: 'millisecond',
        style: 'unit',
        unitDisplay: 'narrow',
      }),
    }
  } else {
    // Minutes: compound Xm Ys
    const totalSeconds = Math.floor(Number(durationNs) / 1_000_000_000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    let simple = minutes.toLocaleString(undefined, {
      unit: 'minute',
      style: 'unit',
      unitDisplay: 'narrow',
    })
    if (seconds > 0) {
      simple += ` ${seconds.toLocaleString(undefined, {
        unit: 'second',
        style: 'unit',
        unitDisplay: 'narrow',
      })}`
    }
    result = {
      simple,
      detailed: totalSeconds.toLocaleString(undefined, {
        unit: 'second',
        style: 'unit',
        unitDisplay: 'narrow',
      }),
    }
  }

  if (isNegative) {
    result.simple = `⚠ ${result.simple}`
    result.detailed = `⚠ ${result.detailed}`
  }

  return result
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
