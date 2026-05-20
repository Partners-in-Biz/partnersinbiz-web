import { buildClientProvisioningPayload, inferAgentName } from '@/lib/client-provisioning/provisioner'
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
      orgId: 'org_123',
      agentName: 'Ava',
    })

    expect(payload.workspacePath).toBe('/var/lib/hermes/Cowork/Acme Inc')
    expect(payload.agentDomainPath).toBe('/var/lib/hermes/Cowork/Cowork/agents/acme-inc')
    expect(payload.soul).toContain('PiB org_id: `org_123`')
    expect(payload.soul).toContain('Project folder: `/var/lib/hermes/Cowork/Acme Inc`')
    expect(payload.soul).toContain('Never say you are Codex')
  })

  it('infers the agent name from the first display word', () => {
    expect(inferAgentName('Deidre Ras Biokinetics')).toBe('Deidre')
    expect(inferAgentName('')).toBe('Client')
  })

  it('provisions the Hermes profile first, then the VPS Cowork workspace', async () => {
    mockedCallAgentPath
      .mockResolvedValueOnce({ response: { ok: true }, data: { agentId: 'acme-inc', baseUrl: 'https://example.test' } })
      .mockResolvedValueOnce({ response: { ok: true }, data: { directoriesCreated: ['/var/lib/hermes/Cowork/Acme Inc/docs'] } })

    await expect(provisionFullClientOnVps({
      clientName: 'Acme Inc',
      domain: 'acme-inc',
      orgId: 'org_123',
      agentName: 'Ava',
    })).resolves.toMatchObject({
      profile: { agentId: 'acme-inc' },
      workspace: { directoriesCreated: ['/var/lib/hermes/Cowork/Acme Inc/docs'] },
    })

    expect(mockedCallAgentPath).toHaveBeenNthCalledWith(
      1,
      'pip',
      '/admin/profiles',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(mockedCallAgentPath).toHaveBeenNthCalledWith(
      2,
      'pip',
      '/admin/client-workspaces',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('treats an existing Hermes profile as idempotent and still provisions the workspace', async () => {
    mockedCallAgentPath
      .mockResolvedValueOnce({ response: { ok: false, status: 409 }, data: { detail: 'profile already exists' } })
      .mockResolvedValueOnce({ response: { ok: true }, data: { filesPreserved: ['SOUL.md'] } })

    await expect(provisionFullClientOnVps({
      clientName: 'Acme Inc',
      domain: 'acme-inc',
      orgId: 'org_123',
    })).resolves.toMatchObject({
      profile: { existing: true },
      workspace: { filesPreserved: ['SOUL.md'] },
    })
  })
})
