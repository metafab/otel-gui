export function mcpIsEnabled(value: string | undefined): boolean {
  return (
    value === undefined ||
    value === '' ||
    !['0', 'false'].includes(value.toLowerCase())
  )
}

export function allowsRemoteMcp(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true'
}

export function isLoopbackAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^::ffff:/, '')
  return (
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === 'localhost' ||
    normalized.startsWith('127.')
  )
}
