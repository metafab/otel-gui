/**
 * Produces a Node SEA (Single Executable Application) binary for the
 * selected target platform. Requires Node.js 22 and dist/sea-launcher.cjs
 * (run `pnpm run sea:bundle` first, or `pnpm run sea:package` for both).
 *
 * How it works:
 *   The injected CJS launcher uses import() to load the ESM SvelteKit server
 *   from the filesystem at runtime. In a Node 22 SEA binary __dirname = the
 *   binary's directory, and import() uses the standard ESM loader (unrestricted).
 *
 * Distribution layout (keep all three items together):
 *   otel-gui[.exe]  — SEA binary (Node 22 runtime + injected CJS launcher)
 *   build/          — SvelteKit adapter-node output (server + pre-built UI)
 *   proto/          — OTLP proto definitions loaded by protobufjs at runtime
 *
 * Usage:
 *   pnpm run sea:package:binary
 *   pnpm run sea:package:target -- --target linux-x64
 *   pnpm run sea:package:target -- --target linux-arm64 --node-binary /path/to/node
 * Output: dist/binaries/otel-gui-<platform>/
 */
import { createRequire } from 'node:module'
import { readFileSync, copyFileSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync, execFileSync } from 'node:child_process'
import { platform, arch } from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const launcher = join(root, 'dist', 'sea-launcher.cjs')
if (!existsSync(launcher)) {
  console.error('dist/sea-launcher.cjs not found. Run `pnpm run sea:bundle` first.')
  process.exit(1)
}

function parseArgs(argv) {
  const args = { target: null, nodeBinary: null }

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (token === '--target') {
      args.target = argv[i + 1] ?? null
      i++
      continue
    }
    if (token.startsWith('--target=')) {
      args.target = token.slice('--target='.length)
      continue
    }
    if (token === '--node-binary') {
      args.nodeBinary = argv[i + 1] ?? null
      i++
      continue
    }
    if (token.startsWith('--node-binary=')) {
      args.nodeBinary = token.slice('--node-binary='.length)
      continue
    }
  }

  return args
}

function toPlatformLabel(osName) {
  if (osName === 'darwin') return 'macos'
  if (osName === 'win32') return 'win'
  return 'linux'
}

function parseTarget(rawTarget) {
  const hostOs = platform()
  const hostCpu = arch()
  const hostLabel = toPlatformLabel(hostOs)
  const fallback = { os: hostOs, cpu: hostCpu, label: hostLabel }

  if (!rawTarget) return fallback

  const [label, cpu] = rawTarget.split('-')
  if (!label || !cpu) {
    throw new Error(
      `Invalid --target "${rawTarget}". Expected format: <linux|macos|win>-<x64|arm64>.`,
    )
  }

  if (!['linux', 'macos', 'win'].includes(label)) {
    throw new Error(
      `Unsupported target OS "${label}". Use one of: linux, macos, win.`,
    )
  }

  if (!['x64', 'arm64'].includes(cpu)) {
    throw new Error(
      `Unsupported target arch "${cpu}". Use one of: x64, arm64.`,
    )
  }

  const osName = label === 'macos' ? 'darwin' : label === 'win' ? 'win32' : 'linux'
  return { os: osName, cpu, label }
}

const args = parseArgs(process.argv.slice(2))
const target = parseTarget(args.target)

if ((target.os !== platform() || target.cpu !== arch()) && !args.nodeBinary) {
  console.error(
    `Cross-target requested (${target.label}-${target.cpu}) without --node-binary. ` +
      'Provide a target Node 22 binary path matching that OS/arch.',
  )
  process.exit(1)
}

const nodeBinarySource = args.nodeBinary ?? process.execPath
if (!existsSync(nodeBinarySource)) {
  console.error(`Node binary not found: ${nodeBinarySource}`)
  process.exit(1)
}

const platformName = `${target.label}-${target.cpu}`
const ext = target.os === 'win32' ? '.exe' : ''
const outDir = join(root, 'dist', 'binaries', `otel-gui-${platformName}`)
const binaryOut = join(outDir, `otel-gui${ext}`)
const blobPath = join(root, 'dist', 'sea-prep.blob')
const seaConfigPath = join(root, 'dist', 'sea-config.json')
const fuse = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'

// Clean up stale output from any previous run before creating the directory
if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

// 1. Write SEA config
writeFileSync(
  seaConfigPath,
  JSON.stringify({ main: launcher, output: blobPath, disableExperimentalSEAWarning: true }, null, 2),
)

// 2. Generate blob
console.log('→ Generating SEA blob...')
execFileSync(process.execPath, ['--experimental-sea-config', seaConfigPath], {
  cwd: root,
  stdio: 'inherit',
})

// 3. Copy Node binary and ensure it is writable
console.log(`→ Copying target Node binary: ${nodeBinarySource}`)
copyFileSync(nodeBinarySource, binaryOut)
if (platform() !== 'win32') {
  execSync(`chmod u+w "${binaryOut}"`)
}

// 4. Remove codesign on macOS (required before postject injection)
if (target.os === 'darwin' && platform() === 'darwin') {
  try {
    execSync(`codesign --remove-signature "${binaryOut}"`, { stdio: 'pipe' })
  } catch { /* unsigned builds are fine */ }
}

// 5. Inject blob using the postject JS API (avoids .bin shim compatibility issues)
console.log('→ Injecting SEA blob with postject...')
const req = createRequire(import.meta.url)
const postjectApiPath = req.resolve('postject')  // resolves to dist/api.js via package "main"
const { inject } = await import(postjectApiPath)
const blobBuffer = readFileSync(blobPath)
await inject(binaryOut, 'NODE_SEA_BLOB', blobBuffer, {
  sentinelFuse: fuse,
  machoSegmentName: target.os === 'darwin' ? 'NODE_SEA' : undefined,
})

// 6. Re-sign on macOS with ad-hoc signature
if (target.os === 'darwin' && platform() === 'darwin') {
  try {
    execSync(`codesign --sign - "${binaryOut}"`, { stdio: 'pipe' })
  } catch { /* ad-hoc signing may fail on older systems, binary still runs */ }
}

// 7. Copy runtime assets (must remain next to the binary)
console.log('→ Copying runtime assets...')
for (const [src, dest] of [
  [join(root, 'build'), join(outDir, 'build')],
  [join(root, 'proto'), join(outDir, 'proto')],
]) {
  if (existsSync(dest)) rmSync(dest, { recursive: true })
  cpSync(src, dest, { recursive: true })
}

console.log(`\n✓ ${outDir}/`)
console.log(`  otel-gui${ext}  — ${platformName} SEA binary (Node ${process.version})`)
console.log(`  build/          — SvelteKit server + pre-built UI`)
console.log(`  proto/          — OTLP proto definitions`)
console.log(`\nFrom that directory: PORT=4318 ./otel-gui${ext}`)
