import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { once } from 'node:events'
import { request } from 'node:http'
import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'

async function startServer(t: TestContext, extraEnv: NodeJS.ProcessEnv = {}) {
  const child = spawn(process.execPath, ['build/index.js'], {
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: '0',
      OTEL_GUI_GRPC_ENABLED: 'false',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM')
      await once(child, 'exit')
    }
  })

  const url = await new Promise<string>((resolve, reject) => {
    let output = ''
    const timer = setTimeout(
      () => reject(new Error(`Server did not start: ${output}`)),
      15_000,
    )
    child.stdout.on('data', (data) => {
      output += data
      const match = output.match(/Listening on (http:\/\/127\.0\.0\.1:\d+)/)
      if (match) {
        clearTimeout(timer)
        resolve(match[1])
      }
    })
    child.stderr.on('data', (data) => {
      output += data
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`Server exited (${code}): ${output}`))
    })
  })
  return url
}

async function fixture(path: string) {
  return readFile(new URL(path, import.meta.url), 'utf8')
}

test('production HTTP clears telemetry while preserving origin checks', async (t) => {
  const url = await startServer(t)
  const datasets = [
    ['traces', await fixture('./fixtures/simple-trace.json')],
    ['logs', await fixture('./fixtures/simple-log.json')],
    [
      'metrics',
      await fixture('../samples/sample-metrics-ecommerce-part1.json'),
    ],
  ]

  for (const [kind, body] of datasets) {
    const ingest = await fetch(`${url}/v1/${kind}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    })
    assert.equal(ingest.status, 200, `${kind} ingestion`)
    const before = (await (
      await fetch(`${url}/api/${kind}`)
    ).json()) as unknown[]
    assert.ok(before.length > 0, `${kind} must be present before clearing`)

    const rejectedHeaders: HeadersInit[] = [
      { origin: 'http://example.invalid' },
      {},
    ]
    for (const headers of rejectedHeaders) {
      const response = await fetch(`${url}/api/${kind}`, {
        method: 'DELETE',
        headers,
      })
      assert.equal(response.status, 403, `${kind} origin check`)
    }

    const clear = await fetch(`${url}/api/${kind}`, {
      method: 'DELETE',
      headers: { origin: url, 'x-forwarded-proto': 'https' },
    })
    assert.equal(clear.status, 200, `${kind} clear`)
    assert.deepEqual(await clear.json(), {
      success: true,
      deletedCount: null,
      mode: 'all',
    })
    assert.deepEqual(await (await fetch(`${url}/api/${kind}`)).json(), [])

    const reingest = await fetch(`${url}/v1/${kind}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    })
    assert.equal(reingest.status, 200)
    const items = (await (await fetch(`${url}/api/${kind}`)).json()) as Array<{
      traceId?: string
      id?: string
    }>
    const id = kind === 'traces' ? items[0].traceId : items[0].id
    assert.ok(typeof id === 'string')
    const key =
      kind === 'traces' ? 'traceIds' : kind === 'logs' ? 'logIds' : 'ids'
    const selected = await fetch(`${url}/api/${kind}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ [key]: [id] }),
    })
    assert.equal(selected.status, 200, `${kind} selected delete`)
    const result = (await selected.json()) as { deletedCount: number }
    assert.equal(result.deletedCount, 1)
    const remaining = (await (
      await fetch(`${url}/api/${kind}`)
    ).json()) as unknown[]
    assert.equal(remaining.length, items.length - 1)
  }

  const host = new URL(url).host.replace('127.0.0.1', 'localhost')
  const status = await new Promise<number | undefined>((resolve, reject) => {
    const req = request(
      `${url}/api/traces`,
      {
        method: 'DELETE',
        headers: { host, origin: `http://${host}` },
      },
      (response) => {
        response.resume()
        resolve(response.statusCode)
      },
    )
    req.on('error', reject)
    req.end()
  })
  assert.equal(status, 200)
})

test('production honors only explicitly configured proxy protocol headers', async (t) => {
  const url = await startServer(t, { PROTOCOL_HEADER: 'x-forwarded-proto' })
  const httpsOrigin = url.replace('http:', 'https:')
  const headers = { origin: httpsOrigin, 'x-forwarded-proto': 'https' }
  const response = await fetch(`${url}/api/traces`, {
    method: 'DELETE',
    headers,
  })
  assert.equal(response.status, 200)

  const forbidden = await fetch(`${url}/api/traces`, {
    method: 'DELETE',
    headers: { ...headers, origin: 'https://example.invalid' },
  })
  assert.equal(forbidden.status, 403)

  const direct = await fetch(`${url}/api/traces`, {
    method: 'DELETE',
    headers: { origin: url },
  })
  assert.equal(direct.status, 200)
})
