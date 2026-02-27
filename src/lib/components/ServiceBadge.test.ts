// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/svelte'
import ServiceBadge from './ServiceBadge.svelte'

describe('ServiceBadge', () => {
  it('renders the service name', () => {
    const { getByText } = render(ServiceBadge, {
      props: { serviceName: 'frontend' },
    })
    expect(getByText('frontend')).toBeInTheDocument()
  })

  it('uses a <span> element', () => {
    const { container } = render(ServiceBadge, {
      props: { serviceName: 'api' },
    })
    expect(container.querySelector('span.service-badge')).toBeTruthy()
  })

  it('has a title attribute', () => {
    const { container } = render(ServiceBadge, {
      props: { serviceName: 'auth-service' },
    })
    const badge = container.querySelector('span.service-badge')!
    expect(badge.getAttribute('title')).toBe('Service')
  })

  it('applies a background color via inline style', () => {
    const { container } = render(ServiceBadge, {
      props: { serviceName: 'payment' },
    })
    const badge = container.querySelector('span.service-badge') as HTMLElement
    // Color is set dynamically; just assert a non-empty background is applied
    expect(badge.style.background).not.toBe('')
  })

  it('renders different service names without error', () => {
    const names = ['frontend', 'backend', 'database', 'queue-worker']
    for (const name of names) {
      const { getByText } = render(ServiceBadge, {
        props: { serviceName: name },
      })
      expect(getByText(name)).toBeInTheDocument()
    }
  })
})
