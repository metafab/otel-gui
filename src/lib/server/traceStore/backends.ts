import type { TraceStore } from '$lib/types'
import { createMemoryTraceStore } from '$lib/server/traceStore/memoryTraceStore'

export type PersistenceMode = 'memory' | 'pglite'

export interface PersistenceStatus {
  mode: PersistenceMode
  enabled: boolean
  backend: 'pglite' | null
  path: string | null
  flushMs: number | null
  lastRestoreAt: string | null
  restoredTraceCount: number
  pendingFlushCount: number
  unavailableReason?: string | null
}

export interface TraceStoreBackendConfig {
  maxTraces: number
  persistencePath: string
  flushMs: number
}

export interface TraceStoreWithPersistenceStatus extends TraceStore {
  getPersistenceStatus?: () => PersistenceStatus
}

type TraceStoreBackendFactory = (
  config: TraceStoreBackendConfig,
) => Promise<TraceStoreWithPersistenceStatus>

export interface TraceStoreBackendRegistrar {
  registerTraceStoreBackend: typeof registerTraceStoreBackend
}

export interface TraceStoreBackendModule {
  registerTraceStoreBackends(
    registrar: TraceStoreBackendRegistrar,
  ): void | Promise<void>
}

const backendFactories = new Map<PersistenceMode, TraceStoreBackendFactory>()

backendFactories.set('memory', async (config) => {
  const store = createMemoryTraceStore({ maxTraces: config.maxTraces })
  return {
    ...store,
    getPersistenceStatus: () => ({
      mode: 'memory',
      enabled: false,
      backend: null,
      path: null,
      flushMs: null,
      lastRestoreAt: null,
      restoredTraceCount: 0,
      pendingFlushCount: 0,
      unavailableReason: null,
    }),
  }
})

export function registerTraceStoreBackend(
  mode: PersistenceMode,
  factory: TraceStoreBackendFactory,
): void {
  backendFactories.set(mode, factory)
}

export function getTraceStoreBackend(
  mode: PersistenceMode,
): TraceStoreBackendFactory | undefined {
  return backendFactories.get(mode)
}
