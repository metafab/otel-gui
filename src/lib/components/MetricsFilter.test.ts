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
    const typePicker = screen.getByLabelText('Metric type')
    const servicePicker = screen.getByLabelText('Service')

    expect(searchInput).toHaveValue('http')
    expect(typePicker).toHaveTextContent('Sum')
    expect(servicePicker).toHaveTextContent('checkout')
    expect(
      screen.getByRole('button', { name: 'Clear Filters' }),
    ).toBeInTheDocument()

    await fireEvent.click(screen.getByRole('button', { name: 'Clear Filters' }))

    expect(searchInput).toHaveValue('')
    expect(typePicker).toHaveTextContent('All Types')
    expect(servicePicker).toHaveTextContent('All Services')
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

  it('filters down to a single type via the type picker', async () => {
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

    const typePicker = screen.getByLabelText('Metric type')
    await fireEvent.click(typePicker)
    await fireEvent.click(screen.getByRole('button', { name: 'Gauge' }))
    expect(typePicker).toHaveTextContent('Gauge')
  })

  it('lists services and selects one via the service picker', async () => {
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

    const servicePicker = screen.getByLabelText('Service')
    await fireEvent.click(servicePicker)
    expect(screen.getByRole('listbox', { name: 'Service' })).toBeInTheDocument()
    await fireEvent.click(screen.getByRole('button', { name: 'checkout' }))
    expect(servicePicker).toHaveTextContent('checkout')
  })
})
