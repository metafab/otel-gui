export type AnyValue =
  | { stringValue: string }
  | { boolValue: boolean }
  | { intValue: string }
  | { doubleValue: number }
  | { arrayValue: { values: AnyValue[] } }
  | { kvlistValue: { values: Array<{ key: string; value: AnyValue }> } }

export function toAnyValue(value: unknown): AnyValue {
  if (typeof value === 'boolean') {
    return { boolValue: value }
  }

  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return { intValue: String(value) }
    }
    return { doubleValue: value }
  }

  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map((item) => toAnyValue(item)),
      },
    }
  }

  if (value && typeof value === 'object') {
    return {
      kvlistValue: {
        values: Object.entries(value as Record<string, unknown>).map(
          ([key, nestedValue]) => ({
            key,
            value: toAnyValue(nestedValue),
          }),
        ),
      },
    }
  }

  return { stringValue: value == null ? '' : String(value) }
}

export function toKeyValues(record: Record<string, unknown>): Array<{
  key: string
  value: AnyValue
}> {
  return Object.entries(record).map(([key, value]) => ({
    key,
    value: toAnyValue(value),
  }))
}
