import { OPERATOR_NAV_TOPBAR } from '@/components/admin/navConfig'

// Portal-first convergence (docs/system-designs/portal-first-convergence-spec.md §6):
// the admin topbar is the platform control plane ONLY. Work tools (email,
// social, CRM, campaigns, …) live in the portal; staff reach a tenant's
// workspace through admin/org/[slug]. This test locks that contract.
describe('admin nav config', () => {
  it('keeps the operator topbar control-plane only — no admin work-tool URLs', () => {
    const allHrefs: string[] = []
    for (const item of OPERATOR_NAV_TOPBAR) {
      allHrefs.push(item.href)
      for (const child of item.children ?? []) allHrefs.push(child.href)
    }

    const workToolPrefixes = [
      '/admin/email',
      '/admin/social',
      '/admin/crm',
      '/admin/campaigns',
      '/admin/sequences',
      '/admin/marketing',
      '/admin/seo',
      '/admin/briefings',
      '/admin/projects',
      '/admin/documents',
      '/admin/invoicing',
      '/admin/quotes',
    ]
    for (const href of allHrefs) {
      for (const prefix of workToolPrefixes) {
        expect(href.startsWith(prefix)).toBe(false)
      }
    }
  })

  it('exposes the control-plane sections', () => {
    const labels = OPERATOR_NAV_TOPBAR.map((item) => item.label)
    expect(labels).toEqual(
      expect.arrayContaining(['Home', 'Organisations', 'Agents', 'Support', 'Settings'])
    )
  })
})
