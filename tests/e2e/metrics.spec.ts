import { expect, test } from '@playwright/test'

const gaugeMetricsPayload = {
  resourceMetrics: [
    {
      resource: {
        attributes: [
          { key: 'service.name', value: { stringValue: 'checkout-service' } },
        ],
      },
      scopeMetrics: [
        {
          scope: { name: 'frontend-meter' },
          metrics: [
            {
              name: 'http.server.duration',
              description: 'HTTP server duration',
              unit: 'ms',
              gauge: {
                dataPoints: [
                  {
                    attributes: [
                      { key: 'route', value: { stringValue: '/checkout' } },
                    ],
                    timeUnixNano: '1700000000000000000',
                    asDouble: 24,
                  },
                ],
              },
            },
          ],
        },
      ],
    },
  ],
}

const sumMetricsPayload = {
  resourceMetrics: [
    {
      resource: {
        attributes: [
          { key: 'service.name', value: { stringValue: 'worker-service' } },
        ],
      },
      scopeMetrics: [
        {
          scope: { name: 'worker-meter' },
          metrics: [
            {
              name: 'jobs.processed',
              description: 'Jobs processed',
              unit: '1',
              sum: {
                aggregationTemporality: 2,
                isMonotonic: true,
                dataPoints: [
                  {
                    attributes: [
                      { key: 'queue', value: { stringValue: 'default' } },
                    ],
                    timeUnixNano: '1700000001000000000',
                    asInt: '12',
                  },
                ],
              },
            },
          ],
        },
      ],
    },
  ],
}

test.describe('Metrics flow', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(async ({ request }) => {
    await request.delete('/api/traces')
    await request.delete('/api/logs')
    await request.delete('/api/metrics')
  })

  test('refreshes the metrics tab when new metrics arrive over SSE', async ({
    page,
    request,
  }) => {
    await page.goto('/?tab=metrics')

    await expect(page.getByText('No metrics received yet.')).toBeVisible()

    const ingest = await request.post('/v1/metrics', {
      headers: { 'Content-Type': 'application/json' },
      data: gaugeMetricsPayload,
    })
    expect(ingest.ok()).toBeTruthy()

    await page.locator('tbody tr').first().waitFor({ timeout: 10_000 })

    const metricRow = page
      .locator('tbody tr', { hasText: 'http.server.duration' })
      .first()
    await expect(metricRow).toContainText('checkout-service')
  })

  test('opens metric detail from the metrics table and returns to the metrics tab', async ({
    page,
    request,
  }) => {
    await page.goto('/?tab=metrics')

    await request.post('/v1/metrics', {
      headers: { 'Content-Type': 'application/json' },
      data: gaugeMetricsPayload,
    })

    await page.locator('tbody tr').first().waitFor({ timeout: 10_000 })

    const metricRow = page
      .locator('tbody tr', { hasText: 'http.server.duration' })
      .first()
    await metricRow.click()

    await expect(page).toHaveURL(/\/metrics\//)
    await page.waitForSelector('.metric-detail-page', { timeout: 10_000 })
    await expect(page.getByText('http.server.duration')).toBeVisible()

    await page.getByRole('button', { name: '← Back to Metrics' }).click()

    await expect(page).toHaveURL(/\/\?tab=metrics$/)
    await page.locator('table').first().waitFor({ timeout: 10_000 })
    await expect(
      page.locator('tbody tr', { hasText: 'http.server.duration' }).first(),
    ).toBeVisible()
  })

  test('activates metric rows with Enter and Space', async ({
    page,
    request,
  }) => {
    await page.goto('/?tab=metrics')

    await request.post('/v1/metrics', {
      headers: { 'Content-Type': 'application/json' },
      data: gaugeMetricsPayload,
    })

    await page.locator('tbody tr').first().waitFor({ timeout: 10_000 })

    const metricRow = page
      .locator('tbody tr', { hasText: 'http.server.duration' })
      .first()

    await metricRow.focus()
    await page.keyboard.press('Enter')

    await expect(page).toHaveURL(/\/metrics\//)
    await page.waitForSelector('.metric-detail-page', { timeout: 10_000 })

    await page.getByRole('button', { name: '← Back to Metrics' }).click()
    await expect(page).toHaveURL(/\/\?tab=metrics$/)

    const metricRowAfterNav = page
      .locator('tbody tr', { hasText: 'http.server.duration' })
      .first()
    await metricRowAfterNav.waitFor({ timeout: 10_000 })
    await metricRowAfterNav.focus()
    await page.keyboard.press('Space')

    await expect(page).toHaveURL(/\/metrics\//)
    await page.waitForSelector('.metric-detail-page', { timeout: 10_000 })
  })

  test('filters metrics by service and type', async ({ page, request }) => {
    await page.goto('/?tab=metrics')

    await request.post('/v1/metrics', {
      headers: { 'Content-Type': 'application/json' },
      data: gaugeMetricsPayload,
    })
    await request.post('/v1/metrics', {
      headers: { 'Content-Type': 'application/json' },
      data: sumMetricsPayload,
    })

    await page.locator('tbody tr').first().waitFor({ timeout: 10_000 })

    await page.locator('#metrics-service').click()
    await page.getByRole('button', { name: 'worker-service' }).click()

    await page.locator('#metrics-type').click()
    await page.getByRole('button', { name: /^Sum$/ }).click()

    await expect(
      page.locator('tbody tr', { hasText: 'jobs.processed' }).first(),
    ).toBeVisible()
    await expect(
      page.locator('tbody tr', { hasText: 'http.server.duration' }),
    ).toHaveCount(0)
  })

  test('supports metrics tab delete selected and clear all interactions', async ({
    page,
    request,
  }) => {
    await page.goto('/?tab=metrics')

    await request.post('/v1/metrics', {
      headers: { 'Content-Type': 'application/json' },
      data: gaugeMetricsPayload,
    })
    await request.post('/v1/metrics', {
      headers: { 'Content-Type': 'application/json' },
      data: sumMetricsPayload,
    })

    await page.locator('tbody tr').first().waitFor({ timeout: 10_000 })

    const metricRows = page.locator('tbody tr')
    await expect(metricRows).toHaveCount(2)

    await metricRows.first().locator('input.row-checkbox').check()

    await page.getByRole('button', { name: 'More clear actions' }).click()
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('menuitem', { name: /Delete Selected/ }).click()

    await expect(metricRows).toHaveCount(1)

    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'Clear All' }).click()

    await expect(page.getByText('No metrics received yet.')).toBeVisible()
  })
})
