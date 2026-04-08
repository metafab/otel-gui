import adapter from '@sveltejs/adapter-node'

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter(),
    alias: {
      '@otel-gui/core': './packages/core/src/index.ts',
    },
  },
}

export default config
