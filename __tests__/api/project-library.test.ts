import { NextRequest } from 'next/server'

const mockGetCompany = jest.fn()
const mockGetProject = jest.fn()
const mockAdd = jest.fn()
const mockRemove = jest.fn()
const mockListIds = jest.fn()
let mockProjectDocs: Array<{ id: string; data: () => Record<string, unknown> }> = []
let mockUser = { uid: 'user-1', role: 'client', orgId: 'org-1', orgIds: ['org-1'] }

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: (req: NextRequest, user: typeof mockUser) => Promise<unknown> | unknown) => (req: NextRequest) => handler(req, mockUser),
}))
jest.mock('@/lib/api/orgScope', () => ({
  resolveOrgScope: (_user: unknown, orgId: string | null) => orgId === 'org-1'
    ? { ok: true, orgId: 'org-1' }
    : { ok: false, status: 403, error: 'Forbidden' },
}))
jest.mock('@/lib/companies/api-access', () => ({
  getAccessibleCompanyForUser: mockGetCompany,
}))
jest.mock('@/lib/projects/access', () => ({ getProjectForUser: mockGetProject, canAccessProject: () => true }))
jest.mock('@/lib/projects/user-library', () => ({
  addProjectToUserLibrary: mockAdd,
  removeProjectFromUserLibrary: mockRemove,
  listUserLibraryProjectIds: mockListIds,
}))
jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: jest.fn((name: string) => {
      if (name !== 'projects') throw new Error(`Unexpected collection ${name}`)
      return {
        where: () => ({ limit: () => ({ get: async () => ({ docs: mockProjectDocs }) }) }),
      }
    }),
  },
}))

describe('project library API', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockProjectDocs = []
    mockUser = { uid: 'user-1', role: 'client', orgId: 'org-1', orgIds: ['org-1'] }
    mockGetCompany.mockResolvedValue({ id: 'company-1', orgId: 'org-1', name: 'Acme' })
    mockListIds.mockResolvedValue([])
  })

  it('lists only projects for an accessible company and marks personal links', async () => {
    mockProjectDocs = [{
      id: 'project-1',
      data: () => ({ name: 'Acme Cowork', sourceOrgId: 'org-1', sourceCompanyId: 'company-1' }),
    }, {
      id: 'project-other',
      data: () => ({ name: 'Other Cowork', sourceOrgId: 'org-1', sourceCompanyId: 'company-other' }),
    }]
    mockListIds.mockResolvedValue(['project-1'])

    const { GET } = await import('@/app/api/v1/project-library/route')
    const response = await GET(new NextRequest('http://localhost/api/v1/project-library?orgId=org-1&companyId=company-1'))

    expect(response.status).toBe(200)
    expect((await response.json()).data.projects).toEqual([{
      id: 'project-1', name: 'Acme Cowork', companyId: 'company-1', added: true,
    }])
  })

  it('does not reveal projects for a company the user cannot access', async () => {
    mockGetCompany.mockResolvedValue(null)
    const { GET } = await import('@/app/api/v1/project-library/route')
    const response = await GET(new NextRequest('http://localhost/api/v1/project-library?orgId=org-1&companyId=company-secret'))
    expect(response.status).toBe(403)
  })

  it('adds an authorised project to only the current user library', async () => {
    mockGetProject.mockResolvedValue({
      ok: true,
      doc: { id: 'project-1', data: () => ({ sourceOrgId: 'org-1', sourceCompanyId: 'company-1' }) },
      projectAccess: { role: 'owner' },
    })
    mockAdd.mockResolvedValue({ projectId: 'project-1', active: true })
    const { POST } = await import('@/app/api/v1/project-library/route')
    const response = await POST(new NextRequest('http://localhost/api/v1/project-library', {
      method: 'POST',
      body: JSON.stringify({ orgId: 'org-1', projectId: 'project-1' }),
    }))

    expect(response.status).toBe(200)
    expect(mockAdd).toHaveBeenCalledWith({
      orgId: 'org-1', userId: 'user-1', projectId: 'project-1', companyId: 'company-1',
    })
  })

  it('removes only the current user link without deleting the project', async () => {
    mockRemove.mockResolvedValue({ projectId: 'project-1', active: false })
    const { DELETE } = await import('@/app/api/v1/project-library/route')
    const response = await DELETE(new NextRequest('http://localhost/api/v1/project-library?orgId=org-1&projectId=project-1', {
      method: 'DELETE',
    }))

    expect(response.status).toBe(200)
    expect(mockRemove).toHaveBeenCalledWith({ orgId: 'org-1', userId: 'user-1', projectId: 'project-1' })
  })
})
