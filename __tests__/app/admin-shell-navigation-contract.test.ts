import { readFileSync } from 'fs'
import * as path from 'path'
import { OPERATOR_NAV, OPERATOR_NAV_TOPBAR, workspaceNav } from '@/components/admin/navConfig'

const root = process.cwd()
const source = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8')

const adminShellContractFiles = [
  'app/(admin)/layout.tsx',
  'app/(admin)/admin/page.tsx',
  'app/(admin)/admin/dashboard/page.tsx',
  'app/(admin)/admin/settings/page.tsx',
  'app/(admin)/admin/settings/api-keys/page.tsx',
  'app/(admin)/admin/updates/page.tsx',
  'components/admin/AdminShell.tsx',
  'components/admin/AdminSidebar.tsx',
  'components/admin/AdminTopbar.tsx',
  'components/admin/AdminTopbarNav.tsx',
  'components/admin/navConfig.ts',
  'lib/admin/dashboard-links.ts',
]

describe('admin shell navigation route contract', () => {
  it('keeps default admin shell destinations on admin/operator routes', () => {
    const navItems = [...OPERATOR_NAV, ...OPERATOR_NAV_TOPBAR, ...workspaceNav('acme-org')]

    for (const item of navItems) {
      expect(item.href).toMatch(/^\/admin(\/|$)/)
      expect(item.href).not.toMatch(/^\/portal(\/|$)/)
      for (const child of item.children ?? []) {
        expect(child.href).toMatch(/^\/admin(\/|$)/)
        expect(child.href).not.toMatch(/^\/portal(\/|$)/)
      }
    }
  })

  it('does not expose portal defaults or client self-service wording in admin shell files', () => {
    const combined = adminShellContractFiles.map((file) => source(file)).join('\n')

    expect(combined).not.toContain('/admin/clients')
    expect(combined).not.toMatch(/client workspace/i)
    expect(combined).not.toMatch(/client workspaces/i)
    expect(combined).not.toMatch(/client-specific operations/i)
    expect(combined).not.toMatch(/client fleet/i)
    expect(combined).not.toMatch(/client view/i)
    expect(combined).not.toMatch(/switch to portal view/i)
    expect(combined).not.toMatch(/portal view/i)
    expect(combined).not.toMatch(/href=["']\/portal/)
    expect(combined).not.toMatch(/redirect\(["']\/portal/)
    expect(combined).not.toMatch(/router\.push\(["']\/portal/)
  })

  it('limits portal opening to the explicit admin-labelled and permission-gated portal switch', () => {
    const portalSwitch = source('components/admin/PortalViewSwitch.tsx')

    expect(portalSwitch).toContain('Open client portal as admin')
    expect(portalSwitch).toContain("fetch('/api/v1/portal/orgs')")
    expect(portalSwitch).toContain("fetch('/api/v1/portal/active-org'")
    expect(portalSwitch).toContain("router.push('/portal/dashboard')")
  })
})
