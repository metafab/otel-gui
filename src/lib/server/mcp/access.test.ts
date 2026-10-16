import { describe, expect, it } from 'vitest'
import { allowsRemoteMcp, isLoopbackAddress, mcpIsEnabled } from './access.js'

describe('MCP access settings', () => {
  it('enables MCP unless explicitly disabled', () => {
    expect(mcpIsEnabled(undefined)).toBe(true)
    expect(mcpIsEnabled('')).toBe(true)
    expect(mcpIsEnabled('false')).toBe(false)
    expect(mcpIsEnabled('0')).toBe(false)
    expect(mcpIsEnabled('true')).toBe(true)
  })

  it('requires an explicit true value to allow remote clients', () => {
    expect(allowsRemoteMcp(undefined)).toBe(false)
    expect(allowsRemoteMcp('false')).toBe(false)
    expect(allowsRemoteMcp('1')).toBe(true)
    expect(allowsRemoteMcp('TRUE')).toBe(true)
  })

  it('recognizes IPv4 and IPv6 loopback addresses', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true)
    expect(isLoopbackAddress('127.12.34.56')).toBe(true)
    expect(isLoopbackAddress('::1')).toBe(true)
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isLoopbackAddress('192.168.1.4')).toBe(false)
    expect(isLoopbackAddress('')).toBe(false)
  })
})
