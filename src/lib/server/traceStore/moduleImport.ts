import path from 'node:path'
import { pathToFileURL } from 'node:url'

export function resolveDynamicImportTarget(moduleId: string): string {
  if (moduleId.startsWith('file:')) return moduleId

  // Bare specifiers like package names should be resolved by Node as-is.
  if (
    !moduleId.startsWith('.') &&
    !moduleId.startsWith('/') &&
    !path.isAbsolute(moduleId)
  ) {
    return moduleId
  }

  const absolutePath = path.isAbsolute(moduleId)
    ? moduleId
    : path.resolve(process.cwd(), moduleId)

  return pathToFileURL(absolutePath).href
}
