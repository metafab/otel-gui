import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vite'
import { createRequire } from 'module'

const _require = createRequire(import.meta.url)
const pkg = _require('./package.json') as { version: string }

export default defineConfig({
  plugins: [sveltekit()],
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
