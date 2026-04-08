import { env } from '$env/dynamic/private'
import {
  getTraceStoreBackend,
  registerTraceStoreBackend,
  type PersistenceStatus,
  type TraceStoreBackendModule,
  type TraceStoreWithPersistenceStatus,
} from '$lib/server/traceStore/backends'
import { resolveDynamicImportTarget } from '$lib/server/traceStore/moduleImport'

function resolveMaxTraces(): number {
  const raw = env.OTEL_GUI_MAX_TRACES
  if (raw === undefined || raw === '') return 1000
  const parsed = Number.parseInt(raw, 10)
  if (Number.isNaN(parsed) || parsed < 1 || parsed > 10_000) {
    console.warn(
      `[otel-gui] Invalid OTEL_GUI_MAX_TRACES="${raw}". Must be an integer between 1 and 10000. Falling back to 1000.`,
    )
    return 1000
  }
  return parsed
}

function resolvePersistenceMode(): 'memory' | 'pglite' {
  const raw = env.OTEL_GUI_PERSISTENCE_MODE
  if (raw === undefined || raw === '') return 'memory'
  if (raw === 'memory' || raw === 'pglite') return raw
  console.warn(
    `[otel-gui] Invalid OTEL_GUI_PERSISTENCE_MODE="${raw}". Must be "memory" or "pglite". Falling back to "memory".`,
  )
  return 'memory'
}

function resolvePersistencePath(): string {
  const raw = env.OTEL_GUI_PERSISTENCE_PATH
  if (raw === undefined || raw === '') return '.otel-gui/pglite'
  return raw
}

function resolveFlushMs(): number {
  const raw = env.OTEL_GUI_PERSISTENCE_FLUSH_MS
  if (raw === undefined || raw === '') return 750
  const parsed = Number.parseInt(raw, 10)
  if (Number.isNaN(parsed) || parsed < 50 || parsed > 60_000) {
    console.warn(
      `[otel-gui] Invalid OTEL_GUI_PERSISTENCE_FLUSH_MS="${raw}". Must be an integer between 50 and 60000. Falling back to 750.`,
    )
    return 750
  }
  return parsed
}

const maxTraces = resolveMaxTraces()
const persistenceMode = resolvePersistenceMode()
const persistencePath = resolvePersistencePath()
const flushMs = resolveFlushMs()
const persistenceBackendModule = resolvePersistenceBackendModule()

let externalBackendLoadError: string | null = null
let backendInitError: string | null = null

function isMissingBackendModuleError(error: unknown): boolean {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
  ) {
    const code = (error as { code: string }).code
    if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') {
      return true
    }
  }

  if (error instanceof Error) {
    return /Cannot find module|Cannot find package/i.test(error.message)
  }

  return false
}

function resolveBackendInitErrorCode(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
  ) {
    return (error as { code: string }).code
  }

  if (
    error instanceof Error &&
    error.message.startsWith('license-check-failed:')
  ) {
    return (
      error.message.slice('license-check-failed:'.length) ||
      'backend-initialization-failed'
    )
  }

  return 'backend-initialization-failed'
}

function isExpectedBackendInitFallback(error: unknown): boolean {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
  ) {
    const code = (error as { code: string }).code
    if (code.startsWith('license-')) return true
  }

  if (error instanceof Error) {
    if (error.message.startsWith('license-check-failed:')) return true
    if (
      error.name === 'RuntimeError' &&
      /Aborted\(\)\. Build with -sASSERTIONS/i.test(error.message)
    ) {
      return true
    }
  }

  return false
}

function resolvePersistenceBackendModule(): string | null {
  const raw = env.OTEL_GUI_PERSISTENCE_BACKEND_MODULE
  if (raw === undefined || raw === '') return null
  return raw
}

function hydrateProcessEnvForExternalBackends(): void {
  // External modules may read license settings from process.env directly.
  const mappings: Array<[key: string, value: string | undefined]> = [
    ['OTEL_GUI_LICENSE_KEY', env.OTEL_GUI_LICENSE_KEY],
    ['OTEL_GUI_LICENSE_PUBLIC_KEY_PEM', env.OTEL_GUI_LICENSE_PUBLIC_KEY_PEM],
    ['OTEL_GUI_LICENSE_PUBLIC_KEY_PATH', env.OTEL_GUI_LICENSE_PUBLIC_KEY_PATH],
    ['OTEL_GUI_LICENSE_CLOCK_SKEW_SEC', env.OTEL_GUI_LICENSE_CLOCK_SKEW_SEC],
  ]

  for (const [key, value] of mappings) {
    if (
      (process.env[key] === undefined || process.env[key] === '') &&
      value !== undefined &&
      value !== ''
    ) {
      process.env[key] = value
    }
  }
}

