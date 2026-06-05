import { readFileSync } from 'fs'
import path from 'path'

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('mobile apps shared workspace standard', () => {
  it('keeps portal and admin org mobile-app routes thin and shares the app workspace shell', () => {
    const adminRoute = source('app/(admin)/admin/org/[slug]/mobile-apps/page.tsx')
    const portalRoute = source('app/(portal)/portal/mobile-apps/page.tsx')

    expect(adminRoute).toContain('@/components/mobile-apps/MobileAppsAdminWorkspace')
    expect(adminRoute).toContain('adminDb')
    expect(adminRoute).toContain('orgId={orgDoc.id}')
    expect(adminRoute).not.toContain('useParams')
    expect(adminRoute).not.toContain('apps.map')
    expect(adminRoute).not.toContain('function Field')
    expect(adminRoute).not.toContain('function Metric')

    expect(portalRoute).toContain('@/components/mobile-apps/MobileAppsPortalWorkspace')
    expect(portalRoute).not.toContain('apps.map')
    expect(portalRoute).not.toContain('function Metric')

    const adminWorkspace = source('components/mobile-apps/MobileAppsAdminWorkspace.tsx')
    const portalWorkspace = source('components/mobile-apps/MobileAppsPortalWorkspace.tsx')
    const sharedShell = source('components/mobile-apps/MobileAppsWorkspaceShell.tsx')
    const sharedList = source('components/mobile-apps/MobileAppList.tsx')

    expect(sharedShell).toContain('export function MobileAppsWorkspaceShell')
    expect(adminWorkspace).toContain('@/components/mobile-apps/MobileAppList')
    expect(adminWorkspace).toContain('@/components/mobile-apps/MobileAppsWorkspaceShell')
    expect(adminWorkspace).not.toContain('Digital presence</p>')
    expect(adminWorkspace).not.toContain('Apps</p><p')
    expect(adminWorkspace).not.toContain('Portal</p><p')
    expect(portalWorkspace).toContain('@/components/mobile-apps/MobileAppList')
    expect(portalWorkspace).toContain('@/components/mobile-apps/MobileAppsWorkspaceShell')
    expect(portalWorkspace).not.toContain('Digital presence</p>')
    expect(portalWorkspace).not.toContain('app{apps.length === 1')
    expect(sharedList).toContain('export function MobileAppList')
  })
})
