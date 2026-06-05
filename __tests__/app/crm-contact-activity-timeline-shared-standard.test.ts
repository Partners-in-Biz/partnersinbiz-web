import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('CRM contact activity timeline shared standard', () => {
  it('keeps admin and portal contact detail activity timelines on one shared CRM component', () => {
    const sharedPath = path.join(process.cwd(), 'components/crm/ContactActivityTimeline.tsx')
    const oldAdminPath = path.join(process.cwd(), 'components/admin/crm/ActivityTimeline.tsx')
    const adminRoute = source('app/(admin)/admin/crm/contacts/[id]/page.tsx')
    const portalRoute = source('app/(portal)/portal/contacts/[id]/page.tsx')

    expect(existsSync(sharedPath)).toBe(true)
    expect(existsSync(oldAdminPath)).toBe(false)
    expect(source('components/crm/ContactActivityTimeline.tsx')).toContain('export function ContactActivityTimeline')

    for (const route of [adminRoute, portalRoute]) {
      expect(route).toContain('@/components/crm/ContactActivityTimeline')
      expect(route).toContain('<ContactActivityTimeline')
      expect(route).not.toContain('@/components/admin/crm/ActivityTimeline')
      expect(route).not.toContain('Relationship timeline missing')
      expect(route).not.toContain('Relationship history missing')
    }
  })
})
