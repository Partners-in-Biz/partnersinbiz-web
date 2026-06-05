import fs from 'fs'
import path from 'path'

function source(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('scheduled content preview shared standard', () => {
  it('keeps admin and portal dashboards on a shared social preview component', () => {
    const sharedPath = path.join(process.cwd(), 'components/social/ScheduledContentPreviewCards.tsx')
    expect(fs.existsSync(sharedPath)).toBe(true)

    const shared = source('components/social/ScheduledContentPreviewCards.tsx')
    const adminDashboard = source('app/(admin)/admin/org/[slug]/dashboard/page.tsx')
    const portalDashboard = source('app/(portal)/portal/dashboard/page.tsx')
    const componentTest = source('__tests__/components/social/ScheduledContentPreviewCards.test.tsx')

    expect(shared).toContain('export function ScheduledContentPreviewCards')
    expect(adminDashboard).toContain('@/components/social/ScheduledContentPreviewCards')
    expect(portalDashboard).toContain('@/components/social/ScheduledContentPreviewCards')
    expect(componentTest).toContain('@/components/social/ScheduledContentPreviewCards')

    expect(adminDashboard).not.toContain('@/components/admin/ScheduledContentPreviewCards')
    expect(portalDashboard).not.toContain('@/components/admin/ScheduledContentPreviewCards')
  })
})
