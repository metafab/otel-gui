import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function readFixture<T = unknown>(name: string): T {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), `tests/fixtures/${name}`), 'utf-8'),
  ) as T
}

async function resolveCssVarColor(page: Page, variableName: string) {
  return page.evaluate((cssVar) => {
    const probe = document.createElement('span')
    probe.style.color = `var(${cssVar})`
    document.body.appendChild(probe)
    const color = window.getComputedStyle(probe).color
    probe.remove()
    return color
  }, variableName)
}

const simpleTrace = readFixture('simple-trace.json')
const errorTrace = readFixture('error-trace.json')
const multiServiceTrace = readFixture('multi-service-trace.json')
const errorNavigationTrace = {
  resourceSpans: [
    {
      resource: {
        attributes: [
          { key: 'service.name', value: { stringValue: 'checkout-service' } },
        ],
      },
      scopeSpans: [
        {
          scope: { name: 'checkout-tracer' },
          spans: [
            {
              traceId: 'ERRNAV000000000000000000000001',
              spanId: 'ROOTERRNAV000001',
              parentSpanId: '',
              name: 'POST /checkout',
              kind: 2,
              startTimeUnixNano: '1700000000000000000',
              endTimeUnixNano: '1700000001000000000',
              attributes: [],
              status: { code: 1 },
            },
            {
              traceId: 'ERRNAV000000000000000000000001',
              spanId: 'CHILDERRNAV00001',
              parentSpanId: 'ROOTERRNAV000001',
              name: 'validateCart',
              kind: 1,
              startTimeUnixNano: '1700000000100000000',
              endTimeUnixNano: '1700000000400000000',
              attributes: [],
              status: { code: 2, message: 'Cart invalid' },
            },
            {
              traceId: 'ERRNAV000000000000000000000001',
              spanId: 'CHILDERRNAV00002',
              parentSpanId: 'ROOTERRNAV000001',
              name: 'reserveInventory',
              kind: 1,
              startTimeUnixNano: '1700000000500000000',
              endTimeUnixNano: '1700000000900000000',
              attributes: [],
              status: { code: 2, message: 'Inventory timeout' },
            },
          ],
        },
      ],
    },
  ],
}

const sidebarSectionsTrace = {
  resourceSpans: [
    {
      resource: {
        attributes: [
          {
            key: 'service.name',
            value: { stringValue: 'distributed-service' },
          },
        ],
      },
      scopeSpans: [
        {
          scope: { name: 'distributed-tracer', version: '1.0.0' },
          spans: [
            {
              traceId: 'SIDEBAR000000000000000000000001',
              spanId: 'SIDEBARSPAN00001',
              parentSpanId: '',
              name: 'distributed operation',
              kind: 3,
              startTimeUnixNano: '1707785500000000000',
              endTimeUnixNano: '1707785500250000000',
              attributes: [
                {
                  key: 'operation.type',
                  value: { stringValue: 'distributed-request' },
                },
                { key: 'correlation.id', value: { stringValue: 'corr-123' } },
              ],
              events: [
                {
                  timeUnixNano: '1707785500100000000',
                  name: 'request.sent',
                  attributes: [{ key: 'retry', value: { boolValue: false } }],
                },
              ],
              links: [
                {
                  traceId: 'LINKTRACE000000000000000000001',
                  spanId: 'LINKSPAN000000001',
                  traceState: 'key1=value1',
                  attributes: [
                    {
                      key: 'link.type',
                      value: { stringValue: 'follows-from' },
                    },
                  ],
                },
              ],
              status: { code: 1 },
            },
          ],
        },
      ],
    },
  ],
}

