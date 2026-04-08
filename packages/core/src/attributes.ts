// Flatten OTLP KeyValue[] to Record<string, any>

export function flattenAttributes(
  keyValues: any[] | undefined,
): Record<string, any> {
  if (!keyValues || !Array.isArray(keyValues)) {
    return {}
  }

  const result: Record<string, any> = {}

  for (const kv of keyValues) {
    if (!kv.key || !kv.value) continue

    const key = kv.key
    const value = extractAnyValue(kv.value)

    if (value !== undefined) {
      result[key] = value
    }
  }

  return result
}

// Extract value from OTLP AnyValue union type
export function extractAnyValue(anyValue: any): any {
  if (!anyValue) return undefined

  // Handle all 7 AnyValue variants
  if (anyValue.stringValue !== undefined) {
    return anyValue.stringValue
  }
  if (anyValue.boolValue !== undefined) {
    return anyValue.boolValue
  }
  if (anyValue.intValue !== undefined) {
    // intValue is string-encoded in JSON for int64; convert to number for display
    // Note: values > 2^53-1 will lose precision, but that's acceptable for attribute display
    return Number(anyValue.intValue)
  }
  if (anyValue.doubleValue !== undefined) {
    return anyValue.doubleValue
  }
  if (anyValue.arrayValue !== undefined) {
    // Recursively extract array values
    return (anyValue.arrayValue.values || []).map(extractAnyValue)
  }
  if (anyValue.kvlistValue !== undefined) {
    // Recursively flatten nested KeyValue list
    return flattenAttributes(anyValue.kvlistValue.values)
  }
  if (anyValue.bytesValue !== undefined) {
    // bytesValue is base64-encoded in JSON
    return anyValue.bytesValue
  }

  return undefined
}
