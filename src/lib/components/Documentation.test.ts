// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/svelte'
import Documentation from './Documentation.svelte'

describe(Documentation, () => {
  it('renders the README with local image and API guide links', () => {
    const { container } = render(Documentation, {
      props: { document: 'readme' },
    })

    expect(
      screen.getByRole('heading', { name: 'otel-gui', level: 1 }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', {
        name: 'Connect an AI agent with MCP',
      }),
    ).toHaveAttribute('id', 'connect-an-ai-agent-with-mcp')
    expect(
      screen.getByRole('heading', { name: 'Sending Traces' }),
    ).toHaveAttribute('id', 'sending-traces')
    expect(screen.getByRole('link', { name: 'Quick start' })).toHaveAttribute(
      'href',
      '#quick-start',
    )
    expect(screen.getByRole('link', { name: 'Screenshots' })).toHaveAttribute(
      'href',
      '#screenshots',
    )
    expect(screen.getByRole('link', { name: 'Features' })).toHaveAttribute(
      'href',
      '#features',
    )
    expect(
      screen.getByRole('heading', { name: /Quick Start/ }),
    ).toHaveAttribute('id', 'quick-start')
    expect(
      screen.getByRole('heading', { name: /Screenshots/ }),
    ).toHaveAttribute('id', 'screenshots')
    expect(screen.getByRole('heading', { name: /Features/ })).toHaveAttribute(
      'id',
      'features',
    )
    expect(
      screen
        .getAllByRole('link', { name: 'HTTP API guide' })
        .every((link) => link.getAttribute('href') === '/docs/http-api'),
    ).toBe(true)
    expect(container.querySelector('img[alt="Trace list"]')).toHaveAttribute(
      'src',
      '/docs/screenshots/trace-list.png',
    )
    expect(container.querySelector('img[alt="otel-gui logo"]')).toHaveAttribute(
      'src',
      '/docs/logo.svg',
    )
  })

  it('renders the API guide with local README and OpenAPI links', () => {
    render(Documentation, {
      props: { document: 'http-api' },
    })

    expect(
      screen.getByRole('heading', {
        name: 'HTTP API for scripts and agents',
        level: 1,
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'OpenAPI specification' }),
    ).toHaveAttribute('href', '/openapi.yaml')
    expect(screen.getByRole('link', { name: 'MCP setup' })).toHaveAttribute(
      'href',
      '/docs#connect-an-ai-agent-with-mcp',
    )
  })
})
