import { existsSync, readFileSync } from 'fs'
import path from 'path'

const root = process.cwd()

function source(file: string) {
  return readFileSync(path.join(root, file), 'utf8')
}

describe('client documents admin and portal boundary', () => {
  it('keeps admin org documents on governance while portal documents use the client workspace', () => {
    const sharedPath = path.join(root, 'components/client-documents/ClientDocumentsWorkspace.tsx')
    const adminRoute = source('app/(admin)/admin/org/[slug]/documents/page.tsx')
    const portalRoute = source('app/(portal)/portal/documents/page.tsx')
    const governancePath = path.join(root, 'components/client-documents/AdminDocumentsGovernanceWorkspace.tsx')

    expect(existsSync(sharedPath)).toBe(true)
    expect(existsSync(governancePath)).toBe(true)
    expect(source('components/client-documents/ClientDocumentsWorkspace.tsx')).toContain(
      'export function ClientDocumentsWorkspace',
    )

    expect(adminRoute).toContain('@/components/client-documents/AdminDocumentsGovernanceWorkspace')
    expect(adminRoute).toContain('<AdminDocumentsGovernanceWorkspace')
    expect(adminRoute).toContain('orgSlug={slug}')
    expect(adminRoute).not.toContain('ClientDocumentsWorkspace')

    expect(portalRoute).toContain('@/components/client-documents/ClientDocumentsWorkspace')
    expect(portalRoute).toContain('<ClientDocumentsWorkspace surface="portal"')
    expect(portalRoute).not.toContain('@/components/client-documents/DocumentIndex')
    expect(portalRoute).not.toContain('fetch(')
  })

  it('keeps admin document governance about permissions, templates, and document-owner settings', () => {
    const governance = source('components/client-documents/AdminDocumentsGovernanceWorkspace.tsx')

    expect(governance).toContain('Document governance')
    expect(governance).toContain('Who can use documents')
    expect(governance).toContain('Default templates plus organisation custom templates')
    expect(governance).toContain('What document owners control inside a document')
    expect(governance).toContain('Create share links')
  })
})
