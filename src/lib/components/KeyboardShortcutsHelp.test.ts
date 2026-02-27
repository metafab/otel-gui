// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'
import KeyboardShortcutsHelp from './KeyboardShortcutsHelp.svelte'

const SHORTCUTS = [
  { keys: ['/'], description: 'Focus search' },
  { keys: ['Esc'], description: 'Clear search or go back' },
  { keys: ['m'], description: 'Toggle service map' },
  { keys: ['?'], description: 'Toggle this overlay' },
]

describe('KeyboardShortcutsHelp', () => {
  // ── Rendering ────────────────────────────────────────────────────────────

  it('renders all shortcut descriptions', () => {
    render(KeyboardShortcutsHelp, {
      props: { shortcuts: SHORTCUTS, onclose: () => {} },
    })
    for (const { description } of SHORTCUTS) {
      expect(screen.getByText(description)).toBeInTheDocument()
    }
  })

  it('renders all key labels inside <kbd> elements', () => {
    render(KeyboardShortcutsHelp, {
      props: { shortcuts: SHORTCUTS, onclose: () => {} },
    })
    const kbdElements = document.querySelectorAll('kbd')
    const keyLabels = Array.from(kbdElements).map((el) => el.textContent)
    expect(keyLabels).toContain('/')
    expect(keyLabels).toContain('Esc')
  })

  it('renders the "Keyboard Shortcuts" heading', () => {
    render(KeyboardShortcutsHelp, {
      props: { shortcuts: SHORTCUTS, onclose: () => {} },
    })
    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument()
  })

  it('renders as a dialog with aria-modal', () => {
    render(KeyboardShortcutsHelp, {
      props: { shortcuts: SHORTCUTS, onclose: () => {} },
    })
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
  })

  // ── Close interactions ───────────────────────────────────────────────────

  it('calls onclose when the ✕ close button is clicked', async () => {
    const onclose = vi.fn()
    render(KeyboardShortcutsHelp, { props: { shortcuts: SHORTCUTS, onclose } })
    await fireEvent.click(screen.getByTitle('Close (Esc)'))
    expect(onclose).toHaveBeenCalledOnce()
  })

  it('calls onclose when the backdrop is clicked', async () => {
    const onclose = vi.fn()
    render(KeyboardShortcutsHelp, { props: { shortcuts: SHORTCUTS, onclose } })
    await fireEvent.click(screen.getByLabelText('Close'))
    expect(onclose).toHaveBeenCalledOnce()
  })

  it('calls onclose when Escape is pressed inside the modal', async () => {
    const onclose = vi.fn()
    render(KeyboardShortcutsHelp, { props: { shortcuts: SHORTCUTS, onclose } })
    const modal = document.querySelector('.modal') as HTMLElement
    await fireEvent.keyDown(modal, { key: 'Escape' })
    expect(onclose).toHaveBeenCalledOnce()
  })

  it('does not call onclose for non-Escape keys', async () => {
    const onclose = vi.fn()
    render(KeyboardShortcutsHelp, { props: { shortcuts: SHORTCUTS, onclose } })
    const modal = document.querySelector('.modal') as HTMLElement
    await fireEvent.keyDown(modal, { key: 'Enter' })
    expect(onclose).not.toHaveBeenCalled()
  })

  // ── Empty shortcuts ──────────────────────────────────────────────────────

  it('renders without error when shortcuts array is empty', () => {
    expect(() =>
      render(KeyboardShortcutsHelp, {
        props: { shortcuts: [], onclose: () => {} },
      }),
    ).not.toThrow()
  })
})
