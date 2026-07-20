// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/svelte'
import LogFilters from './LogFilters.svelte'

describe('LogFilters', () => {
  it('renders filter stats', () => {
    const { container } = render(LogFilters, {
      props: {
        services: ['checkout-service', 'worker-service'],
        searchQuery: '',
        selectedService: 'all',
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
    render(LogFilters, {
      props: {
        services: ['checkout-service', 'worker-service'],
        searchQuery: 'checkout',
        selectedService: 'worker-service',
        severityFilter: 'error',
        filteredCount: 1,
        totalCount: 5,
      },
    })

    const searchInput = screen.getByLabelText('Search logs')
    const servicePicker = screen.getByLabelText('Service')
    const severityPicker = screen.getByLabelText('Severity')

    expect(searchInput).toHaveValue('checkout')
    expect(servicePicker).toHaveTextContent('worker-service')
    expect(severityPicker).toHaveTextContent('Error+')
    expect(
      screen.getByRole('button', { name: 'Clear Filters' }),
    ).toBeInTheDocument()

    await fireEvent.click(screen.getByRole('button', { name: 'Clear Filters' }))

    expect(searchInput).toHaveValue('')
    expect(servicePicker).toHaveTextContent('All Services')
    expect(severityPicker).toHaveTextContent('All Severities')
  })

  it('selects a service from the custom picker', async () => {
    render(LogFilters, {
      props: {
        services: ['checkout-service', 'worker-service'],
        searchQuery: '',
        selectedService: 'all',
        severityFilter: 'all',
        filteredCount: 2,
        totalCount: 2,
      },
    })

    const servicePicker = screen.getByLabelText('Service')
    await fireEvent.click(servicePicker)
    await fireEvent.click(
      screen.getByRole('button', { name: 'worker-service' }),
    )

    expect(servicePicker).toHaveTextContent('worker-service')
  })

  it('selects a severity from the custom picker', async () => {
    render(LogFilters, {
      props: {
        services: ['checkout-service', 'worker-service'],
        searchQuery: '',
        selectedService: 'all',
        severityFilter: 'all',
        filteredCount: 2,
        totalCount: 2,
      },
    })

    const severityPicker = screen.getByLabelText('Severity')
    await fireEvent.click(severityPicker)
    await fireEvent.click(screen.getByRole('button', { name: 'Warn' }))

    expect(severityPicker).toHaveTextContent('Warn')
  })

  it('does not show clear button without active filters', () => {
    render(LogFilters, {
      props: {
        services: ['checkout-service', 'worker-service'],
        searchQuery: '',
        selectedService: 'all',
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
