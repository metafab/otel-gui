// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'
import CopyButton from './CopyButton.svelte'

// ── Clipboard mock ────────────────────────────────────────────────────────────

beforeEach(() => {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  })
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CopyButton', () => {
  // ── Rendering ─────────────────────────────────────────────────────────────

  it('renders a button with default aria-label "Copy value"', () => {
    render(CopyButton, { props: { text: 'hello' } })
    expect(
      screen.getByRole('button', { name: 'Copy value' }),
    ).toBeInTheDocument()
  })

  it('renders aria-label with label suffix when label is given', () => {
    render(CopyButton, { props: { text: 'hello', label: 'http.method' } })
    expect(
      screen.getByRole('button', { name: 'Copy value for http.method' }),
    ).toBeInTheDocument()
  })

  it('renders SVG icon at default size 12', () => {
    const { container } = render(CopyButton, { props: { text: 'x' } })
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('12')
    expect(svg.getAttribute('height')).toBe('12')
  })

  it('respects a custom size prop', () => {
    const { container } = render(CopyButton, { props: { text: 'x', size: 16 } })
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('16')
    expect(svg.getAttribute('height')).toBe('16')
  })

  it('applies extra class to the button', () => {
    const { container } = render(CopyButton, {
      props: { text: 'x', class: 'my-btn' },
    })
    expect(container.querySelector('button.my-btn')).toBeInTheDocument()
  })

  // ── showLabel ──────────────────────────────────────────────────────────────

  it('does not render "Copy" text when showLabel is false (default)', () => {
    render(CopyButton, { props: { text: 'x' } })
    const btn = screen.getByRole('button')
    expect(btn.textContent?.trim()).toBe('')
  })

  it('renders "Copy" text when showLabel is true', () => {
    render(CopyButton, { props: { text: 'x', showLabel: true } })
    expect(screen.getByText('Copy')).toBeInTheDocument()
  })

  // ── Click / clipboard ─────────────────────────────────────────────────────

  it('calls clipboard.writeText with the provided text on click', async () => {
    render(CopyButton, { props: { text: 'my-trace-id' } })
    await fireEvent.click(screen.getByRole('button'))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('my-trace-id')
  })

  it('shows "Copied" text after click when showLabel is true', async () => {
    render(CopyButton, { props: { text: 'hi', showLabel: true } })
    await fireEvent.click(screen.getByRole('button'))
    expect(await screen.findByText('Copied')).toBeInTheDocument()
  })

  it('adds "copied" class to the button after click', async () => {
    const { container } = render(CopyButton, { props: { text: 'hi' } })
    const btn = container.querySelector('button')!
    await fireEvent.click(btn)
    // Wait for Svelte to flush the state update
    expect(await screen.findByRole('button', { name: /copy value/i }))
    expect(btn.classList).toContain('copied')
  })
})
