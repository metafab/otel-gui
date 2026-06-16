import type { TraceStore } from '$lib/types'
import { createInternalTraceStore } from './core'

export function createMemoryTraceStore(config: {
  maxTraces: number
  maxLogs: number
}): TraceStore {
  return createInternalTraceStore(config.maxTraces, config.maxLogs)
}
