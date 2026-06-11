import fs from 'fs'
import path from 'path'

const repoRoot = process.cwd()

function source(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

describe('CRM contacts shared workspace standard', () => {
  it('keeps admin and portal contact list routes as adapters over the shared workspace', () => {
    const portalSource = source('app/(portal)/portal/contacts/page.tsx')

    for (const routeSource of [portalSource]) {
      expect(routeSource).toContain("@/components/crm/ContactsWorkspace")
      expect(routeSource).not.toContain('function StageBadge')
      expect(routeSource).not.toContain('function TypeBadge')
      expect(routeSource).not.toContain('function useInlineToast')
      expect(routeSource).not.toContain('/api/v1/crm/contacts')
      expect(routeSource).not.toContain('ContactsBulkCommandBar')
      expect(routeSource).not.toContain('ContactDuplicateCommandCenter')
    }

    expect(source('components/crm/ContactsWorkspace.tsx')).toMatch(/<SavedViewsBar[\s\S]*?orgScope=\{apiScope\}/)
  })

  it('keeps contact creation and editing on the shared CRM contact form', () => {
    const sharedFormPath = path.join(repoRoot, 'components/crm/ContactForm.tsx')
    const portalCompanyDetail = source('app/(portal)/portal/companies/[id]/page.tsx')
    const sharedContactsWorkspace = source('components/crm/ContactsWorkspace.tsx')

    expect(fs.existsSync(sharedFormPath)).toBe(true)

    for (const routeSource of [portalCompanyDetail, sharedContactsWorkspace]) {
      expect(routeSource).toContain('@/components/crm/ContactForm')
      expect(routeSource).not.toContain('@/components/admin/crm/ContactForm')
    }
  })
})
