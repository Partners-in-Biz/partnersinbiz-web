import { existsSync, readFileSync } from 'fs'
import path from 'path'

const root = process.cwd()

function source(file: string) {
  return readFileSync(path.join(root, file), 'utf8')
}

describe('client documents shared workspace standard', () => {
  it('keeps admin org and portal document list routes on one shared workspace', () => {
    const sharedPath = path.join(root, 'components/client-documents/ClientDocumentsWorkspace.tsx')
    const adminRoute = source('app/(admin)/admin/org/[slug]/documents/page.tsx')
    const portalRoute = source('app/(portal)/portal/documents/page.tsx')

    expect(existsSync(sharedPath)).toBe(true)
    expect(source('components/client-documents/ClientDocumentsWorkspace.tsx')).toContain(
      'export function ClientDocumentsWorkspace',
    )

    for (const route of [adminRoute, portalRoute]) {
      expect(route).toContain('@/components/client-documents/ClientDocumentsWorkspace')
      expect(route).not.toContain('@/components/client-documents/DocumentIndex')
      expect(route).not.toContain('useEffect')
      expect(route).not.toContain('useState')
      expect(route).not.toContain('CLIENT_STATUSES')
      expect(route).not.toContain('STATUS_TABS')
      expect(route).not.toContain('partyLabels')
      expect(route).not.toContain('fetch(')
    }
  })
})
