const mockWorkspaceGet = jest.fn()
const mockProjectGet = jest.fn()

jest.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'now' } }))
jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => ({
      doc: () => ({ get: name === 'org_workspaces' ? mockWorkspaceGet : mockProjectGet }),
    }),
  },
}))

describe('project conversation workspace identity', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockWorkspaceGet.mockResolvedValue({
      exists: true,
      id: 'partners',
      data: () => ({
        workspaceId: 'partners', orgId: 'org-1', orgSlug: 'partners', orgName: 'Partners in Biz',
        agentDomain: 'partners', vpsPath: '/srv/Cowork/Partners', localPath: '/Users/peet/Cowork/Partners',
        agentDomainPath: '/srv/Cowork/agents/partners', localAgentDomainPath: '/Users/peet/Cowork/agents/partners',
        defaultRuntimeTarget: 'vps', companyId: 'workspace-company', contactIds: [],
      }),
    })
  })

  it('binds the spawned session to the project CRM company in the current organisation', async () => {
    mockProjectGet.mockResolvedValue({
      exists: true,
      id: 'project-1',
      data: () => ({ sourceOrgId: 'org-1', sourceCompanyId: 'company-1', name: 'Acme Cowork' }),
    })
    const { resolveConversationWorkspaceContext } = await import('@/lib/client-provisioning/workspace-context')

    const context = await resolveConversationWorkspaceContext({
      orgId: 'org-1', workspaceId: 'partners', ownerUserId: 'user-1', projectId: 'project-1', projectName: 'Acme Cowork',
    })

    expect(context).toEqual(expect.objectContaining({
      orgId: 'org-1', ownerUserId: 'user-1', projectId: 'project-1', companyId: 'company-1',
    }))
  })

  it('does not accept company identity from a project belonging to another organisation', async () => {
    mockProjectGet.mockResolvedValue({
      exists: true,
      id: 'project-1',
      data: () => ({ sourceOrgId: 'other-org', sourceCompanyId: 'secret-company' }),
    })
    const { resolveConversationWorkspaceContext } = await import('@/lib/client-provisioning/workspace-context')

    const context = await resolveConversationWorkspaceContext({
      orgId: 'org-1', workspaceId: 'partners', ownerUserId: 'user-1', projectId: 'project-1',
    })

    expect(context?.companyId).toBe('workspace-company')
  })
})
