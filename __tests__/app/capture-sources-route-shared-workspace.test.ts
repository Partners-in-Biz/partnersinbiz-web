import { readFileSync } from 'node:fs'
import path from 'node:path'

function routeSource(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('capture sources route shared workspace standard', () => {
  it('keeps portal and admin org capture-source routes on the shared workspace surface', () => {
    const adminSource = routeSource('app/(admin)/admin/org/[slug]/capture-sources/page.tsx')
    const portalSource = routeSource('app/(portal)/portal/capture-sources/page.tsx')

    expect(adminSource).toContain('@/components/capture-sources/CaptureSourcesWorkspace')
    expect(portalSource).toContain('@/components/capture-sources/CaptureSourcesWorkspace')
    expect(adminSource).not.toContain('function SourceCard')
    expect(portalSource).not.toContain('function SourceCard')
    expect(adminSource).not.toContain('const TYPE_STYLES')
    expect(portalSource).not.toContain('const TYPE_STYLES')
    expect(adminSource).not.toContain('confirm(')
    expect(portalSource).not.toContain('confirm(')
  })
})
