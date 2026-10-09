/**
 * Generates the tiny CJS SEA launcher at dist/sea-launcher.cjs.
 *
 * The launcher uses import() to load the ESM SvelteKit server from the
 * filesystem at runtime — no bundling, no TLA transformation needed.
 * Node 22 guarantee: __dirname in the injected CJS = directory of the binary.
 *
 * Usage:  pnpm run sea:bundle   (run `pnpm run build` first)
 * Output: dist/sea-launcher.cjs
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

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
const { spawn } = require('node:child_process');
const APP_VERSION = ${JSON.stringify(version)};
const argv = process.argv.slice(1);

if (argv.includes('-v') || argv.includes('--version')) {
  process.stdout.write('otel-gui ' + APP_VERSION + '\\n');
  process.stdout.write(
    'platform: ' + process.platform + ' ' + process.arch + '\\n',
  );
  process.stdout.write('runtime: node ' + process.version + '\\n');
  process.exit(0);
}
if (argv.includes('-h') || argv.includes('--help')) {
  process.stdout.write(
    [
      'otel-gui ' + APP_VERSION + ' - lightweight OpenTelemetry trace viewer',
      '',
      'Usage: otel-gui [options]',
      '',
      'Options:',
      '  -o, --open     Open the UI in your default browser on startup',
      '  -v, --version  Print version, platform and runtime details',
      '  -h, --help     Show this help',
      '',
      'Environment:',
      '  PORT           HTTP port to listen on (default: 4318)',
      '  HOST           Interface to bind to (default: 0.0.0.0)',
      '',
    ].join('\\n'),
  );
  process.exit(0);
}
// Default port to 4318 (OTLP/HTTP standard) if not already set
process.env.PORT ??= '4318';
// Open SSE streams never finish on their own; don't wait 30s (adapter-node default) on shutdown
process.env.SHUTDOWN_TIMEOUT ??= '1';
// Load the ESM SvelteKit server next to this binary via the ESM loader.
import(path.join(__dirname, 'build', 'index.js'))
  .then(() => {
    if (argv.includes('-o') || argv.includes('--open')) openBrowser();
  })
  .catch((err) => {
    process.stderr.write(
      '[otel-gui] Fatal startup error: ' + err.message + '\\n',
    );
    process.exit(1);
  });

function openBrowser() {
  const host = process.env.HOST;
  const hostname =
    !host || host === '0.0.0.0' || host === '::' ? 'localhost' : host;
  const url = 'http://' + hostname + ':' + process.env.PORT;
  const [cmd, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
  // Opening the browser is best-effort: never take the server down
  child.on('error', () => {
    process.stderr.write('[otel-gui] Could not open browser. Open ' + url + '\\n');
  });
  child.unref();
}
`

writeFileSync(join(root, 'dist', 'sea-launcher.cjs'), launcher)
console.log('✓ dist/sea-launcher.cjs written')
