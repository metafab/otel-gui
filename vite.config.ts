import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    port: 4318, // Standard OTLP/HTTP port
  },
  preview: {
    port: 4318, // Standard OTLP/HTTP port
  },
})
