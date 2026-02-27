// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'
import FullscreenValueModal from './FullscreenValueModal.svelte'

beforeEach(() => {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  })
})

const ATTR = { key: 'http.url', value: 'https://example.com/api/users?page=2' }

describe('FullscreenValueModal', () => {
  // ── Hidden state ──────────────────────────────────────────────────────────

  it('renders nothing when attr is null', () => {
    const { container } = render(FullscreenValueModal, {
      props: { attr: null, onclose: () => {} },
    })
    expect(
      container.querySelector('.fullscreen-overlay'),
    ).not.toBeInTheDocument()
  })

  // ── Visible state ─────────────────────────────────────────────────────────

  it('renders the attribute key when attr is provided', () => {
    render(FullscreenValueModal, { props: { attr: ATTR, onclose: () => {} } })
    expect(screen.getByText('http.url')).toBeInTheDocument()
  })

  it('renders the attribute value', () => {
    render(FullscreenValueModal, { props: { attr: ATTR, onclose: () => {} } })
    expect(screen.getByText(ATTR.value)).toBeInTheDocument()
  })

  it('renders as a dialog with aria-modal="true"', () => {
    render(FullscreenValueModal, { props: { attr: ATTR, onclose: () => {} } })
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
  })

  it('renders a copy button', () => {
    render(FullscreenValueModal, { props: { attr: ATTR, onclose: () => {} } })
    expect(screen.getByTitle('Copy value')).toBeInTheDocument()
  })

  // ── Close interactions ────────────────────────────────────────────────────

  it('calls onclose when the ✕ button is clicked', async () => {
    const onclose = vi.fn()
    render(FullscreenValueModal, { props: { attr: ATTR, onclose } })
    await fireEvent.click(screen.getByTitle('Close (Esc)'))
    expect(onclose).toHaveBeenCalledOnce()
  })

  it('calls onclose when the backdrop is clicked', async () => {
    const onclose = vi.fn()
    render(FullscreenValueModal, { props: { attr: ATTR, onclose } })
    await fireEvent.click(screen.getByLabelText('Close'))
    expect(onclose).toHaveBeenCalledOnce()
  })

  it('calls onclose when Escape is pressed inside the modal', async () => {
    const onclose = vi.fn()
    render(FullscreenValueModal, { props: { attr: ATTR, onclose } })
    const modal = document.querySelector('.fullscreen-modal') as HTMLElement
    await fireEvent.keyDown(modal, { key: 'Escape' })
    expect(onclose).toHaveBeenCalledOnce()
  })

  it('does not call onclose for non-Escape keys', async () => {
    const onclose = vi.fn()
    render(FullscreenValueModal, { props: { attr: ATTR, onclose } })
    const modal = document.querySelector('.fullscreen-modal') as HTMLElement
    await fireEvent.keyDown(modal, { key: 'Enter' })
    expect(onclose).not.toHaveBeenCalled()
  })

  // ── Copy ─────────────────────────────────────────────────────────────────

  it('copies the attribute value to clipboard when copy is clicked', async () => {
    render(FullscreenValueModal, { props: { attr: ATTR, onclose: () => {} } })
    await fireEvent.click(screen.getByTitle('Copy value'))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(ATTR.value)
  })
})
