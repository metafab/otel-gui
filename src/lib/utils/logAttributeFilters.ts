export type AttributeFilterOp =
  'exists' | 'notExists' | 'equals' | 'notEquals' | 'contains' | 'notContains'

export interface AttributeFilter {
  /** Normalized text form, e.g. `key=value`; used as the chip label and URL value. */
  raw: string
  key: string
  op: AttributeFilterOp
  value?: string
}

const OPERATORS: Record<string, AttributeFilterOp> = {
  '=': 'equals',
  '!=': 'notEquals',
  '~': 'contains',
  '!~': 'notContains',
}

/** String form used both to display and to compare attribute values. */
export function formatAttributeValue(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

/**
 * Parses `key`, `!key`, `key=value`, `key!=value`, `key~value` or `key!~value`.
 * Returns null when the text is empty or has no key.
 */
export function parseAttributeFilter(text: string): AttributeFilter | null {
  const input = text.trim()
  if (!input) return null

  if (input.startsWith('!')) {
    const key = input.slice(1).trim()
    if (!key || /[=~]/.test(key)) return null
    return { raw: `!${key}`, key, op: 'notExists' }
  }

  for (let i = 0; i < input.length; i++) {
    const char = input[i]
    const twoChars = input.slice(i, i + 2)
    const symbol =
      twoChars === '!=' || twoChars === '!~'
        ? twoChars
        : char === '=' || char === '~'
          ? char
          : null
    if (!symbol) continue

    const key = input.slice(0, i).trim()
    if (!key) return null
    const value = input.slice(i + symbol.length)
    return { raw: `${key}${symbol}${value}`, key, op: OPERATORS[symbol], value }
  }

  return { raw: input, key: input, op: 'exists' }
}

// Keys are always compared case-sensitively; only `~` / `!~` values ignore case.
export function matchesAttributeFilter(
  attributes: Record<string, unknown> | null | undefined,
  filter: AttributeFilter,
): boolean {
  const present =
    attributes != null &&
    Object.prototype.hasOwnProperty.call(attributes, filter.key)
  if (filter.op === 'exists') return present
  if (filter.op === 'notExists') return !present

  const actual = present ? formatAttributeValue(attributes![filter.key]) : null
  const expected = filter.value ?? ''

  switch (filter.op) {
    case 'equals':
      return actual === expected
    case 'notEquals':
      return actual !== expected
    case 'contains':
      return (
        actual !== null && actual.toLowerCase().includes(expected.toLowerCase())
      )
    case 'notContains':
      return (
        actual === null ||
        !actual.toLowerCase().includes(expected.toLowerCase())
      )
  }
}
