// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import AttributeItem from './AttributeItem.svelte';

describe('AttributeItem', () => {
	// ── Rendering ───────────────────────────────────────────────────────────

	it('renders the attribute key', () => {
		render(AttributeItem, { props: { attrKey: 'http.method', value: 'GET' } });
		expect(screen.getByText('http.method')).toBeInTheDocument();
	});

	it('renders the attribute value', () => {
		render(AttributeItem, { props: { attrKey: 'http.method', value: 'GET' } });
		expect(screen.getByText('GET')).toBeInTheDocument();
	});

	it('shows "string" type label for string values', () => {
		render(AttributeItem, { props: { attrKey: 'k', value: 'hello' } });
		expect(screen.getByText('string')).toBeInTheDocument();
	});

	it('shows "number" type label for numeric values', () => {
		render(AttributeItem, { props: { attrKey: 'k', value: 42 } });
		expect(screen.getByText('number')).toBeInTheDocument();
	});

	it('shows "boolean" type label for boolean values', () => {
		render(AttributeItem, { props: { attrKey: 'k', value: true } });
		expect(screen.getByText('boolean')).toBeInTheDocument();
	});

	it('shows "array" type label for array values', () => {
		render(AttributeItem, { props: { attrKey: 'k', value: ['a', 'b'] } });
		expect(screen.getByText('array')).toBeInTheDocument();
	});

	it('shows "object" type label for object values', () => {
		render(AttributeItem, { props: { attrKey: 'k', value: { nested: true } } });
		expect(screen.getByText('object')).toBeInTheDocument();
	});

	it('shows "null" type label for null', () => {
		const { container } = render(AttributeItem, { props: { attrKey: 'k', value: null } });
		// Both the type badge and the value <pre> display "null" — scope to the badge element
		const typeLabel = container.querySelector('.attr-type');
		expect(typeLabel?.textContent?.trim()).toBe('null');
	});

	// ── Copy button ──────────────────────────────────────────────────────────

	it('renders a copy button with accessible aria-label', () => {
		render(AttributeItem, { props: { attrKey: 'http.method', value: 'GET' } });
		expect(screen.getByRole('button', { name: /copy value for http\.method/i })).toBeInTheDocument();
	});

	// ── Truncation ───────────────────────────────────────────────────────────

	it('does not show expand button for short values', () => {
		render(AttributeItem, { props: { attrKey: 'k', value: 'short' } });
		expect(screen.queryByLabelText(/view full value/i)).not.toBeInTheDocument();
	});

	it('shows expand button for values longer than 200 characters', () => {
		const longValue = 'x'.repeat(201);
		render(AttributeItem, { props: { attrKey: 'k', value: longValue } });
		expect(screen.getByLabelText(/view full value for k/i)).toBeInTheDocument();
	});

	it('truncates long values and appends ellipsis', () => {
		const longValue = 'a'.repeat(201);
		render(AttributeItem, { props: { attrKey: 'k', value: longValue } });
		const pre = document.querySelector('.attr-value') as HTMLElement;
		expect(pre.textContent).toMatch(/…$/);
	});

	// ── Fullscreen callback ──────────────────────────────────────────────────

	it('calls onFullscreen with key and value when expand button is clicked', async () => {
		const longValue = 'x'.repeat(201);
		const onFullscreen = vi.fn();
		render(AttributeItem, { props: { attrKey: 'my.key', value: longValue, onFullscreen } });

		await fireEvent.click(screen.getByLabelText(/view full value for my\.key/i));
		expect(onFullscreen).toHaveBeenCalledWith('my.key', longValue);
	});
});
