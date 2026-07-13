// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/svelte'
import MetricsFilter from './MetricsFilter.svelte'

describe('MetricsFilter', () => {
  it('renders filter stats', () => {
    const { container } = render(MetricsFilter, {
      props: {
        services: [],
        searchQuery: '',
        typeFilter: 'all',
        selectedService: 'all',
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
        services: ['checkout'],
        searchQuery: 'http',
        typeFilter: 'sum',
        selectedService: 'checkout',
        filteredCount: 1,
        totalCount: 5,
      },
    })

    const searchInput = screen.getByLabelText('Search metrics')
    const typeSelect = screen.getByLabelText('Metric type')
    const serviceSelect = screen.getByLabelText('Service')

    expect(searchInput).toHaveValue('http')
    expect(typeSelect).toHaveValue('sum')
    expect(serviceSelect).toHaveValue('checkout')
    expect(
      screen.getByRole('button', { name: 'Clear Filters' }),
    ).toBeInTheDocument()

    await fireEvent.click(screen.getByRole('button', { name: 'Clear Filters' }))

    expect(searchInput).toHaveValue('')
    expect(typeSelect).toHaveValue('all')
    expect(serviceSelect).toHaveValue('all')
  })

  it('does not show clear button without active filters', () => {
    render(MetricsFilter, {
      props: {
        services: [],
        searchQuery: '',
        typeFilter: 'all',
        selectedService: 'all',
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
        services: [],
        searchQuery: '',
        typeFilter: 'all',
        selectedService: 'all',
        filteredCount: 4,
        totalCount: 4,
      },
    })

    const typeSelect = screen.getByLabelText('Metric type') as HTMLSelectElement
    await fireEvent.change(typeSelect, { target: { value: 'gauge' } })
    expect(typeSelect.value).toBe('gauge')
  })

  it('lists services and selects one via the select', async () => {
    render(MetricsFilter, {
      props: {
        services: ['api', 'checkout'],
        searchQuery: '',
        typeFilter: 'all',
        selectedService: 'all',
        filteredCount: 4,
        totalCount: 4,
      },
    })

    const serviceSelect = screen.getByLabelText('Service') as HTMLSelectElement
    expect(screen.getByRole('option', { name: 'checkout' })).toBeInTheDocument()
    await fireEvent.change(serviceSelect, { target: { value: 'checkout' } })
    expect(serviceSelect.value).toBe('checkout')
  })
})
