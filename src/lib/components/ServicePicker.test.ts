// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/svelte'
import ServicePicker from './ServicePicker.svelte'

describe('ServicePicker', () => {
  const services = ['checkout-service', 'worker-service']

  it('renders all label when all is selected', () => {
    render(ServicePicker, {
      props: {
        services,
        selectedService: 'all',
      },
    })

    expect(screen.getByLabelText('Service')).toHaveTextContent('All services')
  })

  it('renders selected service badge text when a service is selected', () => {
    render(ServicePicker, {
      props: {
        services,
        selectedService: 'worker-service',
      },
    })

    expect(screen.getByLabelText('Service')).toHaveTextContent('worker-service')
  })

  it('opens menu on click and selects an option', async () => {
    render(ServicePicker, {
      props: {
        services,
        selectedService: 'all',
      },
    })

    const trigger = screen.getByLabelText('Service')

    await fireEvent.click(trigger)
    expect(screen.getByRole('listbox', { name: 'Service' })).toBeInTheDocument()

    await fireEvent.click(
      screen.getByRole('button', { name: 'worker-service' }),
    )

    expect(trigger).toHaveTextContent('worker-service')
    expect(
      screen.queryByRole('listbox', { name: 'Service' }),
    ).not.toBeInTheDocument()
  })

  it('supports keyboard selection from trigger with ArrowDown + Enter', async () => {
    render(ServicePicker, {
      props: {
        services,
        selectedService: 'all',
      },
    })

    const trigger = screen.getByLabelText('Service')
    trigger.focus()

    await fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    await fireEvent.keyDown(screen.getByRole('listbox', { name: 'Service' }), {
      key: 'Enter',
    })

    expect(trigger).toHaveTextContent('checkout-service')
  })

  it('supports Home and End navigation in listbox', async () => {
    render(ServicePicker, {
      props: {
        services,
        selectedService: 'all',
      },
    })

    const trigger = screen.getByLabelText('Service')

    await fireEvent.click(trigger)
    const listbox = screen.getByRole('listbox', { name: 'Service' })

    await fireEvent.keyDown(listbox, { key: 'End' })
    await fireEvent.keyDown(listbox, { key: 'Enter' })
    expect(trigger).toHaveTextContent('worker-service')

    await fireEvent.click(trigger)
    const reopenedListbox = screen.getByRole('listbox', { name: 'Service' })
    await fireEvent.keyDown(reopenedListbox, { key: 'Home' })
    await fireEvent.keyDown(reopenedListbox, { key: 'Enter' })
    expect(trigger).toHaveTextContent('All services')
  })

  it('closes menu on Escape and returns focus to trigger', async () => {
    render(ServicePicker, {
      props: {
        services,
        selectedService: 'all',
      },
    })

    const trigger = screen.getByLabelText('Service')

    await fireEvent.click(trigger)
    const listbox = screen.getByRole('listbox', { name: 'Service' })

    await fireEvent.keyDown(listbox, { key: 'Escape' })

    expect(
      screen.queryByRole('listbox', { name: 'Service' }),
    ).not.toBeInTheDocument()
    expect(document.activeElement).toBe(trigger)
  })

  it('closes menu on Tab key without changing selection', async () => {
    render(ServicePicker, {
      props: {
        services,
        selectedService: 'checkout-service',
      },
    })

    const trigger = screen.getByLabelText('Service')

    await fireEvent.click(trigger)
    const listbox = screen.getByRole('listbox', { name: 'Service' })

    await fireEvent.keyDown(listbox, { key: 'Tab' })

    expect(
      screen.queryByRole('listbox', { name: 'Service' }),
    ).not.toBeInTheDocument()
    expect(trigger).toHaveTextContent('checkout-service')
  })

  it('honors custom ariaLabel, allLabel, and id props', async () => {
    render(ServicePicker, {
      props: {
        services,
        selectedService: 'all',
        id: 'trace-service-picker',
        ariaLabel: 'Trace service',
        allLabel: 'All Services',
      },
    })

    const trigger = screen.getByLabelText('Trace service')
    expect(trigger).toHaveAttribute('id', 'trace-service-picker')
    expect(trigger).toHaveTextContent('All Services')

    await fireEvent.click(trigger)
    expect(
      screen.getByRole('listbox', { name: 'Trace service' }),
    ).toBeInTheDocument()
  })
})
