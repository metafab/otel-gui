import { beforeEach, describe, expect, it } from 'vitest'
import { GET } from './+server'
import { POST as ingestTraces } from '../../v1/traces/+server'
import { POST as ingestLogs } from '../../v1/logs/+server'
import { traceStore } from '$lib/server/traceStore'
import simpleTrace from '../../../../tests/fixtures/simple-trace.json'
import simpleLog from '../../../../tests/fixtures/simple-log.json'

/**
 * Reads from a live SSE reader, accumulating text, until the predicate matches
 * (or the chunk budget is spent). Unlike readUntil() this keeps an existing
 * reader open so a test can read the initial burst and then later updates.
 */
async function readChunksUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  predicate: (text: string) => boolean,
  maxChunks = 40,
): Promise<string> {
  let text = ''
  for (let i = 0; i < maxChunks; i++) {
    const { value, done } = await reader.read()
    if (done) break
    text += decoder.decode(value, { stream: true })
    if (predicate(text)) break
  }
  return text
}

/**
 * Reads the SSE ReadableStream until every expected event marker has been
 * seen (or a chunk budget is exhausted), then cancel so the heartbeat interval
 * is torn down and the test doesn't hang.
 */
async function readUntil(
  response: Response,
  markers: string[],
  maxChunks = 20,
): Promise<string> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let text = ''
  try {
    for (let i = 0; i < maxChunks; i++) {
      const { value, done } = await reader.read()
      if (done) break
      text += decoder.decode(value, { stream: true })
      if (markers.every((m) => text.includes(m))) break
    }
  } finally {
    await reader.cancel()
  }
  return text
}

function makeTracePost(body: unknown): Request {
  return new Request('http://localhost:4318/v1/traces', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeLogsPost(body: unknown): Request {
  return new Request('http://localhost:4318/v1/logs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('GET /api/stream (multiplexed SSE)', () => {
  beforeEach(() => {
    traceStore.clearTraces()
    traceStore.clearLogs()
  })

  it('emits an initial event for every multiplexed sub-stream on connect', async () => {
    const response = await GET({} as never)
    expect(response.headers.get('Content-Type')).toBe('text/event-stream')

    const text = await readUntil(response, [
      'event: traces',
      'event: logs-count',
      'event: logs-snapshot',
    ])

    expect(text).toContain('event: traces')
    expect(text).toContain('event: logs-count')
    expect(text).toContain('event: logs-snapshot')
  })

  it('includes ingested trace data in the initial traces event', async () => {
    await ingestTraces({ request: makeTracePost(simpleTrace) } as never)

    const response = await GET({} as never)
    const text = await readUntil(response, ['event: traces'])

    // The traces event should carry a non-empty list once a trace is ingested.
    const line = text.split('\n').find((l) => l.startsWith('data: [{'))
    expect(line, 'expected a non-empty traces data line').toBeTruthy()
  })

  it('streams a logs-append delta (not a re-snapshot) when a log is ingested after connect', async () => {
    const response = await GET({} as never)
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    try {
      // Drain the connect-time snapshot burst.
      await readChunksUntil(reader, decoder, (t) =>
        t.includes('event: logs-snapshot'),
      )
      // Ingest a log — an unchanged removal cursor means the delta path.
      await ingestLogs({ request: makeLogsPost(simpleLog) } as never)

      const delta = await readChunksUntil(reader, decoder, (t) =>
        t.includes('event: logs-append'),
      )
      expect(delta).toContain('event: logs-append')
      // A plain ingest must NOT trigger a fresh full snapshot.
      expect(delta).not.toContain('event: logs-snapshot')
    } finally {
      await reader.cancel()
    }
  })

  it('delivers a deferred update once a backpressured consumer catches up', async () => {
    const response = await GET({} as never)
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    try {
      // Read only ONE chunk of the connect burst, leaving the rest queued so the
      // stream is under backpressure (desiredSize <= 0) when the next update
      // fires. The flush is deferred rather than piled onto the outbound queue.
      await reader.read()

      // Single ingest while the consumer is behind. The old code skipped this
      // flush and never retried (the update would be lost until the next
      // notification); the pull()-driven flush must still deliver it.
      await ingestLogs({ request: makeLogsPost(simpleLog) } as never)

      // Drain: as the queue empties, pull() fires and the deferred logs-append
      // is sent. No further ingest happens, so this only passes if the update
      // was retried on drain rather than dropped.
      const text = await readChunksUntil(reader, decoder, (t) =>
        t.includes('event: logs-append'),
      )
      expect(text).toContain('event: logs-append')
    } finally {
      await reader.cancel()
    }
  })

  it('re-sends a logs-snapshot when logs are cleared after connect', async () => {
    await ingestLogs({ request: makeLogsPost(simpleLog) } as never)

    const response = await GET({} as never)
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    try {
      // Drain the connect-time snapshot burst.
      await readChunksUntil(reader, decoder, (t) =>
        t.includes('event: logs-snapshot'),
      )
      // A clear bumps the removal cursor, which forces a re-snapshot (the
      // append cursor can't express removals).
      traceStore.clearLogs()

      const afterClear = await readChunksUntil(reader, decoder, (t) =>
        t.includes('event: logs-snapshot'),
      )
      expect(afterClear).toContain('event: logs-snapshot')
    } finally {
      await reader.cancel()
    }
  })
})
