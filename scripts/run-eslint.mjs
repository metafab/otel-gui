#!/usr/bin/env node
import { spawnSync } from 'node:child_process'

// Work around a Node 22.17.0 V8 crash seen when ESLint compiles and deserializes
// cached bytecode (fatal: "unreachable code"). Disabling the compile cache keeps
// lint stable in affected environments while preserving normal ESLint behavior.
const env = {
  ...process.env,
  NODE_DISABLE_COMPILE_CACHE: '1',
}

const result = spawnSync('pnpm', ['exec', 'eslint', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
})

if (result.error) {
  console.error(result.error)
  process.exit(1)
}

process.exit(result.status ?? 1)
