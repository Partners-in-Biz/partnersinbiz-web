import { buildClientProvisioningPayload } from '@/lib/client-provisioning/provisioner'

describe('client provisioning folder registry', () => {
  it('builds a multi-folder registry with visibility, sync, and source-of-truth metadata', () => {
    const payload = buildClientProvisioningPayload({
      clientName: 'Acme Inc',
      domain: 'acme-inc',
      orgId: 'org_123',
      agentName: 'Ava',
    })

    expect(payload.folderRegistry).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'workspace-root',
        visibility: 'admin_agents',
        sourceOfTruth: 'vps',
        syncTargets: expect.objectContaining({
          vpsPath: '/var/lib/hermes/Cowork/Acme Inc',
          localPath: '~/Cowork/Acme Inc',
        }),
      }),
      expect.objectContaining({
        id: 'drive-assets',
        visibility: 'admin_agents_clients',
        sourceOfTruth: 'google_drive',
        parentId: 'workspace-root',
        tags: expect.arrayContaining(['binary-assets', 'source-assets']),
        syncMode: 'full',
      }),
      expect.objectContaining({
        id: 'obsidian-wiki',
        visibility: 'admin_agents',
        sourceOfTruth: 'obsidian',
        parentId: 'obsidian-root',
        tags: expect.arrayContaining(['markdown']),
        syncTargets: expect.objectContaining({
          vpsPath: '/var/lib/hermes/Cowork/Cowork/agents/acme-inc/wiki',
          localPath: '~/Cowork/Cowork/agents/acme-inc/wiki',
        }),
      }),
      expect.objectContaining({
        id: 'client-deliverables',
        visibility: 'admin_agents_clients',
        parentId: 'workspace-root',
      }),
    ]))
    expect(payload.folderRegistry).toHaveLength(10)
    expect(payload.folderRegistry.every((folder) => folder.syncState === 'pending')).toBe(true)
    expect(payload.folderRegistry.every((folder) => folder.conflictStatus === 'none')).toBe(true)
  })
})
