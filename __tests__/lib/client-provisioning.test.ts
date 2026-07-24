import { buildClientProvisioningPayload, inferAgentName, inferCompanyCoworkDomain } from '@/lib/client-provisioning/provisioner'
import { provisionFullClientOnVps } from '@/lib/client-provisioning/vps'
import { callAgentPath } from '@/lib/agents/team'

jest.mock('@/lib/agents/team', () => ({
  callAgentPath: jest.fn(),
}))

const mockedCallAgentPath = callAgentPath as jest.Mock

describe('client workspace provisioning', () => {
  beforeEach(() => {
    mockedCallAgentPath.mockReset()
  })

  it('builds VPS Cowork paths that mirror the local Cowork structure', () => {
    const payload = buildClientProvisioningPayload({
      clientName: 'Acme Inc',
      domain: 'acme-inc',
      orgId: 'pib-platform-owner',
      agentName: 'Ava',
    })

    expect(payload.workspacePath).toBe('/var/lib/hermes/Cowork/partners/Acme Inc')
    expect(payload.agentDomainPath).toBe('/var/lib/hermes/Cowork/Cowork/agents/acme-inc')
    expect(payload.localWorkspacePath).toBe('~/Cowork/partners/Acme Inc')
    expect(payload.workspaceFolders).toEqual(expect.arrayContaining(['docs', 'marketing', 'operations/admin', 'archive']))
    expect(payload.manifest).toMatchObject({
      workspaceId: 'acme-inc',
      orgId: 'pib-platform-owner',
      orgSlug: 'partners',
      sourceOfTruth: 'vps',
      defaultRuntimeTarget: 'vps',
      linked: { companyId: null, contactIds: [] },
    })
    expect(payload.workspaceInstructions).toContain('VPS-canonical')
    expect(payload.workspaceInstructions).toContain('Portable root: `~/Cowork/partners/Acme Inc`')
    expect(payload.soul).toContain('PiB org_id: `pib-platform-owner`')
    expect(payload.soul).toContain('Portable root: `~/Cowork/partners/Acme Inc`')
    expect(payload.soul).toContain('Canonical VPS root: `/var/lib/hermes/Cowork/partners/Acme Inc`')
    expect(payload.soul).toContain('cwd')
    expect(payload.soul).toContain('Never say you are Codex')
  })

  it('nests tenant orgs under their slug with a prefixed workspaceId', () => {
    const payload = buildClientProvisioningPayload({
      clientName: 'Acme Inc',
      domain: 'acme-inc',
      orgId: 'org_123',
      orgSlug: 'acme',
      platformOwned: false,
      agentName: 'Ava',
    })

    expect(payload.workspacePath).toBe('/var/lib/hermes/Cowork/acme/Acme Inc')
    expect(payload.localWorkspacePath).toBe('~/Cowork/acme/Acme Inc')
    expect(payload.manifest).toMatchObject({
      workspaceId: 'acme__acme-inc',
      orgId: 'org_123',
      orgSlug: 'acme',
    })
  })


  it('infers company Cowork domains from the company name first', () => {
    expect(inferCompanyCoworkDomain({ name: 'Hunt and Gun', domain: 'huntandgun.co.za' })).toBe('hunt-and-gun')
    expect(inferCompanyCoworkDomain({ domain: 'https://www.acme.io' })).toBe('acme')
  })

  it('links workspace manifests to CRM company and contact ids when supplied', () => {
    const payload = buildClientProvisioningPayload({
      clientName: 'Acme Inc',
      domain: 'acme-inc',
      orgId: 'pib-platform-owner',
      companyId: 'company-1',
      contactIds: ['contact-1', 'contact-1', ' contact-2 '],
    })


    expect(payload.manifest.linked).toEqual({
      companyId: 'company-1',
      contactIds: ['contact-1', 'contact-2'],
    })
  })

  it('infers the agent name from the first display word', () => {
    expect(inferAgentName('Deidre Ras Biokinetics')).toBe('Deidre')
    expect(inferAgentName('')).toBe('Client')
  })

  it('provisions the VPS Cowork workspace without creating a per-client Hermes profile', async () => {
    mockedCallAgentPath
      .mockResolvedValueOnce({ response: { ok: true }, data: { directoriesCreated: ['/var/lib/hermes/Cowork/partners/Acme Inc/docs'] } })

    await expect(provisionFullClientOnVps({
      clientName: 'Acme Inc',
      domain: 'acme-inc',
      orgId: 'pib-platform-owner',
      agentName: 'Ava',
    })).resolves.toMatchObject({
      profile: {
        skipped: true,
        reason: expect.stringContaining('agents now work inside client spaces'),
      },
      workspace: { directoriesCreated: ['/var/lib/hermes/Cowork/partners/Acme Inc/docs'] },
    })


    expect(mockedCallAgentPath).toHaveBeenCalledTimes(1)
    expect(mockedCallAgentPath).toHaveBeenNthCalledWith(
      1,
      'pip',
      '/admin/client-workspaces',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('treats an existing VPS workspace as idempotent and still does not create a profile', async () => {
    mockedCallAgentPath
      .mockResolvedValueOnce({ response: { ok: false, status: 409 }, data: { detail: 'workspace already exists' } })

    await expect(provisionFullClientOnVps({
      clientName: 'Acme Inc',
      domain: 'acme-inc',
      orgId: 'pib-platform-owner',
    })).resolves.toMatchObject({
      profile: { skipped: true },
      workspace: { existing: true },
    })


    expect(mockedCallAgentPath).toHaveBeenCalledTimes(1)
  })
})
