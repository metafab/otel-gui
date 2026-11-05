import adapter from '@sveltejs/adapter-node'
import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig, type Plugin } from 'vite'
import { createRequire } from 'module'
import { markdownOptions } from './markdown.config.js'

const _require = createRequire(import.meta.url)
const pkg = _require('./package.json') as { version: string }

// SvelteKit runs the server `init` hook lazily on the first request in dev.
// Send one as soon as the dev server listens so the OTLP/gRPC receiver
// (started from `init` in hooks.server.ts) is up without opening the UI.
function warmupServerHooks(): Plugin {
  return {
    name: 'otel-gui:warmup-server-hooks',
    apply: 'serve',
    configureServer(server) {
      server.httpServer?.once('listening', () => {
        const url = server.resolvedUrls?.local[0]
        if (url) fetch(new URL('api/config', url)).catch(() => {})
      })
    },
  }
}

export default defineConfig({
  plugins: [
    sveltekit({
      adapter: adapter(),
      ...markdownOptions(),
    }),
    warmupServerHooks(),
  ],
  define: {
    'import.meta.env.PACKAGE_VERSION': JSON.stringify(pkg.version),
  },
  server: {
    port: 4318 /* Standard OTLP/HTTP port */,
    // Allow OTLP exporters reaching the dev server from Docker containers via
    // host.docker.internal — Vite otherwise 403s requests with a non-local Host.
    allowedHosts: ['host.docker.internal'],
  },
  preview: { port: 4318 /* Standard OTLP/HTTP port */ },
})
