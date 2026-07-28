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
        workspaceId: 'partners', orgId: 'pib-platform-owner', orgSlug: 'partners', orgName: 'Partners in Biz',
        agentDomain: 'partners',
        vpsPath: '/var/lib/hermes/Cowork/partners/Partners in Biz',
        localPath: '/Users/peet/Cowork/partners/Partners in Biz',
        agentDomainPath: '/var/lib/hermes/Cowork/Cowork/agents/partners',
        localAgentDomainPath: '/Users/peet/Cowork/Cowork/agents/partners',
        defaultRuntimeTarget: 'vps', companyId: 'workspace-company', contactIds: [],
      }),
    })
  })

  it('uses the linked company Cowork root for a company project session', async () => {
    mockProjectGet.mockResolvedValue({
      exists: true,
      id: 'project-1',
      data: () => ({ sourceOrgId: 'pib-platform-owner', sourceCompanyId: 'company-1', name: 'Website launch' }),
    })
    mockCompanyWorkspaceGet.mockResolvedValue({
      docs: [{
        id: 'acme-company',
        data: () => ({
          workspaceId: 'acme-company', orgId: 'client-org', orgSlug: 'acme', orgName: 'Acme',
          vpsPath: '/var/lib/hermes/Cowork/partners/Acme', localPath: '/Users/peet/Cowork/partners/Acme',
          status: 'active', companyId: 'company-1',
        }),
      }],
    })
    const { resolveConversationWorkspaceContext } = await import('@/lib/client-provisioning/workspace-context')

    const context = await resolveConversationWorkspaceContext({
      orgId: 'pib-platform-owner', workspaceId: 'partners', ownerUserId: 'user-1',
      projectId: 'project-1', projectName: 'Website launch', folderRelativePath: 'projects/project-1',
    })

    expect(context).toEqual(expect.objectContaining({
      workspaceId: 'partners',
      companyWorkspaceId: 'acme-company',
      companyId: 'company-1',
      folderScope: 'project',
      vpsPath: '/var/lib/hermes/Cowork/partners/Acme',
      vpsWorkingPath: '/var/lib/hermes/Cowork/partners/Acme/projects/project-1',
    }))
  })

  it('does not nest mapping-relative replica paths under the company Cowork root', async () => {
    mockProjectGet.mockResolvedValue({
      exists: true,
      id: 'project-crm',
      data: () => ({ sourceOrgId: 'pib-platform-owner', sourceCompanyId: 'company-hunt', name: 'Seller CRM' }),
    })
    mockCompanyWorkspaceGet.mockResolvedValue({
      docs: [{
        id: 'hunt-company',
        data: () => ({
          workspaceId: 'hunt-company', orgId: 'client-hunt', orgSlug: 'hunt-and-gun', orgName: 'Hunt and Gun',
          vpsPath: '/var/lib/hermes/Cowork/partners/Hunt and Gun',
          localPath: '/Users/peetstander/Cowork/partners/Hunt and Gun',
          status: 'active', companyId: 'company-hunt',
        }),
      }],
    })
    const { resolveConversationWorkspaceContext } = await import('@/lib/client-provisioning/workspace-context')

    const context = await resolveConversationWorkspaceContext({
      orgId: 'pib-platform-owner', workspaceId: 'partners', ownerUserId: 'user-1',
      projectId: 'project-crm', projectName: 'Seller CRM',
      // Replica paths are relative to the VPS Cowork mapping root.
      folderRelativePath: 'partners/Hunt and Gun/hunt-and-gun-seller-crm',
    })

    expect(context).toEqual(expect.objectContaining({
      companyId: 'company-hunt',
      folderScope: 'project',
      vpsPath: '/var/lib/hermes/Cowork/partners/Hunt and Gun',
      vpsWorkingPath: '/var/lib/hermes/Cowork/partners/Hunt and Gun/hunt-and-gun-seller-crm',
      localWorkingPath: '/Users/peetstander/Cowork/partners/Hunt and Gun/hunt-and-gun-seller-crm',
    }))
    expect(context?.vpsWorkingPath).not.toContain('/partners/Hunt and Gun/partners/')
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
          vpsPath: '/var/lib/hermes/Cowork/partners/Acme', localPath: '/Users/peet/Cowork/partners/Acme',
          status: 'active', companyId: 'company-1',
        }),
      }],
    })
    const { resolveConversationWorkspaceContext } = await import('@/lib/client-provisioning/workspace-context')

    const context = await resolveConversationWorkspaceContext({
      orgId: 'pib-platform-owner', workspaceId: 'partners', ownerUserId: 'user-1',
      companyId: 'company-1', companyName: 'Acme',
    })

    expect(context).toEqual(expect.objectContaining({
      orgId: 'pib-platform-owner', orgName: 'Partners in Biz',
      workspaceId: 'partners', companyWorkspaceId: 'acme-company',
      companyId: 'company-1', companyName: 'Acme', folderScope: 'company',
      agentDomain: 'acme',
      agentDomainPath: '/var/lib/hermes/Cowork/Cowork/agents/acme',
      localAgentDomainPath: '/Users/peet/Cowork/Cowork/agents/acme',
      vpsWorkingPath: '/var/lib/hermes/Cowork/partners/Acme',
      localWorkingPath: '/Users/peet/Cowork/partners/Acme',
    }))
  })

  it('builds a provisional company Cowork identity when the Workspace link is missing', async () => {
    mockCompanyWorkspaceGet.mockResolvedValue({ docs: [] })
    const { resolveConversationWorkspaceContext } = await import('@/lib/client-provisioning/workspace-context')

    const context = await resolveConversationWorkspaceContext({
      orgId: 'pib-platform-owner',
      workspaceId: 'partners',
      ownerUserId: 'user-1',
      companyId: 'company-hunt',
      companyName: 'Hunt and Gun',
      companyDomain: 'huntandgun.co.za',
      companyLinkedOrgId: 'client-hunt',
    })

    expect(context).toEqual(expect.objectContaining({
      orgId: 'pib-platform-owner',
      workspaceId: 'partners',
      companyId: 'company-hunt',
      companyName: 'Hunt and Gun',
      companyWorkspaceId: 'hunt-and-gun',
      folderScope: 'company',
      agentDomain: 'hunt-and-gun',
      vpsPath: '/var/lib/hermes/Cowork/partners/Hunt and Gun',
      localPath: '~/Cowork/partners/Hunt and Gun',
      vpsWorkingPath: '/var/lib/hermes/Cowork/partners/Hunt and Gun',
    }))
  })

  it('does not 404 a named company session just because the Workspace link is missing', async () => {
    mockCompanyWorkspaceGet.mockResolvedValue({ docs: [] })
    const { resolveConversationWorkspaceContext } = await import('@/lib/client-provisioning/workspace-context')

    const context = await resolveConversationWorkspaceContext({
      orgId: 'pib-platform-owner',
      workspaceId: 'partners',
      ownerUserId: 'user-1',
      companyId: 'company-hunt',
      companyName: 'Hunt and Gun',
    })

    expect(context).not.toBeNull()
    expect(context?.folderScope).toBe('company')
    expect(context?.companyWorkspaceId).toBe('hunt-and-gun')
  })

  it('binds the spawned session to the project CRM company in the current organisation', async () => {
    mockProjectGet.mockResolvedValue({
      exists: true,
      id: 'project-1',
      data: () => ({ sourceOrgId: 'pib-platform-owner', sourceCompanyId: 'company-1', name: 'Acme Cowork' }),
    })
    mockCompanyWorkspaceGet.mockResolvedValue({
      docs: [{ id: 'acme-company', data: () => ({
        workspaceId: 'acme-company', orgId: 'client-org', orgName: 'Acme',
        vpsPath: '/var/lib/hermes/Cowork/partners/Acme', localPath: '/Users/peet/Cowork/partners/Acme',
        status: 'active', companyId: 'company-1',
      }) }],
    })
    const { resolveConversationWorkspaceContext } = await import('@/lib/client-provisioning/workspace-context')

    const context = await resolveConversationWorkspaceContext({
      orgId: 'pib-platform-owner', workspaceId: 'partners', ownerUserId: 'user-1', projectId: 'project-1', projectName: 'Acme Cowork',
    })

    expect(context).toEqual(expect.objectContaining({
      orgId: 'pib-platform-owner', ownerUserId: 'user-1', projectId: 'project-1', companyId: 'company-1',
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
      orgId: 'pib-platform-owner', workspaceId: 'partners', ownerUserId: 'user-1', projectId: 'project-1',
    })

    expect(context?.companyId).toBe('workspace-company')
  })
})