test.describe('Trace ingestion flow', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(async ({ request }) => {
    await request.delete('/api/traces')
  })

  test('ingests OTLP JSON and shows trace list + detail page', async ({
    page,
    request,
  }) => {
    const ingest = await request.post('/v1/traces', {
      headers: {
        'Content-Type': 'application/json',
      },
      data: simpleTrace,
    })
    expect(ingest.ok()).toBeTruthy()

    await page.goto('/')

    await expect(
      page.getByRole('columnheader', { name: 'Root Service' }),
    ).toBeVisible()
    await expect(page.getByRole('cell', { name: 'GET /' })).toBeVisible()
    const traceRow = page.locator('tbody tr', { hasText: 'GET /' }).first()
    await expect(traceRow).toContainText('frontend')

    await traceRow.click()

    expect(page.url()).toContain('/trace/5B8EFFF798038103D269B633813FC60C')
    await expect(
      page.getByRole('button', { name: /Back to Traces/i }),
    ).toBeVisible()
    await expect(page.getByText('Trace Details')).toBeVisible()
  })

  test('supports trace-list keyboard shortcuts and search filtering', async ({
    page,
    request,
  }) => {
    await request.post('/v1/traces', {
      headers: { 'Content-Type': 'application/json' },
      data: simpleTrace,
    })
    await request.post('/v1/traces', {
      headers: { 'Content-Type': 'application/json' },
      data: errorTrace,
    })

    await page.goto('/')

    await expect(page.locator('tbody tr')).toHaveCount(2)

    await page.keyboard.press('m')
    await expect(
      page.getByRole('tab', { name: 'Service Map' }),
    ).toHaveAttribute('aria-selected', 'true')

    await page.keyboard.press('m')
    await expect(page.getByRole('tab', { name: /Traces/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    await page.keyboard.press('/')
    await expect(page.locator('#search')).toBeFocused()

    await page.locator('#search').fill('payment')
    await expect(page.locator('tbody tr')).toHaveCount(1)
    await expect(page.locator('.filter-stats')).toContainText(
      'Showing 1 of 2 traces',
    )

    await page.keyboard.press('Escape')
    await expect(page.locator('#search')).toHaveValue('')
    await expect(page.locator('tbody tr')).toHaveCount(2)
  })

  test('supports trace-detail span search keyboard shortcuts', async ({
    page,
    request,
  }) => {
    await request.post('/v1/traces', {
      headers: { 'Content-Type': 'application/json' },
      data: simpleTrace,
    })

    await page.goto('/trace/5B8EFFF798038103D269B633813FC60C')

    await expect(page.getByRole('heading', { name: 'Timeline' })).toBeVisible()

    await page.keyboard.press('/')
    await expect(page.locator('#span-search')).toBeVisible()

    await page.locator('#span-search').fill('GET')
    await expect(page.getByText('1 span found')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.locator('#span-search')).toHaveValue('')
  })

  test('toggles mini service map from trace detail button', async ({
    page,
    request,
  }) => {
    await request.post('/v1/traces', {
      headers: { 'Content-Type': 'application/json' },
      data: multiServiceTrace,
    })

    await page.goto('/trace/AAAABBBBCCCCDDDD0000111122223333')

    const miniMapToggle = page
      .getByRole('button', { name: /Service Map/i })
      .first()
    await expect(miniMapToggle).toBeVisible()
    await expect(miniMapToggle).toHaveAttribute('aria-expanded', 'false')

    await miniMapToggle.click()
    await expect(miniMapToggle).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('.mini-map-wrap')).toBeVisible()

    await miniMapToggle.click()
    await expect(miniMapToggle).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('.mini-map-wrap')).toHaveCount(0)
  })

  test('toggles mini service map with m shortcut on trace detail', async ({
    page,
    request,
  }) => {
    await request.post('/v1/traces', {
      headers: { 'Content-Type': 'application/json' },
      data: multiServiceTrace,
    })

    await page.goto('/trace/AAAABBBBCCCCDDDD0000111122223333')

    const miniMapToggle = page
      .getByRole('button', { name: /Service Map/i })
      .first()
    await expect(miniMapToggle).toBeVisible()
    await expect(miniMapToggle).toHaveAttribute('aria-expanded', 'false')

    await page.keyboard.press('m')
    await expect(miniMapToggle).toHaveAttribute('aria-expanded', 'true')

    await page.keyboard.press('m')
    await expect(miniMapToggle).toHaveAttribute('aria-expanded', 'false')
  })

  test('navigates error spans with e and Shift+E shortcuts', async ({
    page,
    request,
  }) => {
    await request.post('/v1/traces', {
      headers: { 'Content-Type': 'application/json' },
      data: errorNavigationTrace,
    })

    await page.goto('/trace/ERRNAV000000000000000000000001')

    await expect(page.getByText('Spans with errors: 2')).toBeVisible()
    const errorPosition = page.locator('.position-indicator').first()
    await expect(errorPosition).toHaveText('0/2')

    await page.keyboard.press('e')
    await expect(errorPosition).toHaveText('1/2')

    await page.keyboard.press('e')
    await expect(errorPosition).toHaveText('2/2')

    await page.keyboard.press('Shift+E')
    await expect(errorPosition).toHaveText('1/2')
  })

  test('supports waterfall tree navigation with arrows and Enter', async ({
    page,
    request,
  }) => {
    await request.post('/v1/traces', {
      headers: { 'Content-Type': 'application/json' },
      data: multiServiceTrace,
    })

    await page.goto('/trace/AAAABBBBCCCCDDDD0000111122223333')

    const spanTree = page.getByRole('tree', { name: 'Span tree' })
    const rows = page.locator('.waterfall-row')
    const selectedName = page
      .locator('.span-details .detail-row', { hasText: 'Name:' })
      .locator('.value')

    await expect(rows).toHaveCount(3)
    await expect(selectedName).toHaveText('GET /checkout')

    await spanTree.focus()

    await page.keyboard.press('ArrowDown')
    await expect(selectedName).toHaveText('processCheckout')

    await page.keyboard.press('ArrowUp')
    await expect(selectedName).toHaveText('GET /checkout')

    await page.keyboard.press('ArrowLeft')
    await expect(rows).toHaveCount(1)

    await page.keyboard.press('ArrowRight')
    await expect(rows).toHaveCount(3)

    await page.keyboard.press('Enter')
    await expect(rows).toHaveCount(1)

    await page.keyboard.press('Enter')
    await expect(rows).toHaveCount(3)
  })

  test('shows sidebar events, links, and attribute filtering flow', async ({
    page,
    request,
  }) => {
    await request.post('/v1/traces', {
      headers: { 'Content-Type': 'application/json' },
      data: sidebarSectionsTrace,
    })

    await page.goto('/trace/SIDEBAR000000000000000000000001')

    await expect(
      page.getByRole('heading', { name: 'Span Details' }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Events (1)' }),
    ).toBeVisible()
    await expect(page.getByText('request.sent')).toBeVisible()

    await expect(page.getByRole('heading', { name: 'Links (1)' })).toBeVisible()
    const traceLink = page.locator('a.link-anchor').first()
    await expect(traceLink).toHaveAttribute(
      'href',
      '/trace/LINKTRACE000000000000000000001',
    )

    const attributeFilter = page.locator('#attribute-filter')
    await attributeFilter.fill('operation.type')
    await expect(
      page.locator('.section-title', { hasText: 'Attributes' }),
    ).toContainText('1 of 2')
    await expect(
      page.locator('.attribute-item', { hasText: 'operation.type' }),
    ).toBeVisible()

    await attributeFilter.fill('does-not-exist')
    await expect(
      page.getByText('No attributes match the filter.'),
    ).toBeVisible()
  })

  test.describe('waterfall indicators', () => {
    test('supports child-badge collapse and expand controls', async ({
      page,
      request,
    }) => {
      await request.post('/v1/traces', {
        headers: { 'Content-Type': 'application/json' },
        data: multiServiceTrace,
      })

      await page.goto('/trace/AAAABBBBCCCCDDDD0000111122223333')

      const rows = page.locator('.waterfall-row')
      await expect(rows).toHaveCount(3)

      const rootRow = page
        .locator('.waterfall-row', { hasText: 'GET /checkout' })
        .first()
      const rootBadge = rootRow.locator('button.child-badge')

      await expect(rootBadge).toHaveAttribute('aria-label', 'Collapse')
      await expect(rootBadge).toHaveAttribute('aria-expanded', 'true')

      await rootBadge.click()
      await expect(rows).toHaveCount(1)
      await expect(rootBadge).toHaveAttribute('aria-label', 'Expand')
      await expect(rootBadge).toHaveAttribute('aria-expanded', 'false')

      await rootBadge.click()
      await expect(rows).toHaveCount(3)
      await expect(rootBadge).toHaveAttribute('aria-label', 'Collapse')
      await expect(rootBadge).toHaveAttribute('aria-expanded', 'true')

      await expect(page.locator('.indicator-cell')).toHaveCount(0)

      const leafRow = page
        .locator('.waterfall-row', { hasText: 'SELECT * FROM orders' })
        .first()
      await expect(leafRow.locator('button.child-badge')).toHaveCount(0)
      await expect(leafRow.locator('.child-badge-spacer')).toHaveCount(1)
    })

    test('shows left indicator rail for selected span', async ({
      page,
      request,
    }) => {
      await request.post('/v1/traces', {
        headers: { 'Content-Type': 'application/json' },
        data: multiServiceTrace,
      })

      await page.goto('/trace/AAAABBBBCCCCDDDD0000111122223333')

      const selectedRow = page.locator('.waterfall-row.selected').first()
      await expect(selectedRow).toHaveCount(1)

      const expectedSelectedBorder = await resolveCssVarColor(
        page,
        '--selected-border',
      )
      const selectedIndicator = await selectedRow.evaluate((el) => {
        const styles = window.getComputedStyle(el)
        return {
          borderLeftWidth: styles.borderLeftWidth,
          borderLeftColor: styles.borderLeftColor,
        }
      })

      expect(selectedIndicator.borderLeftWidth).toBe('3px')
      expect(selectedIndicator.borderLeftColor).toBe(expectedSelectedBorder)
    })

    test('shows left indicator rail for search-matching spans', async ({
      page,
      request,
    }) => {
      await request.post('/v1/traces', {
        headers: { 'Content-Type': 'application/json' },
        data: multiServiceTrace,
      })

      await page.goto('/trace/AAAABBBBCCCCDDDD0000111122223333')

      const spanSearch = page.locator('#span-search')
      await spanSearch.fill('processCheckout')
      await expect(page.getByText('1 span found')).toBeVisible()

      const highlightedRow = page
        .locator('.waterfall-row', { hasText: 'processCheckout' })
        .first()
      await expect(highlightedRow).toHaveClass(/highlighted/)

      const expectedHighlightBorder = await resolveCssVarColor(
        page,
        '--highlight-border',
      )
      const highlightIndicator = await highlightedRow.evaluate((el) => {
        const styles = window.getComputedStyle(el)
        return {
          borderLeftWidth: styles.borderLeftWidth,
          borderLeftColor: styles.borderLeftColor,
        }
      })

      expect(highlightIndicator.borderLeftWidth).toBe('3px')
      expect(highlightIndicator.borderLeftColor).toBe(expectedHighlightBorder)
    })

    test('shows a persistent right rail for error spans', async ({
      page,
      request,
    }) => {
      await request.post('/v1/traces', {
        headers: { 'Content-Type': 'application/json' },
        data: errorNavigationTrace,
      })

      await page.goto('/trace/ERRNAV000000000000000000000001')

      const errorRow = page
        .locator('.waterfall-row', { hasText: 'validateCart' })
        .first()
      await expect(errorRow).toHaveClass(/error/)
      const expectedErrorBorder = await resolveCssVarColor(
        page,
        '--error-border',
      )

      const rail = await errorRow.evaluate((el) => {
        const pseudo = window.getComputedStyle(el, '::after')
        return {
          content: pseudo.content,
          width: pseudo.width,
          backgroundColor: pseudo.backgroundColor,
        }
      })

      expect(rail.content).not.toBe('none')
      expect(rail.width).toBe('3px')
      expect(rail.backgroundColor).toBe(expectedErrorBorder)
    })
  })
})
