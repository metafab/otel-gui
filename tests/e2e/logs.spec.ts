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

    // Wait longer for SSE subscription and data delivery in parallel execution
    await page.locator('tbody tr').first().waitFor({ timeout: 10_000 })

    const logRow = page
      .locator('tbody tr', { hasText: 'database timeout' })
      .first()
    await expect(logRow).toContainText('frontend')
  })

  test('opens log detail from the logs table and returns to the logs tab', async ({
    page,
    request,
  }) => {
    // Navigate first to let the Logs component mount, then ingest logs
    await page.goto('/?tab=logs')

    await request.post('/v1/logs', {
      headers: { 'Content-Type': 'application/json' },
      data: simpleLog,
    })

    // Wait for logs table to appear after ingestion
    await page.locator('tbody tr').first().waitFor({ timeout: 5000 })

    const logRow = page
      .locator('tbody tr', { hasText: 'database timeout' })
      .first()
    await expect(logRow).toContainText('frontend')

    await logRow.click()

    await expect(page).toHaveURL(/\/logs\//)
    // Wait for log detail page to load
    await page.waitForSelector('.log-detail-page', { timeout: 5000 })
    await expect(page.getByRole('heading', { name: /Log / })).toBeVisible()
    await expect(page.getByText('retry_count')).toBeVisible()

    await page.getByRole('button', { name: '← Back to Logs' }).click()

    await expect(page).toHaveURL(/\/\?tab=logs$/)
    await expect(page.getByRole('tab', { name: 'Logs' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    // Wait for the Logs component to render the table
    // Add a small delay to let the page settle after navigation
    await page.waitForTimeout(200)
    await page.locator('table').first().waitFor({ timeout: 10_000 })
    // Re-query the row since the DOM may have changed after navigation
    const returnedLogRow = page
      .locator('tbody tr', { hasText: 'database timeout' })
      .first()
    await returnedLogRow.waitFor({ timeout: 10_000 })
    await expect(returnedLogRow).toContainText('database timeout')
  })

  test('activates log rows with Enter and Space', async ({ page, request }) => {
    // Navigate first to let the Logs component mount, then ingest logs
    await page.goto('/?tab=logs')

    await request.post('/v1/logs', {
      headers: { 'Content-Type': 'application/json' },
      data: simpleLog,
    })

    // Wait for logs table to appear after ingestion
    await page.locator('tbody tr').first().waitFor({ timeout: 5000 })

    const logRow = page
      .locator('tbody tr', { hasText: 'database timeout' })
      .first()
    await expect(logRow).toContainText('frontend')

    await logRow.focus()
    await page.keyboard.press('Enter')

    await expect(page).toHaveURL(/\/logs\//)
    // Wait for log detail page to load
    await page.waitForSelector('.log-detail-page', { timeout: 5000 })
    await expect(page.getByRole('heading', { name: /Log / })).toBeVisible()

    await page.getByRole('button', { name: '← Back to Logs' }).click()
    await expect(page).toHaveURL(/\/\?tab=logs$/)

    // Re-query after navigation to avoid stale reference
    const logRowAfterNav = page
      .locator('tbody tr', { hasText: 'database timeout' })
      .first()
    await logRowAfterNav.waitFor({ timeout: 5000 })
    await logRowAfterNav.focus()
    await page.keyboard.press('Space')

    await expect(page).toHaveURL(/\/logs\//)
    // Wait for log detail page to load
    await page.waitForSelector('.log-detail-page', { timeout: 5000 })
    await expect(page.getByRole('heading', { name: /Log / })).toBeVisible()
  })

  test('follows trace and span links from log detail into trace detail', async ({
    page,
    request,
  }) => {
    // Navigate first to let the Logs component mount
    await page.goto('/?tab=logs')

    await request.post('/v1/traces', {
      headers: { 'Content-Type': 'application/json' },
      data: simpleTrace,
    })
    await request.post('/v1/logs', {
      headers: { 'Content-Type': 'application/json' },
      data: simpleLog,
    })

    // Wait for logs table to appear after ingestion
    await page.locator('tbody tr').first().waitFor({ timeout: 5000 })

    await page
      .locator('tbody tr', { hasText: 'database timeout' })
      .first()
      .click()

    // Wait for log detail page to load
    await page.waitForSelector('.log-detail-page', { timeout: 5000 })

    const spanLink = page.getByRole('link', { name: /span EEE19B7EC3C1B174/i })
    await expect(spanLink).toHaveAttribute(
      'href',
      /\/traces\/5B8EFFF798038103D269B633813FC60C\?.*spanId=EEE19B7EC3C1B174/,
    )

    await spanLink.click()

    await expect(page).toHaveURL(
      /\/traces\/5B8EFFF798038103D269B633813FC60C\?.*spanId=EEE19B7EC3C1B174/,
    )
    // Wait for trace detail page to load
    await page.waitForSelector('.trace-detail', { timeout: 5000 })
    await expect(page.getByText('Trace Details')).toBeVisible()
    await expect(
      page
        .locator('.span-details .detail-row', { hasText: 'Name:' })
        .locator('.value'),
    ).toHaveText('GET /')
  })

  test('preserves unlinked log detail behavior', async ({ page, request }) => {
    // Navigate first to let the Logs component mount, then ingest logs
    await page.goto('/?tab=logs')

    await request.post('/v1/logs', {
      headers: { 'Content-Type': 'application/json' },
      data: unlinkedLog,
    })

    // Wait for logs table to appear after ingestion
    await page.locator('tbody tr').first().waitFor({ timeout: 5000 })

    const logRow = page
      .locator('tbody tr', { hasText: 'Report generation slow: 2000ms' })
      .first()
    await logRow.click()

    // Wait for log detail page to load
    await page.waitForSelector('.log-detail-page', { timeout: 5000 })

    await expect(page.getByText('Unlinked trace')).toBeVisible()
    await expect(page.getByText('span -')).toBeVisible()
  })

  test('supports logs tab delete selected and clear all interactions', async ({
    page,
    request,
  }) => {
    // Navigate first to let the Logs component mount
    await page.goto('/?tab=logs')

    await request.post('/v1/logs', {
      headers: { 'Content-Type': 'application/json' },
      data: simpleLog,
    })
    await request.post('/v1/logs', {
      headers: { 'Content-Type': 'application/json' },
      data: unlinkedLog,
    })

    // Wait for logs table to appear after ingestion
    await page.locator('tbody tr').first().waitFor({ timeout: 5000 })

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

  test('restores logs filters after opening detail and going back', async ({
    page,
    request,
  }) => {
    await page.goto('/?tab=logs')

    await request.post('/v1/logs', {
      headers: { 'Content-Type': 'application/json' },
      data: simpleLog,
    })
    await request.post('/v1/logs', {
      headers: { 'Content-Type': 'application/json' },
      data: unlinkedLog,
    })

    await page.locator('tbody tr').first().waitFor({ timeout: 10_000 })

    await page.getByLabel('Search logs').fill('database')
    await page.locator('#logs-severity').click()
    await page.getByRole('button', { name: 'Error+' }).click()

    const filteredRow = page
      .locator('tbody tr', { hasText: 'database timeout' })
      .first()
    await expect(filteredRow).toBeVisible()

    await filteredRow.click()
    await expect(page).toHaveURL(/\/logs\//)

    await page.getByRole('button', { name: '← Back to Logs' }).click()
    await expect(page).toHaveURL(/\/?\?tab=logs.*search=database/)

    const restoredUrl = new URL(page.url())
    expect(restoredUrl.searchParams.get('search')).toBe('database')
    expect(restoredUrl.searchParams.get('severity')).toBe('error')

    await expect(page.getByLabel('Search logs')).toHaveValue('database')
    await expect(page.locator('#logs-severity')).toContainText('Error+')
  })
})
