import { readFileSync } from 'fs'
import path from 'path'

function routeSource(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('email domains route shared workspace standard', () => {
  it('keeps portal and admin org sender-domain routes on the shared workspace surface', () => {
    const adminSource = routeSource('app/(admin)/admin/org/[slug]/email-domains/page.tsx')
    const portalSource = routeSource('app/(portal)/portal/email-domains/page.tsx')

    expect(adminSource).toContain('@/components/email-domains/EmailDomainsWorkspace')
    expect(portalSource).toContain('@/components/email-domains/EmailDomainsWorkspace')
    expect(adminSource).toContain('adminDb')
    expect(adminSource).toContain('orgId={orgDoc.id}')
    expect(adminSource).not.toContain('useParams')
    expect(adminSource).not.toContain('function DomainCard')
    expect(portalSource).not.toContain('function DomainCard')
    expect(adminSource).not.toContain('confirm(')
    expect(portalSource).not.toContain('confirm(')
  })
})
