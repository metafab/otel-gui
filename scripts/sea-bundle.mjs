/**
 * Generates the tiny CJS SEA launcher at dist/sea-launcher.cjs.
 *
 * The launcher uses import() to load the ESM SvelteKit server from the
 * filesystem at runtime — no bundling, no TLA transformation needed.
 * Node 22 guarantee: __dirname in the injected CJS = directory of the binary.
 *
 * When Vite 8 ships with Rolldown, this step remains unchanged.
 *
 * Usage:  pnpm run sea:bundle   (run `pnpm run build` first)
 * Output: dist/sea-launcher.cjs
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

if (!existsSync(join(root, 'build', 'index.js'))) {
  console.error('build/index.js not found. Run `pnpm run build` first.')
  process.exit(1)
}

mkdirSync(join(root, 'dist'), { recursive: true })

// In a Node 22 SEA binary, require() is restricted to built-in modules but
// import() uses the standard ESM loader and CAN read files from the filesystem.
// __dirname = directory of the SEA binary at runtime (Node 22 SEA guarantee).
const launcher = `\
'use strict';
const path = require('node:path');
// Default port to 4318 (OTLP/HTTP standard) if not already set
process.env.PORT ??= '4318';
// Load the ESM SvelteKit server next to this binary via the ESM loader.
import(path.join(__dirname, 'build', 'index.js')).catch((err) => {
  process.stderr.write('[otel-gui] Fatal startup error: ' + err.message + '\\n');
  process.exit(1);
});
`

writeFileSync(join(root, 'dist', 'sea-launcher.cjs'), launcher)
console.log('✓ dist/sea-launcher.cjs written')
