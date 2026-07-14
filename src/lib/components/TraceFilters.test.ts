// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/svelte'
import TraceFilters from './TraceFilters.svelte'

describe('TraceFilters', () => {
  const services = ['checkout-service', 'inventory-service']

  it('renders service options and stats', () => {
    const { container } = render(TraceFilters, {
      props: {
        services,
        serviceScope: 'root',
        searchQuery: '',
        selectedService: 'all',
        showErrorsOnly: false,
        minDuration: null,
        maxDuration: null,
        filteredCount: 2,
        totalCount: 5,
        searchInputEl: null,
      },
    })

    expect(screen.getByLabelText('Search')).toBeInTheDocument()
    expect(screen.getByLabelText('Service')).toBeInTheDocument()
    expect(screen.getByLabelText('Root Only')).toBeChecked()
    expect(container.querySelector('.filter-stats')?.textContent).toContain(
      'Showing 2 of 5 traces',
    )
  })

  it('clears all active filters', async () => {
    render(TraceFilters, {
      props: {
        services,
        serviceScope: 'any',
        searchQuery: 'checkout',
        selectedService: 'checkout-service',
        showErrorsOnly: true,
        minDuration: 10,
        maxDuration: 50,
        filteredCount: 1,
        totalCount: 5,
        searchInputEl: null,
      },
    })

    const search = screen.getByLabelText('Search')
    const service = screen.getByLabelText('Service')
    const rootServiceOnly = screen.getByLabelText('Root Only')
    const errorsOnly = screen.getByLabelText('Errors Only')
    const minDuration = screen.getByLabelText('Min Duration (ms)')
    const maxDuration = screen.getByLabelText('Max Duration (ms)')

    expect(search).toHaveValue('checkout')
    expect(service).toHaveTextContent('checkout-service')
    expect(rootServiceOnly).not.toBeChecked()
    expect(errorsOnly).toBeChecked()
    expect(minDuration).toHaveValue(10)
    expect(maxDuration).toHaveValue(50)

    await fireEvent.click(screen.getByRole('button', { name: 'Clear Filters' }))

    expect(search).toHaveValue('')
    expect(service).toHaveTextContent('All Services')
    expect(rootServiceOnly).toBeChecked()
    expect(errorsOnly).not.toBeChecked()
    expect(minDuration).toHaveValue(null)
    expect(maxDuration).toHaveValue(null)
  })

  it('selects a service from the shared picker', async () => {
    render(TraceFilters, {
      props: {
        services,
        serviceScope: 'root',
        searchQuery: '',
        selectedService: 'all',
        showErrorsOnly: false,
        minDuration: null,
        maxDuration: null,
        filteredCount: 2,
        totalCount: 5,
        searchInputEl: null,
      },
    })

    const servicePicker = screen.getByLabelText('Service')
    await fireEvent.click(servicePicker)
    await fireEvent.click(
      screen.getByRole('button', { name: 'inventory-service' }),
    )

    expect(servicePicker).toHaveTextContent('inventory-service')
  })

  it('hides clear button when filters are not active', () => {
    render(TraceFilters, {
      props: {
        services,
        serviceScope: 'root',
        searchQuery: '',
        selectedService: 'all',
        showErrorsOnly: false,
        minDuration: null,
        maxDuration: null,
        filteredCount: 2,
        totalCount: 5,
        searchInputEl: null,
      },
    })

    expect(
      screen.queryByRole('button', { name: 'Clear Filters' }),
    ).not.toBeInTheDocument()
  })
})
