import fs from 'fs'
import path from 'path'

const repoRoot = process.cwd()

function source(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

describe('CRM contacts shared workspace standard', () => {
  it('keeps admin and portal contact list routes as adapters over the shared workspace', () => {
    const adminSource = source('app/(admin)/admin/crm/contacts/page.tsx')
    const portalSource = source('app/(portal)/portal/contacts/page.tsx')

    for (const routeSource of [adminSource, portalSource]) {
      expect(routeSource).toContain("@/components/crm/ContactsWorkspace")
      expect(routeSource).not.toContain('function StageBadge')
      expect(routeSource).not.toContain('function TypeBadge')
      expect(routeSource).not.toContain('function useInlineToast')
      expect(routeSource).not.toContain('/api/v1/crm/contacts')
      expect(routeSource).not.toContain('ContactsBulkCommandBar')
      expect(routeSource).not.toContain('ContactDuplicateCommandCenter')
    }
  })
})
