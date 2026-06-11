import fs from 'fs'
import path from 'path'

const root = process.cwd()

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

describe('GEO SEO workspace detail shared standard', () => {
  it('keeps admin, admin-org, and portal workspace detail routes as shared detail adapters', () => {
    const sharedDetail = read('components/geo-seo/GeoSeoWorkspaceDetail.tsx')
    const dataLoader = read('lib/geo-seo/workspaces.ts')
    const adminOrgRoute = read('app/(admin)/admin/org/[slug]/geo-seo/workspaces/[id]/page.tsx')
    const portalRoute = read('app/(portal)/portal/geo-seo/workspaces/[id]/page.tsx')

    expect(sharedDetail).toContain('export function GeoSeoWorkspaceDetail')
    expect(dataLoader).toContain('export async function loadGeoSeoWorkspace')

    for (const route of [adminOrgRoute, portalRoute]) {
      expect(route).toContain("@/components/geo-seo/GeoSeoWorkspaceDetail")
      expect(route).toContain('loadGeoSeoWorkspace')
      expect(route).toContain('<GeoSeoWorkspaceDetail')
      expect(route).not.toContain('className="pib-card p-5"')
      expect(route).not.toContain('GEO score')
      expect(route).not.toContain('Client report actions gated')
    }

    expect(adminOrgRoute).toContain('surface="admin"')
    expect(adminOrgRoute).toContain('backHref={`/admin/org/${encodeURIComponent(slug)}/geo-seo`}')
    expect(portalRoute).toContain('surface="portal"')
    expect(portalRoute).toContain('scopedPortalPath')
    expect(portalRoute).toContain('orgScope={orgScope}')
  })
})
