import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readFixture<T = unknown>(name: string): T {
	return JSON.parse(readFileSync(resolve(process.cwd(), `tests/fixtures/${name}`), 'utf-8')) as T;
}

const simpleTrace = readFixture('simple-trace.json');
const errorTrace = readFixture('error-trace.json');
const multiServiceTrace = readFixture('multi-service-trace.json');

test.describe('Trace ingestion flow', () => {
	test.describe.configure({ mode: 'serial' });

	test.beforeEach(async ({ request }) => {
		await request.delete('/api/traces');
	});

	test('ingests OTLP JSON and shows trace list + detail page', async ({ page, request }) => {
		const ingest = await request.post('/v1/traces', {
			headers: {
				'Content-Type': 'application/json'
			},
			data: simpleTrace
		});
		expect(ingest.ok()).toBeTruthy();

		await page.goto('/');

		await expect(page.getByRole('columnheader', { name: 'Root Service' })).toBeVisible();
		await expect(page.getByRole('cell', { name: 'GET /' })).toBeVisible();
		const traceRow = page.locator('tbody tr', { hasText: 'GET /' }).first();
		await expect(traceRow).toContainText('frontend');

		await traceRow.click();

		expect(page.url()).toContain('/trace/5B8EFFF798038103D269B633813FC60C');
		await expect(page.getByRole('button', { name: /Back to Traces/i })).toBeVisible();
		await expect(page.getByText('Trace Details')).toBeVisible();
	});

	test('supports trace-list keyboard shortcuts and search filtering', async ({ page, request }) => {
		await request.post('/v1/traces', {
			headers: { 'Content-Type': 'application/json' },
			data: simpleTrace
		});
		await request.post('/v1/traces', {
			headers: { 'Content-Type': 'application/json' },
			data: errorTrace
		});

		await page.goto('/');

		await expect(page.locator('tbody tr')).toHaveCount(2);

		await page.keyboard.press('m');
		await expect(page.getByRole('tab', { name: 'Service Map' })).toHaveAttribute('aria-selected', 'true');

		await page.keyboard.press('m');
		await expect(page.getByRole('tab', { name: /Traces/ })).toHaveAttribute('aria-selected', 'true');

		await page.keyboard.press('/');
		await expect(page.locator('#search')).toBeFocused();

		await page.locator('#search').fill('payment');
		await expect(page.locator('tbody tr')).toHaveCount(1);
		await expect(page.locator('.filter-stats')).toContainText('Showing 1 of 2 traces');

		await page.keyboard.press('Escape');
		await expect(page.locator('#search')).toHaveValue('');
		await expect(page.locator('tbody tr')).toHaveCount(2);
	});

	test('supports trace-detail span search keyboard shortcuts', async ({ page, request }) => {
		await request.post('/v1/traces', {
			headers: { 'Content-Type': 'application/json' },
			data: simpleTrace
		});

		await page.goto('/trace/5B8EFFF798038103D269B633813FC60C');

		await expect(page.getByRole('heading', { name: 'Timeline' })).toBeVisible();

		await page.keyboard.press('/');
		await expect(page.locator('#span-search')).toBeFocused();

		await page.locator('#span-search').fill('GET');
		await expect(page.getByText('1 span found')).toBeVisible();

		await page.keyboard.press('Escape');
		await expect(page.locator('#span-search')).toHaveValue('');
	});

	test('toggles mini service map from trace detail button', async ({ page, request }) => {
		await request.post('/v1/traces', {
			headers: { 'Content-Type': 'application/json' },
			data: multiServiceTrace
		});

		await page.goto('/trace/AAAABBBBCCCCDDDD0000111122223333');

		const miniMapToggle = page.getByRole('button', { name: /Service Map/i }).first();
		await expect(miniMapToggle).toBeVisible();
		await expect(miniMapToggle).toHaveAttribute('aria-expanded', 'false');

		await miniMapToggle.click();
		await expect(miniMapToggle).toHaveAttribute('aria-expanded', 'true');
		await expect(page.locator('.mini-map-wrap')).toBeVisible();

		await miniMapToggle.click();
		await expect(miniMapToggle).toHaveAttribute('aria-expanded', 'false');
		await expect(page.locator('.mini-map-wrap')).toHaveCount(0);
	});

	test('toggles mini service map with m shortcut on trace detail', async ({ page, request }) => {
		await request.post('/v1/traces', {
			headers: { 'Content-Type': 'application/json' },
			data: multiServiceTrace
		});

		await page.goto('/trace/AAAABBBBCCCCDDDD0000111122223333');

		const miniMapToggle = page.getByRole('button', { name: /Service Map/i }).first();
		await expect(miniMapToggle).toBeVisible();
		await expect(miniMapToggle).toHaveAttribute('aria-expanded', 'false');

		await page.keyboard.press('m');
		await expect(miniMapToggle).toHaveAttribute('aria-expanded', 'true');

		await page.keyboard.press('m');
		await expect(miniMapToggle).toHaveAttribute('aria-expanded', 'false');
	});
});
