import { readFileSync } from 'fs'
import * as path from 'path'

const root = process.cwd()

function source(file: string) {
  return readFileSync(path.join(root, file), 'utf8')
}

describe('admin knowledge and deliverable surfaces', () => {
  it('labels document admin surfaces as internal until explicit client review or share gates', () => {
    const workspace = source('components/client-documents/ClientDocumentsWorkspace.tsx')
    const newPage = source('app/(admin)/admin/org/[slug]/documents/new/page.tsx')
    const detailPage = source('app/(admin)/admin/org/[slug]/documents/[id]/page.tsx')
    const previewPage = source('app/(admin)/admin/org/[slug]/documents/[id]/preview/page.tsx')
    const previewFrame = source('components/client-documents/PreviewFrame.tsx')

    expect(workspace).toContain('Internal drafting/review workspace')
    expect(workspace).toContain('Client-visible only after approval gate')
    expect(newPage).toContain('Creates an internal draft')
    expect(detailPage).toContain('Send for client review')
    expect(detailPage).toContain('acknowledgeMultiOrgPublish: true')
    expect(previewPage).toContain('Admin preview only')
    expect(previewFrame).toContain('Client-facing share link')
  })

  it('labels research admin surfaces as internal working intelligence before client-visible conversion', () => {
    const listPage = source('app/(admin)/admin/org/[slug]/research/page.tsx')
    const governanceWorkspace = source('components/research/AdminResearchGovernanceWorkspace.tsx')
    const detailClient = source('components/research/ResearchDetailClient.tsx')

    expect(listPage).toContain('AdminResearchGovernanceWorkspace')
    expect(listPage).not.toContain('ResearchListClient')
    expect(governanceWorkspace).toContain('Research governance')
    expect(governanceWorkspace).toContain('Who can use research')
    expect(governanceWorkspace).toContain('Default research types plus organisation custom types')
    expect(governanceWorkspace).toContain('What research owners control inside a research item')
    expect(governanceWorkspace).toContain('Convert research to client documents')
    expect(governanceWorkspace).toContain('Mark research client-visible')
    expect(detailClient).toContain('Research remains internal')
    expect(detailClient).toContain('Create client document draft')
    expect(detailClient).toContain('Client-visible research')
  })

  it('labels admin wiki and intelligence routes as internal knowledge surfaces, not client publishing', () => {
    const wikiPage = source('app/(admin)/admin/org/[slug]/wiki/page.tsx')
    const intelligencePage = source('app/(admin)/admin/org/[slug]/intelligence/page.tsx')

    expect(wikiPage).toContain('Internal agent knowledge base')
    expect(wikiPage).toContain('not a client-facing approval or publishing surface')
    expect(intelligencePage).toContain('Internal intelligence')
    expect(intelligencePage).toContain('client-visible report still requires a document/review approval gate')
    expect(intelligencePage).not.toContain('shareable outputs')
  })
})
