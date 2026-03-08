import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveDynamicImportTarget } from './moduleImport'

describe('resolveDynamicImportTarget', () => {
  it('keeps package specifiers unchanged', () => {
    expect(
      resolveDynamicImportTarget('@otel-gui/enterprise-persistence/register'),
    ).toBe('@otel-gui/enterprise-persistence/register')
  })

  it('keeps file URLs unchanged', () => {
    const fileUrl = 'file:///tmp/register.js'
    expect(resolveDynamicImportTarget(fileUrl)).toBe(fileUrl)
  })

  it('resolves relative paths from process cwd', () => {
    const relative =
      '../otel-gui-enterprise/enterprise-persistence/dist/register.js'
    const expected = pathToFileURL(path.resolve(process.cwd(), relative)).href
    expect(resolveDynamicImportTarget(relative)).toBe(expected)
  })

  it('resolves absolute paths to file URLs', () => {
    const absolute = '/tmp/register.js'
    expect(resolveDynamicImportTarget(absolute)).toBe(
      pathToFileURL(absolute).href,
    )
  })
})
