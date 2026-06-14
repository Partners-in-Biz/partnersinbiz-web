import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function source(relativePath: string) {
  return readFileSync(join(root, relativePath), 'utf8')
}

function stringLiterals(fileSource: string) {
  return Array.from(fileSource.matchAll(/(['"`])((?:\\.|(?!\1).)*?)\1/g), (match) => match[2])
}

describe('admin operator shell contract', () => {
  it('keeps the top-level admin routes on admin/operator destinations, not portal self-service routes', () => {
    const adminRouteFiles = [
      'app/(admin)/admin/dashboard/page.tsx',
      'app/(admin)/admin/settings/page.tsx',
      'app/(admin)/admin/settings/api-keys/page.tsx',
      'app/(admin)/admin/updates/page.tsx',
      'components/admin/navConfig.ts',
    ]

    for (const file of adminRouteFiles) {
      const literals = stringLiterals(source(file))
      expect(literals.filter((value) => value.startsWith('/portal'))).toEqual([])
      expect(source(file)).not.toMatch(/href=\"\/portal|router\.push\(['"]\/portal|redirect\(['"]\/portal/)
    }
  })

  it('makes the only admin-to-portal action explicit, admin-labelled, and access checked', () => {
    const portalSwitch = source('components/admin/PortalViewSwitch.tsx')

    expect(portalSwitch).toContain("fetch('/api/v1/portal/orgs')")
    expect(portalSwitch).toContain("fetch('/api/v1/portal/active-org'")
    expect(portalSwitch).toContain('Open client portal as admin')
    expect(portalSwitch).not.toContain('Switch to portal view')
    expect(portalSwitch).not.toContain('Portal view')
  })

  it('keeps admin route fallbacks on existing admin pages', () => {
    const dashboardLinks = source('lib/admin/dashboard-links.ts')
    const dashboard = source('app/(admin)/admin/dashboard/page.tsx')

    expect(dashboardLinks).toContain("'/admin/agents'")
    expect(dashboard).toContain("'/admin/organizations'")
    expect(dashboard).not.toContain("'/admin/clients'")
  })
})
