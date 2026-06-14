// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/svelte'
import LogsFilter from './LogsFilter.svelte'

describe('LogsFilter', () => {
  it('renders filter stats', () => {
    const { container } = render(LogsFilter, {
      props: {
        searchQuery: '',
        severityFilter: 'all',
        filteredCount: 3,
        totalCount: 9,
      },
    })

    expect(container.querySelector('.filter-stats')?.textContent).toContain(
      'Showing 3 of 9 logs',
    )
  })

  it('shows and applies clear filters action', async () => {
    render(LogsFilter, {
      props: {
        searchQuery: 'checkout',
        severityFilter: 'error',
        filteredCount: 1,
        totalCount: 5,
      },
    })

    const searchInput = screen.getByLabelText('Search logs')
    const severitySelect = screen.getByLabelText('Severity')

    expect(searchInput).toHaveValue('checkout')
    expect(severitySelect).toHaveValue('error')
    expect(
      screen.getByRole('button', { name: 'Clear Filters' }),
    ).toBeInTheDocument()

    await fireEvent.click(screen.getByRole('button', { name: 'Clear Filters' }))

    expect(searchInput).toHaveValue('')
    expect(severitySelect).toHaveValue('all')
  })

  it('does not show clear button without active filters', () => {
    render(LogsFilter, {
      props: {
        searchQuery: '',
        severityFilter: 'all',
        filteredCount: 2,
        totalCount: 2,
      },
    })

    expect(
      screen.queryByRole('button', { name: 'Clear Filters' }),
    ).not.toBeInTheDocument()
  })
})
