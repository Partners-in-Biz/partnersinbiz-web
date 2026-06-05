import fs from 'fs'
import path from 'path'

const root = process.cwd()

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

describe('company workspace scoped routing standard', () => {
  it('keeps company workspace handoff links scoped to the linked organisation', () => {
    const source = read('app/(portal)/portal/companies/[id]/page.tsx')

    expect(source).toContain("from '@/lib/portal/scoped-routing'")
    expect(source).toContain('scopeFromSearchParams')
    expect(source).toContain('scopedApiPath')
    expect(source).toContain('companyApiPath')
    expect(source).toContain('scopedWorkspaceHref')
    expect(source).toContain('companyApiPath(`/api/v1/crm/companies/${id}`)')
    expect(source).toContain('companyApiPath(`/api/v1/crm/companies/${nextCompanyId}/command-center?limit=100`)')
    expect(source).toContain("hrefFor={(row) => scopedWorkspaceHref(`/portal/projects/${row.id}`)}")
    expect(source).toContain("hrefFor={(row) => scopedWorkspaceHref(`/portal/documents/${row.id}`)}")
    expect(source).toMatch(/<CompanyEditDrawer[\s\S]*?orgScope=\{orgScope\}/)
    expect(source).toMatch(/<DealDrawer[\s\S]*?orgScope=\{orgScope\}/)
  })
})
