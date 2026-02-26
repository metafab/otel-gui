// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import ChevronIcon from './ChevronIcon.svelte';

describe('ChevronIcon', () => {
	it('renders an SVG element', () => {
		const { container } = render(ChevronIcon);
		expect(container.querySelector('svg')).toBeTruthy();
	});

	it('defaults to collapsed (rotate(0deg))', () => {
		const { container } = render(ChevronIcon);
		const svg = container.querySelector('svg') as SVGElement;
		expect(svg.style.transform).toBe('rotate(0deg)');
	});

	it('rotates 90deg when expanded=true', () => {
		const { container } = render(ChevronIcon, { props: { expanded: true } });
		const svg = container.querySelector('svg') as SVGElement;
		expect(svg.style.transform).toBe('rotate(90deg)');
	});

	it('uses default size of 12', () => {
		const { container } = render(ChevronIcon);
		const svg = container.querySelector('svg') as SVGElement;
		expect(svg.getAttribute('width')).toBe('12');
		expect(svg.getAttribute('height')).toBe('12');
	});

	it('respects a custom size', () => {
		const { container } = render(ChevronIcon, { props: { size: 20 } });
		const svg = container.querySelector('svg') as SVGElement;
		expect(svg.getAttribute('width')).toBe('20');
		expect(svg.getAttribute('height')).toBe('20');
	});

	it('has aria-hidden=true', () => {
		const { container } = render(ChevronIcon);
		const svg = container.querySelector('svg')!;
		expect(svg.getAttribute('aria-hidden')).toBe('true');
	});
});
