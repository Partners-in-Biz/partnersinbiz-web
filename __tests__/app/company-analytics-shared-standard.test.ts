import fs from 'fs'
import path from 'path'

const root = process.cwd()

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

describe('company analytics shared standard', () => {
  it('uses one shared company analytics panel for admin and portal company detail', () => {
    const sharedPath = 'components/crm/CompanyAnalyticsPanel.tsx'
    const adminRoute = 'app/(admin)/admin/org/[slug]/crm/companies/[id]/page.tsx'
    const portalRoute = 'app/(portal)/portal/companies/[id]/page.tsx'

    expect(fs.existsSync(path.join(root, sharedPath))).toBe(true)

    const shared = read(sharedPath)
    const admin = read(adminRoute)
    const portal = read(portalRoute)

    expect(shared).toContain('export function CompanyAnalyticsPanel')
    expect(shared).toContain('Account operating brief')
    expect(shared).toContain('Risk signals')
    expect(shared).toContain('Review risk records')

    expect(admin).toContain("import { CompanyAnalyticsPanel")
    expect(portal).toContain("import { CompanyAnalyticsPanel")
    expect(admin).not.toContain('function AnalyticsPanel')
    expect(portal).not.toContain('function AnalyticsPanel')
  })
})
