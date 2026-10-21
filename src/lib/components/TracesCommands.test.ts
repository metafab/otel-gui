// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte'
import TracesCommands from './TracesCommands.svelte'

afterEach(cleanup)

function renderCommands(overrides: Record<string, unknown> = {}) {
  const onExport = vi.fn()
  render(TracesCommands, {
    props: {
      filteredCount: 5,
      selectedCount: 0,
      totalCount: 5,
      isExporting: false,
      onImport: vi.fn(),
      onExport,
      onClearAll: vi.fn(),
      onDeleteSelected: vi.fn(),
      ...overrides,
    },
  })
  return { onExport }
}

describe('TracesCommands export button', () => {
  it('exports filtered traces when nothing is selected', async () => {
    const { onExport } = renderCommands()
    await fireEvent.click(
      screen.getByRole('button', { name: 'Export Filtered' }),
    )
    expect(onExport).toHaveBeenCalledTimes(1)
  })

  it('shows the selection count when traces are selected', () => {
    renderCommands({ selectedCount: 2 })
    expect(
      screen.getByRole('button', { name: 'Export Selected (2)' }),
    ).toBeTruthy()
  })

  it('is disabled when there is nothing to export', () => {
    renderCommands({ filteredCount: 0 })
    const button = screen.getByRole('button', {
      name: 'Export Filtered',
    }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })
})
