// Deep, case-insensitive substring matching over arbitrary OTLP values.
//
// OTEL data is still maturing here, so "the thing I'm looking for" could live
// anywhere — a log body, a span name, a status message, or any attribute key or
// value (which flattenAttributes leaves as strings, numbers, booleans, arrays,
// or nested records). These primitives walk those shapes so callers (the store's
// search methods, and eventually a UI search box) don't each re-implement the
// traversal. Everything runs against the bounded in-memory corpus, so the only
// cost is CPU.

// Lower-case a query once at the call site; every helper here expects the needle
// to already be lower-cased so hot loops don't re-lower it per value.
export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase()
}

// True if `value` (a string/number/boolean, or an array/record of the same,
// arbitrarily nested) contains `needleLower` as a case-insensitive substring.
// null/undefined and non-stringifiable leaves never match.
export function valueContains(value: unknown, needleLower: string): boolean {
  if (value === null || value === undefined) return false

  const type = typeof value
  if (type === 'string') {
    return (value as string).toLowerCase().includes(needleLower)
  }
  if (type === 'number' || type === 'boolean' || type === 'bigint') {
    return String(value).toLowerCase().includes(needleLower)
  }
  if (Array.isArray(value)) {
    return value.some((entry) => valueContains(entry, needleLower))
  }
  if (type === 'object') {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      if (valueContains(nested, needleLower)) return true
    }
  }
  return false
}

// Scan a flattened attribute bag, matching both keys and values, and return the
// keys that hit as `attribute:<key>` breadcrumbs (empty array = no match). A hit
// on the key name alone counts — searching "http.route" should surface a span
// carrying that attribute even when the caller doesn't know its value.
export function matchAttributes(
  attributes: Record<string, unknown> | undefined,
  needleLower: string,
): string[] {
  if (!attributes) return []
  const hits: string[] = []
  for (const [key, value] of Object.entries(attributes)) {
    if (
      key.toLowerCase().includes(needleLower) ||
      valueContains(value, needleLower)
    ) {
      hits.push(`attribute:${key}`)
    }
  }
  return hits
}
