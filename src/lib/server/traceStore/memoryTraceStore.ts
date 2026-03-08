import type { TraceStore } from '$lib/types'
import { createInternalTraceStore } from './core'

export function createMemoryTraceStore(config: {
  maxTraces: number
}): TraceStore {
  return createInternalTraceStore(config.maxTraces)
}
