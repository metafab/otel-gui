// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte'
import LogsCommands from './LogsCommands.svelte'

afterEach(cleanup)

function renderCommands(overrides: Record<string, unknown> = {}) {
  const onExport = vi.fn()
  const onImport = vi.fn()
  render(LogsCommands, {
    props: {
      filteredCount: 5,
      totalCount: 5,
      selectedCount: 0,
      isDeleting: false,
      isExporting: false,
      onImport,
      onExport,
      onClearAll: vi.fn(),
      onDeleteSelected: vi.fn(),
      ...overrides,
    },
  })
  return { onExport, onImport }
}

describe('LogsCommands import/export', () => {
  it('calls onImport from the Import Logs button', async () => {
    const { onImport } = renderCommands()
    await fireEvent.click(screen.getByRole('button', { name: 'Import Logs' }))
    expect(onImport).toHaveBeenCalledTimes(1)
  })

  it('exports filtered logs when nothing is selected', async () => {
    const { onExport } = renderCommands()
    await fireEvent.click(
      screen.getByRole('button', { name: 'Export Filtered' }),
    )
    expect(onExport).toHaveBeenCalledTimes(1)
  })

  it('shows the selection count when logs are selected', () => {
    renderCommands({ selectedCount: 3 })
    expect(
      screen.getByRole('button', { name: 'Export Selected (3)' }),
    ).toBeTruthy()
  })

  it('disables export when there are no filtered logs', () => {
    renderCommands({ filteredCount: 0 })
    const button = screen.getByRole('button', {
      name: 'Export Filtered',
    }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })
})
