// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/svelte'
import LogsFilter from './LogsFilter.svelte'

describe('LogsFilter', () => {
  it('renders filter stats', () => {
    const { container } = render(LogsFilter, {
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
    render(LogsFilter, {
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
    const severitySelect = screen.getByLabelText('Severity')

    expect(searchInput).toHaveValue('checkout')
    expect(servicePicker).toHaveTextContent('worker-service')
    expect(severitySelect).toHaveValue('error')
    expect(
      screen.getByRole('button', { name: 'Clear Filters' }),
    ).toBeInTheDocument()

    await fireEvent.click(screen.getByRole('button', { name: 'Clear Filters' }))

    expect(searchInput).toHaveValue('')
    expect(servicePicker).toHaveTextContent('All services')
    expect(severitySelect).toHaveValue('all')
  })

  it('selects a service from the custom picker', async () => {
    render(LogsFilter, {
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

  it('supports keyboard navigation inside the service picker menu', async () => {
    render(LogsFilter, {
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
    servicePicker.focus()

    await fireEvent.keyDown(servicePicker, { key: 'ArrowDown' })
    await fireEvent.keyDown(screen.getByRole('listbox', { name: 'Service' }), {
      key: 'Enter',
    })

    expect(servicePicker).toHaveTextContent('checkout-service')
  })

  it('does not show clear button without active filters', () => {
    render(LogsFilter, {
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
