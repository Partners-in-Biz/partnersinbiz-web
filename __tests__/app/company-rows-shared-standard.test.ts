import fs from 'fs'
import path from 'path'

const root = process.cwd()

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

describe('company rows shared standard', () => {
  it('uses one shared company rows panel for admin and portal company detail records', () => {
    const sharedPath = 'components/crm/CompanyRowsPanel.tsx'
    const adminRoute = 'app/(admin)/admin/org/[slug]/crm/companies/[id]/page.tsx'
    const portalRoute = 'app/(portal)/portal/companies/[id]/page.tsx'

    expect(fs.existsSync(path.join(root, sharedPath))).toBe(true)

    const shared = read(sharedPath)
    const admin = read(adminRoute)
    const portal = read(portalRoute)

    expect(shared).toContain('export function CompanyRowsPanel')
    expect(shared).toContain('All statuses')
    expect(shared).toContain('Active + archived')
    expect(shared).toContain('Status not set')

    expect(admin).toContain("import { CompanyRowsPanel")
    expect(portal).toContain("import { CompanyRowsPanel")
    expect(admin).not.toContain('function SimpleRowsPanel')
    expect(portal).not.toContain('function SimpleRowsPanel')
  })
})