async function loadExternalBackends(): Promise<void> {
  if (!persistenceBackendModule) return
  hydrateProcessEnvForExternalBackends()
  const importTarget = resolveDynamicImportTarget(persistenceBackendModule)

  try {
    const loaded = (await import(
      /* @vite-ignore */ importTarget
    )) as Partial<TraceStoreBackendModule>
    const register = loaded.registerTraceStoreBackends
    if (typeof register === 'function') {
      await register({ registerTraceStoreBackend })
      externalBackendLoadError = null
      return
    }

    externalBackendLoadError = 'backend-module-invalid-export'

    console.warn(
      `[otel-gui] Persistence backend module "${persistenceBackendModule}" loaded but did not export registerTraceStoreBackends().`,
    )
  } catch (error) {
    externalBackendLoadError = 'backend-module-load-failed'
    if (isMissingBackendModuleError(error)) {
      console.info(
        `[otel-gui] Optional persistence backend module "${persistenceBackendModule}" was not found. Using built-in backends (memory mode in OSS).`,
      )
      return
    }

    console.error(
      `[otel-gui] Failed to load persistence backend module "${persistenceBackendModule}". Falling back to built-in backends.`,
      error,
    )
  }
}

function resolveUnavailableReason(): string {
  if (backendInitError) return backendInitError
  if (externalBackendLoadError) return externalBackendLoadError
  if (persistenceBackendModule) return 'backend-not-registered-by-module'
  return 'backend-unavailable-in-oss-build'
}

let persistenceStatus: PersistenceStatus = {
  mode: persistenceMode,
  enabled: false,
  backend: null,
  path: persistenceMode === 'pglite' ? persistencePath : null,
  flushMs: persistenceMode === 'pglite' ? flushMs : null,
  lastRestoreAt: null,
  restoredTraceCount: 0,
  pendingFlushCount: 0,
  unavailableReason: null,
}

async function createTraceStore(): Promise<TraceStoreWithPersistenceStatus> {
  await loadExternalBackends()

  const backend = getTraceStoreBackend(persistenceMode)

  if (backend) {
    try {
      const store = await backend({
        maxTraces,
        persistencePath,
        flushMs,
      })
      backendInitError = null
      persistenceStatus = store.getPersistenceStatus?.() ?? {
        mode: persistenceMode,
        enabled: false,
        backend: null,
        path: persistenceMode === 'pglite' ? persistencePath : null,
        flushMs: persistenceMode === 'pglite' ? flushMs : null,
        lastRestoreAt: null,
        restoredTraceCount: 0,
        pendingFlushCount: 0,
        unavailableReason: null,
      }
      return store
    } catch (error) {
      backendInitError = resolveBackendInitErrorCode(error)
      if (isExpectedBackendInitFallback(error)) {
        console.info(
          `[otel-gui] ${persistenceMode} persistence is unavailable (${backendInitError}); using in-memory mode.`,
        )
      } else {
        console.error(
          `[otel-gui] Failed to initialize ${persistenceMode} persistence, using in-memory mode instead.`,
          error,
        )
      }
    }
  } else if (persistenceMode !== 'memory') {
    console.warn(
      `[otel-gui] Persistence backend "${persistenceMode}" is not available in this build. Falling back to in-memory mode.`,
    )
  }

  const memoryBackend = getTraceStoreBackend('memory')
  if (!memoryBackend) {
    throw new Error('[otel-gui] Memory trace store backend is not registered.')
  }

  const memoryStore = await memoryBackend({
    maxTraces,
    persistencePath,
    flushMs,
  })
  persistenceStatus = {
    mode: persistenceMode,
    enabled: false,
    backend: null,
    path: persistenceMode === 'pglite' ? persistencePath : null,
    flushMs: persistenceMode === 'pglite' ? flushMs : null,
    lastRestoreAt: null,
    restoredTraceCount: 0,
    pendingFlushCount: 0,
    unavailableReason:
      persistenceMode !== 'memory' ? resolveUnavailableReason() : null,
  }
  return memoryStore
}

export const traceStore = await createTraceStore()

export function getPersistenceStatus(): PersistenceStatus {
  if (traceStore.getPersistenceStatus) {
    const runtimeStatus = traceStore.getPersistenceStatus()
    if (
      runtimeStatus.unavailableReason == null &&
      persistenceStatus.unavailableReason != null
    ) {
      return {
        ...runtimeStatus,
        unavailableReason: persistenceStatus.unavailableReason,
        mode: persistenceStatus.mode,
        path: persistenceStatus.path,
        flushMs: persistenceStatus.flushMs,
      }
    }
    return runtimeStatus
  }
  return persistenceStatus
}

export { registerTraceStoreBackend }
