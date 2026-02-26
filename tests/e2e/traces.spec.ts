import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const simpleTrace = JSON.parse(
	readFileSync(resolve(process.cwd(), 'tests/fixtures/simple-trace.json'), 'utf-8')
);

test.describe('Trace ingestion flow', () => {
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
		await expect(page.locator('tbody tr').first()).toContainText('frontend');
		await expect(page.getByRole('cell', { name: 'GET /' })).toBeVisible();

		await page.locator('tbody tr').first().click();

		expect(page.url()).toContain('/trace/5B8EFFF798038103D269B633813FC60C');
		await expect(page.getByRole('button', { name: /Back to Traces/i })).toBeVisible();
		await expect(page.getByText('Trace Details')).toBeVisible();
	});
});
