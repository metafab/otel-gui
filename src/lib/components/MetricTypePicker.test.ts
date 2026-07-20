// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/svelte'
import MetricTypePicker from './MetricTypePicker.svelte'

describe('MetricTypePicker', () => {
  it('renders all label when all is selected', () => {
    render(MetricTypePicker, {
      props: {
        selectedType: 'all',
      },
    })

    expect(screen.getByLabelText('Metric type')).toHaveTextContent('All Types')
  })

  it('renders selected type badge text when a type is selected', () => {
    render(MetricTypePicker, {
      props: {
        selectedType: 'exp_histogram',
      },
    })

    expect(screen.getByLabelText('Metric type')).toHaveTextContent(
      'Exp. Histogram',
    )
  })

  it('opens menu on click and selects an option', async () => {
    render(MetricTypePicker, {
      props: {
        selectedType: 'all',
      },
    })

    const trigger = screen.getByLabelText('Metric type')

    await fireEvent.click(trigger)
    expect(
      screen.getByRole('listbox', { name: 'Metric type' }),
    ).toBeInTheDocument()

    await fireEvent.click(screen.getByRole('button', { name: 'Histogram' }))

    expect(trigger).toHaveTextContent('Histogram')
    expect(
      screen.queryByRole('listbox', { name: 'Metric type' }),
    ).not.toBeInTheDocument()
  })

  it('supports keyboard selection from trigger with ArrowDown + Enter', async () => {
    render(MetricTypePicker, {
      props: {
        selectedType: 'all',
      },
    })

    const trigger = screen.getByLabelText('Metric type')
    trigger.focus()

    await fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    await fireEvent.keyDown(
      screen.getByRole('listbox', { name: 'Metric type' }),
      { key: 'Enter' },
    )

    expect(trigger).toHaveTextContent('Gauge')
  })

  it('closes menu on Escape and returns focus to trigger', async () => {
    render(MetricTypePicker, {
      props: {
        selectedType: 'all',
      },
    })

    const trigger = screen.getByLabelText('Metric type')

    await fireEvent.click(trigger)
    const listbox = screen.getByRole('listbox', { name: 'Metric type' })

    await fireEvent.keyDown(listbox, { key: 'Escape' })

    expect(
      screen.queryByRole('listbox', { name: 'Metric type' }),
    ).not.toBeInTheDocument()
    expect(document.activeElement).toBe(trigger)
  })

  it('honors custom ariaLabel, allLabel, and id props', () => {
    render(MetricTypePicker, {
      props: {
        selectedType: 'all',
        id: 'custom-type-picker',
        ariaLabel: 'Kind',
        allLabel: 'Any kind',
      },
    })

    const trigger = screen.getByLabelText('Kind')
    expect(trigger).toHaveTextContent('Any kind')
    expect(trigger.id).toBe('custom-type-picker')
  })
})
