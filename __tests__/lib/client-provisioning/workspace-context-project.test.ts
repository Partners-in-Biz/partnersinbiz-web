const mockWorkspaceGet = jest.fn()
const mockProjectGet = jest.fn()
const mockCompanyWorkspaceGet = jest.fn()

jest.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'now' } }))
jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => name === 'org_workspaces'
      ? {
          doc: () => ({ get: mockWorkspaceGet }),
          where: () => ({
            where: () => ({ limit: () => ({ get: mockCompanyWorkspaceGet }) }),
          }),
        }
      : { doc: () => ({ get: mockProjectGet }) },
  },
}))

describe('project conversation workspace identity', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCompanyWorkspaceGet.mockResolvedValue({ docs: [] })
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

  it('uses the linked company Cowork root for a company project session', async () => {
    mockProjectGet.mockResolvedValue({
      exists: true,
      id: 'project-1',
      data: () => ({ sourceOrgId: 'org-1', sourceCompanyId: 'company-1', name: 'Website launch' }),
    })
    mockCompanyWorkspaceGet.mockResolvedValue({
      docs: [{
        id: 'acme-company',
        data: () => ({
          workspaceId: 'acme-company', orgId: 'client-org', orgSlug: 'acme', orgName: 'Acme',
          vpsPath: '/var/lib/hermes/Cowork/Acme', localPath: '/Users/peet/Cowork/Acme',
          status: 'active', companyId: 'company-1',
        }),
      }],
    })
    const { resolveConversationWorkspaceContext } = await import('@/lib/client-provisioning/workspace-context')

    const context = await resolveConversationWorkspaceContext({
      orgId: 'org-1', workspaceId: 'partners', ownerUserId: 'user-1',
      projectId: 'project-1', projectName: 'Website launch', folderRelativePath: 'projects/project-1',
    })

    expect(context).toEqual(expect.objectContaining({
      workspaceId: 'partners',
      companyWorkspaceId: 'acme-company',
      companyId: 'company-1',
      folderScope: 'project',
      vpsPath: '/var/lib/hermes/Cowork/Acme',
      vpsWorkingPath: '/var/lib/hermes/Cowork/Acme/projects/project-1',
    }))
  })

  it('binds a company-root session without changing the active organisation identity', async () => {
    mockCompanyWorkspaceGet.mockResolvedValue({
      docs: [{
        id: 'acme-company',
        data: () => ({
          workspaceId: 'acme-company', orgId: 'client-org', orgSlug: 'acme', orgName: 'Acme',
          agentDomain: 'acme',
          agentDomainPath: '/var/lib/hermes/Cowork/Cowork/agents/acme',
          localAgentDomainPath: '/Users/peet/Cowork/Cowork/agents/acme',
          vpsPath: '/var/lib/hermes/Cowork/Acme', localPath: '/Users/peet/Cowork/Acme',
          status: 'active', companyId: 'company-1',
        }),
      }],
    })
    const { resolveConversationWorkspaceContext } = await import('@/lib/client-provisioning/workspace-context')

    const context = await resolveConversationWorkspaceContext({
      orgId: 'org-1', workspaceId: 'partners', ownerUserId: 'user-1',
      companyId: 'company-1', companyName: 'Acme',
    })

    expect(context).toEqual(expect.objectContaining({
      orgId: 'org-1', orgName: 'Partners in Biz',
      workspaceId: 'partners', companyWorkspaceId: 'acme-company',
      companyId: 'company-1', companyName: 'Acme', folderScope: 'company',
      agentDomain: 'acme',
      agentDomainPath: '/var/lib/hermes/Cowork/Cowork/agents/acme',
      localAgentDomainPath: '/Users/peet/Cowork/Cowork/agents/acme',
      vpsWorkingPath: '/var/lib/hermes/Cowork/Acme',
      localWorkingPath: '/Users/peet/Cowork/Acme',
    }))
  })

  it('binds the spawned session to the project CRM company in the current organisation', async () => {
    mockProjectGet.mockResolvedValue({
      exists: true,
      id: 'project-1',
      data: () => ({ sourceOrgId: 'org-1', sourceCompanyId: 'company-1', name: 'Acme Cowork' }),
    })
    mockCompanyWorkspaceGet.mockResolvedValue({
      docs: [{ id: 'acme-company', data: () => ({
        workspaceId: 'acme-company', orgId: 'client-org', orgName: 'Acme',
        vpsPath: '/var/lib/hermes/Cowork/Acme', localPath: '/Users/peet/Cowork/Acme',
        status: 'active', companyId: 'company-1',
      }) }],
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
