import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetSSEConnectionForTests,
  onSSE,
  onSSEEvents,
} from './sseClient'

type Listener = (event: { data: string }) => void

// Minimal EventSource stand-in that records listeners and instances.
class FakeEventSource {
  static instances: FakeEventSource[] = []
  url: string
  onerror: (() => void) | null = null
  closed = false
  listeners = new Map<string, Set<Listener>>()

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }

  addEventListener(event: string, handler: Listener) {
    const set = this.listeners.get(event) ?? new Set()
    set.add(handler)
    this.listeners.set(event, set)
  }

  removeEventListener(event: string, handler: Listener) {
    this.listeners.get(event)?.delete(handler)
  }

  close() {
    this.closed = true
  }

  emit(event: string, data: string) {
    this.listeners.get(event)?.forEach((h) => h({ data }))
  }
}

describe('sseClient', () => {
  beforeEach(() => {
    FakeEventSource.instances = []
    vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource)
  })

  afterEach(() => {
    __resetSSEConnectionForTests()
    vi.unstubAllGlobals()
  })

  it('opens exactly one connection to /api/stream across many subscriptions', () => {
    onSSE('traces', () => {})
    onSSE('logs-count', () => {})
    onSSEEvents({ 'metrics-snapshot': () => {}, 'map-snapshot': () => {} })

    expect(FakeEventSource.instances).toHaveLength(1)
    expect(FakeEventSource.instances[0].url).toBe('/api/stream')
  })

  it('delivers events to the registered handler', () => {
    const received: string[] = []
    onSSE('traces', (e) => received.push(e.data))

    FakeEventSource.instances[0].emit('traces', '[1,2,3]')
    expect(received).toEqual(['[1,2,3]'])
  })

  it('unsubscribe removes the listener', () => {
    const received: string[] = []
    const off = onSSE('traces', (e) => received.push(e.data))
    const es = FakeEventSource.instances[0]

    es.emit('traces', 'first')
    off()
    es.emit('traces', 'second')

    expect(received).toEqual(['first'])
  })

  it('onSSEEvents unsubscribes all of its listeners at once', () => {
    const hits: string[] = []
    const off = onSSEEvents({
      'metrics-count': () => hits.push('count'),
      'metrics-append': () => hits.push('append'),
    })
    const es = FakeEventSource.instances[0]

    es.emit('metrics-count', '5')
    es.emit('metrics-append', '{}')
    expect(hits).toEqual(['count', 'append'])

    off()
    es.emit('metrics-count', '6')
    es.emit('metrics-append', '{}')
    expect(hits).toEqual(['count', 'append'])
  })

  it('returns a no-op unsubscribe when EventSource is unavailable (SSR)', () => {
    __resetSSEConnectionForTests()
    vi.stubGlobal('EventSource', undefined as unknown as typeof EventSource)

    const off = onSSE('traces', () => {})
    expect(typeof off).toBe('function')
    expect(() => off()).not.toThrow()
  })
})
