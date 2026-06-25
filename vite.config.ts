import { fileURLToPath } from 'url'
import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vite'
import { createRequire } from 'module'

const _require = createRequire(import.meta.url)
const pkg = _require('./package.json') as { version: string }

export default defineConfig({
  plugins: [sveltekit()],
  resolve: {
    alias: {
      // Resolve @otel-gui/core from TypeScript source during dev/build
      // — avoids needing a separate compile step for the sub-package
      '@otel-gui/core': fileURLToPath(
        new URL('./packages/core/src/index.ts', import.meta.url),
      ),
    },
  },
  define: {
    'import.meta.env.PACKAGE_VERSION': JSON.stringify(pkg.version),
  },
  server: {
    port: 4318, // Standard OTLP/HTTP port
    // Allow OTLP exporters reaching the dev server from Docker containers via
    // host.docker.internal — Vite otherwise 403s requests with a non-local Host.
    allowedHosts: ['host.docker.internal'],
  },
  preview: {
    port: 4318, // Standard OTLP/HTTP port
  },
})
