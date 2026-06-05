import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()

function source(relativePath: string) {
  return readFileSync(path.join(root, relativePath), 'utf8')
}

describe('properties shared workspace standard', () => {
  it('keeps admin and portal property routes on one shared workspace surface', () => {
    const sharedWorkspacePath = path.join(root, 'components/properties/PropertiesWorkspace.tsx')
    const adminRoute = source('app/(admin)/admin/properties/page.tsx')
    const portalRoute = source('app/(portal)/portal/properties/page.tsx')

    expect(existsSync(sharedWorkspacePath)).toBe(true)
    expect(source('components/properties/PropertiesWorkspace.tsx')).toContain('export function PropertiesWorkspace')

    expect(adminRoute).toContain('@/components/properties/PropertiesWorkspace')
    expect(adminRoute).toContain('surface="admin"')
    expect(portalRoute).toContain('@/components/properties/PropertiesWorkspace')
    expect(portalRoute).toContain('surface="portal"')

    for (const route of [adminRoute, portalRoute]) {
      expect(route).not.toContain('const STATUS_MAP')
      expect(route).not.toContain('function Skeleton')
      expect(route).not.toContain('interface PortalProperty')
      expect(route).not.toContain('interface PortalConnection')
      expect(route).not.toContain('const PROVIDER_LABEL')
      expect(route).not.toContain('const PROVIDER_ICON')
      expect(route).not.toContain('const STATUS_PILL')
      expect(route).not.toContain('const TYPE_ICON')
      expect(route).not.toContain('function StatusPill')
    }
  })
})
