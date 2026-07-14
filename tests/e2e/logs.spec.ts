import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function readFixture<T = unknown>(name: string): T {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), `tests/fixtures/${name}`), 'utf-8'),
  ) as T
}

const simpleLog = readFixture('simple-log.json')
const unlinkedLog = readFixture('log-unlinked.json')
const simpleTrace = readFixture('simple-trace.json')

test.describe('Logs flow', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(async ({ request }) => {
    await request.delete('/api/traces')
    await request.delete('/api/logs')
  })

  test('refreshes the logs tab when new logs arrive over SSE', async ({
    page,
    request,
  }) => {
    await page.goto('/?tab=logs')

    await expect(page.getByText('No logs received yet.')).toBeVisible()

    const ingest = await request.post('/v1/logs', {
      headers: { 'Content-Type': 'application/json' },
      data: simpleLog,
    })
    expect(ingest.ok()).toBeTruthy()

    const logRow = page
      .locator('tbody tr', { hasText: 'database timeout' })
      .first()
    await expect(logRow).toContainText('frontend')
  })

  test('opens log detail from the logs table and returns to the logs tab', async ({
    page,
    request,
  }) => {
    await request.post('/v1/logs', {
      headers: { 'Content-Type': 'application/json' },
      data: simpleLog,
    })

    await page.goto('/?tab=logs')

    const logRow = page
      .locator('tbody tr', { hasText: 'database timeout' })
      .first()
    await expect(logRow).toContainText('frontend')

    await logRow.click()

    await expect(page).toHaveURL(/\/logs\//)
    await expect(page.getByRole('heading', { name: /Log / })).toBeVisible()
    await expect(page.getByText('retry_count')).toBeVisible()

    await page.getByRole('button', { name: '← Back to Logs' }).click()

    await expect(page).toHaveURL(/\/\?tab=logs$/)
    await expect(page.getByRole('tab', { name: 'Logs' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(logRow).toContainText('database timeout')
  })

  test('activates log rows with Enter and Space', async ({ page, request }) => {
    await request.post('/v1/logs', {
      headers: { 'Content-Type': 'application/json' },
      data: simpleLog,
    })

    await page.goto('/?tab=logs')

    const logRow = page
      .locator('tbody tr', { hasText: 'database timeout' })
      .first()
    await expect(logRow).toContainText('frontend')

    await logRow.focus()
    await page.keyboard.press('Enter')

    await expect(page).toHaveURL(/\/logs\//)
    await expect(page.getByRole('heading', { name: /Log / })).toBeVisible()

    await page.getByRole('button', { name: '← Back to Logs' }).click()
    await expect(page).toHaveURL(/\/\?tab=logs$/)

    await logRow.focus()
    await page.keyboard.press('Space')

    await expect(page).toHaveURL(/\/logs\//)
    await expect(page.getByRole('heading', { name: /Log / })).toBeVisible()
  })

  test('follows trace and span links from log detail into trace detail', async ({
    page,
    request,
  }) => {
    await request.post('/v1/traces', {
      headers: { 'Content-Type': 'application/json' },
      data: simpleTrace,
    })
    await request.post('/v1/logs', {
      headers: { 'Content-Type': 'application/json' },
      data: simpleLog,
    })

    await page.goto('/?tab=logs')
    await page
      .locator('tbody tr', { hasText: 'database timeout' })
      .first()
      .click()

    const spanLink = page.getByRole('link', { name: /span EEE19B7EC3C1B174/i })
    await expect(spanLink).toHaveAttribute(
      'href',
      /\/traces\/5B8EFFF798038103D269B633813FC60C\?.*spanId=EEE19B7EC3C1B174/,
    )

    await spanLink.click()

    await expect(page).toHaveURL(
      /\/traces\/5B8EFFF798038103D269B633813FC60C\?.*spanId=EEE19B7EC3C1B174/,
    )
    await expect(page.getByText('Trace Details')).toBeVisible()
    await expect(
      page
        .locator('.span-details .detail-row', { hasText: 'Name:' })
        .locator('.value'),
    ).toHaveText('GET /')
  })

  test('preserves unlinked log detail behavior', async ({ page, request }) => {
    await request.post('/v1/logs', {
      headers: { 'Content-Type': 'application/json' },
      data: unlinkedLog,
    })

    await page.goto('/?tab=logs')

    const logRow = page
      .locator('tbody tr', { hasText: 'Report generation slow: 2000ms' })
      .first()
    await logRow.click()

    await expect(page.getByText('Unlinked trace')).toBeVisible()
    await expect(page.getByText('span -')).toBeVisible()
  })

  test('supports logs tab delete selected and clear all interactions', async ({
    page,
    request,
  }) => {
    await request.post('/v1/logs', {
      headers: { 'Content-Type': 'application/json' },
      data: simpleLog,
    })
    await request.post('/v1/logs', {
      headers: { 'Content-Type': 'application/json' },
      data: unlinkedLog,
    })

    await page.goto('/?tab=logs')

    await expect(page.getByRole('tab', { name: 'Logs' })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    const logRows = page.locator('tbody tr')
    await expect(logRows).toHaveCount(4)

    await logRows.first().locator('input.row-checkbox').check()

    await page.getByRole('button', { name: 'More clear actions' }).click()
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('menuitem', { name: /Delete Selected/ }).click()

    await expect(logRows).toHaveCount(3)

    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'Clear All' }).click()

    await expect(page.getByText('No logs received yet.')).toBeVisible()
  })
})
