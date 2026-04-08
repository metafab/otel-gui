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
  },
  preview: {
    port: 4318, // Standard OTLP/HTTP port
  },
})
