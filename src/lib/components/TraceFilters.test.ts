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
    expect(screen.getByRole('option', { name: 'checkout-service' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'inventory-service' })).toBeInTheDocument()
    expect(container.querySelector('.filter-stats')?.textContent).toContain(
      'Showing 2 of 5 traces',
    )
  })

  it('clears all active filters', async () => {
    render(TraceFilters, {
      props: {
        services,
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
    const errorsOnly = screen.getByLabelText('Errors Only')
    const minDuration = screen.getByLabelText('Min Duration (ms)')
    const maxDuration = screen.getByLabelText('Max Duration (ms)')

    expect(search).toHaveValue('checkout')
    expect(service).toHaveValue('checkout-service')
    expect(errorsOnly).toBeChecked()
    expect(minDuration).toHaveValue(10)
    expect(maxDuration).toHaveValue(50)

    await fireEvent.click(screen.getByRole('button', { name: 'Clear Filters' }))

    expect(search).toHaveValue('')
    expect(service).toHaveValue('all')
    expect(errorsOnly).not.toBeChecked()
    expect(minDuration).toHaveValue(null)
    expect(maxDuration).toHaveValue(null)
  })

  it('hides clear button when filters are not active', () => {
    render(TraceFilters, {
      props: {
        services,
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

    expect(screen.queryByRole('button', { name: 'Clear Filters' })).not.toBeInTheDocument()
  })
})