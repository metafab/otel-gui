// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/svelte'
import MetricsFilter from './MetricsFilter.svelte'

describe('MetricsFilter', () => {
  it('renders filter stats', () => {
    const { container } = render(MetricsFilter, {
      props: {
        searchQuery: '',
        typeFilter: 'all',
        filteredCount: 3,
        totalCount: 9,
      },
    })

    expect(container.querySelector('.filter-stats')?.textContent).toContain(
      'Showing 3 of 9 metrics',
    )
  })

  it('shows and applies clear filters action', async () => {
    render(MetricsFilter, {
      props: {
        searchQuery: 'http',
        typeFilter: 'sum',
        filteredCount: 1,
        totalCount: 5,
      },
    })

    const searchInput = screen.getByLabelText('Search metrics')
    const typeSelect = screen.getByLabelText('Metric type')

    expect(searchInput).toHaveValue('http')
    expect(typeSelect).toHaveValue('sum')
    expect(
      screen.getByRole('button', { name: 'Clear Filters' }),
    ).toBeInTheDocument()

    await fireEvent.click(screen.getByRole('button', { name: 'Clear Filters' }))

    expect(searchInput).toHaveValue('')
    expect(typeSelect).toHaveValue('all')
  })

  it('does not show clear button without active filters', () => {
    render(MetricsFilter, {
      props: {
        searchQuery: '',
        typeFilter: 'all',
        filteredCount: 2,
        totalCount: 2,
      },
    })

    expect(
      screen.queryByRole('button', { name: 'Clear Filters' }),
    ).not.toBeInTheDocument()
  })

  it('filters down to a single type via the select', async () => {
    render(MetricsFilter, {
      props: {
        searchQuery: '',
        typeFilter: 'all',
        filteredCount: 4,
        totalCount: 4,
      },
    })

    const typeSelect = screen.getByLabelText('Metric type') as HTMLSelectElement
    await fireEvent.change(typeSelect, { target: { value: 'gauge' } })
    expect(typeSelect.value).toBe('gauge')
  })
})
