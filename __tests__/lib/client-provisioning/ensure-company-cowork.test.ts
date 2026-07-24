const mockProvision = jest.fn()
const mockUpsert = jest.fn()
const mockGetCompany = jest.fn()
const mockGetById = jest.fn()
const mockEnrich = jest.fn()

jest.mock('@/lib/client-provisioning/vps', () => ({
  provisionFullClientOnVps: (...args: unknown[]) => mockProvision(...args),
}))
jest.mock('@/lib/client-provisioning/workspace-context', () => ({
  getCompanyWorkspaceByCompanyId: (...args: unknown[]) => mockGetCompany(...args),
  getOrgWorkspaceById: (...args: unknown[]) => mockGetById(...args),
  upsertOrgWorkspace: (...args: unknown[]) => mockUpsert(...args),
}))
jest.mock('@/lib/client-provisioning/company-cowork-dispatch', () => ({
  conversationUsesCompanyCoworkFolder: () => true,
  enrichCompanyCoworkWorkspaceContext: (...args: unknown[]) => mockEnrich(...args),
}))

describe('ensureCompanyCoworkFolderOnVps', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetCompany.mockResolvedValue({
      workspaceId: 'hunt-and-gun',
      orgId: 'AEsehyRzcy2wfk0aR7KY',
      orgSlug: 'hunt-and-gun',
      orgName: 'Hunt and Gun',
      agentDomain: 'hunt-and-gun',
      agentName: 'Hunt',
      vpsPath: '/var/lib/hermes/Cowork/partners/Hunt and Gun',
      localPath: '~/Cowork/partners/Hunt and Gun',
      agentDomainPath: '/var/lib/hermes/Cowork/Cowork/agents/hunt-and-gun',
      localAgentDomainPath: '~/Cowork/Cowork/agents/hunt-and-gun',
      companyId: 'company-hunt',
      contactIds: [],
    })
    mockGetById.mockResolvedValue(null)
    mockProvision.mockResolvedValue({ profile: { skipped: true }, workspace: { ok: true } })
    mockUpsert.mockResolvedValue({ workspaceId: 'hunt-and-gun' })
    mockEnrich.mockImplementation(async (workspace: Record<string, unknown>) => ({
      ...workspace,
      agentDomain: 'hunt-and-gun',
      vpsWorkingPath: '/var/lib/hermes/Cowork/partners/Hunt and Gun',
    }))
  })

  it('provisions the VPS company Cowork tree and refreshes the workspace record', async () => {
    const { ensureCompanyCoworkFolderOnVps } = await import('@/lib/client-provisioning/ensure-company-cowork')
    const result = await ensureCompanyCoworkFolderOnVps({
      workspaceId: 'partners',
      orgId: 'pib-platform-owner',
      orgSlug: 'partners',
      orgName: 'Partners in Biz',
      agentDomain: 'partners',
      vpsPath: '/var/lib/hermes/Cowork/partners/Partners in Biz',
      localPath: '~/Cowork/partners/Partners in Biz',
      agentDomainPath: '/var/lib/hermes/Cowork/Cowork/agents/partners',
      localAgentDomainPath: '~/Cowork/Cowork/agents/partners',
      sourceOfTruth: 'vps',
      runtimeTarget: 'vps',
      runtimeLabel: 'Partners VPS',
      shareMode: 'private',
      ownerUserId: 'user-1',
      companyId: 'company-hunt',
      companyName: 'Hunt and Gun',
      companyWorkspaceId: 'hunt-and-gun',
      folderScope: 'company',
      contactIds: [],
    })

    expect(result.ok).toBe(true)
    expect(mockProvision).toHaveBeenCalledWith(expect.objectContaining({
      clientName: 'Hunt and Gun',
      domain: 'hunt-and-gun',
      orgId: 'AEsehyRzcy2wfk0aR7KY',
      companyId: 'company-hunt',
    }))
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'hunt-and-gun',
      linked: expect.objectContaining({ companyId: 'company-hunt' }),
    }))
  })

  it('bootstraps and provisions when the company Workspace link is missing', async () => {
    mockGetCompany.mockResolvedValue(null)
    mockGetById.mockResolvedValue(null)
    const { ensureCompanyCoworkFolderOnVps } = await import('@/lib/client-provisioning/ensure-company-cowork')
    const result = await ensureCompanyCoworkFolderOnVps({
      workspaceId: 'partners',
      orgId: 'pib-platform-owner',
      orgSlug: 'partners',
      orgName: 'Partners in Biz',
      agentDomain: 'partners',
      vpsPath: '/var/lib/hermes/Cowork/partners/Partners in Biz',
      localPath: '~/Cowork/partners/Partners in Biz',
      agentDomainPath: '/x',
      localAgentDomainPath: '~/x',
      sourceOfTruth: 'vps',
      runtimeTarget: 'vps',
      runtimeLabel: 'Partners VPS',
      shareMode: 'private',
      ownerUserId: 'user-1',
      companyId: 'company-hunt',
      companyName: 'Hunt and Gun',
      companyDomain: 'huntandgun.co.za',
      companyLinkedOrgId: 'AEsehyRzcy2wfk0aR7KY',
      folderScope: 'company',
      contactIds: [],
    })

    expect(result.ok).toBe(true)
    expect(mockProvision).toHaveBeenCalledWith(expect.objectContaining({
      clientName: 'Hunt and Gun',
      domain: 'hunt-and-gun',
      orgId: 'AEsehyRzcy2wfk0aR7KY',
      companyId: 'company-hunt',
    }))
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'hunt-and-gun',
      linked: expect.objectContaining({ companyId: 'company-hunt' }),
    }))
  })

  it('fails only when company identity cannot be inferred', async () => {
    mockGetCompany.mockResolvedValue(null)
    mockGetById.mockResolvedValue(null)
    const { ensureCompanyCoworkFolderOnVps } = await import('@/lib/client-provisioning/ensure-company-cowork')
    const result = await ensureCompanyCoworkFolderOnVps({
      workspaceId: 'partners',
      orgId: 'pib-platform-owner',
      orgSlug: 'partners',
      orgName: 'Partners in Biz',
      agentDomain: 'partners',
      vpsPath: '/var/lib/hermes/Cowork/partners/Partners in Biz',
      localPath: '~/Cowork/partners/Partners in Biz',
      agentDomainPath: '/x',
      localAgentDomainPath: '~/x',
      sourceOfTruth: 'vps',
      runtimeTarget: 'vps',
      runtimeLabel: 'Partners VPS',
      shareMode: 'private',
      ownerUserId: 'user-1',
      companyId: 'missing',
      folderScope: 'company',
      contactIds: [],
    })
    expect(result).toEqual(expect.objectContaining({ ok: false, code: 'company_workspace_missing' }))
    expect(mockProvision).not.toHaveBeenCalled()
  })
})
