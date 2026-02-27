/**
 * Returns the p-th percentile value of an already-sorted numeric array.
 *
 * @param sorted - A sorted array of numbers (ascending).
 * @param p      - Percentile to compute (0–100).
 * @returns The p-th percentile value, or 0 if the array is empty.
 */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, idx)]
}

/**
 * Returns the p-th percentile of nanosecond durations converted to milliseconds.
 *
 * @param sortedNs - A sorted array of nanosecond values.
 * @param p        - Percentile to compute (0–100).
 */
export function percentileNsToMs(sortedNs: number[], p: number): number {
  return percentile(sortedNs, p) / 1_000_000
}
