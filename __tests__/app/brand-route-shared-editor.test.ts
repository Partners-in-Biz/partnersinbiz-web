import { readFileSync } from 'node:fs'
import path from 'node:path'

function routeSource(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('brand route shared editor standard', () => {
  it('keeps portal and admin org brand routes on the shared editor surface', () => {
    const adminSource = routeSource('app/(admin)/admin/org/[slug]/brand/page.tsx')
    const portalSource = routeSource('app/(portal)/portal/branding/page.tsx')

    expect(adminSource).toContain('@/components/brand/BrandProfileEditor')
    expect(portalSource).toContain('@/components/brand/BrandProfileEditor')
    expect(adminSource).not.toContain('const COLOR_DEFS =')
    expect(portalSource).not.toContain('const COLOR_DEFS =')
    expect(adminSource).not.toContain('function TagToggle')
    expect(portalSource).not.toContain('function TagToggle')
  })
})
