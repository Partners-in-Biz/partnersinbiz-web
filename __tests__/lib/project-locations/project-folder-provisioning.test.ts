import { callAgentPath } from '@/lib/agents/team'
import { provisionStandardProjectFolder } from '@/lib/project-locations/project-folder-provisioning'

jest.mock('@/lib/agents/team', () => ({ callAgentPath: jest.fn() }))

const mockCallAgentPath = callAgentPath as jest.Mock

describe('standard project folder provisioning', () => {
  beforeEach(() => mockCallAgentPath.mockReset())

  it('uses the VPS sidecar with only a validated workspace root and project identity', async () => {
    mockCallAgentPath.mockResolvedValue({
      response: { ok: true, status: 200 },
      data: {
        projectId: 'project-1',
        relativePath: 'projects/project-1',
        folderStatus: 'provisioned',
        syncStatus: 'pending',
        manifestWritten: true,
        manifestPreserved: false,
        directoriesCreated: ['projects/project-1/docs'],
        directoriesPreserved: [],
      },
    })

    await expect(provisionStandardProjectFolder({
      projectId: 'project-1',
      orgId: 'pib-org',
      workspaceId: 'partners',
      workspacePath: '/var/lib/hermes/Cowork/Partners in Biz',
    })).resolves.toMatchObject({
      relativePath: 'projects/project-1', folderStatus: 'provisioned', syncStatus: 'pending',
    })

    expect(mockCallAgentPath).toHaveBeenCalledWith('pip', '/admin/project-folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'project-1',
        orgId: 'pib-org',
        workspaceId: 'partners',
        workspacePath: '/var/lib/hermes/Cowork/Partners in Biz',
      }),
    }, { runtimeTarget: 'vps' })
  })

  it('propagates a sidecar failure instead of returning a fake provisioned state', async () => {
    mockCallAgentPath.mockResolvedValue({
      response: { ok: false, status: 409 },
      data: { detail: 'project manifest identity conflict' },
    })

    await expect(provisionStandardProjectFolder({
      projectId: 'project-1', orgId: 'pib-org', workspaceId: 'partners',
      workspacePath: '/var/lib/hermes/Cowork/Partners in Biz',
    })).rejects.toThrow('project manifest identity conflict')
  })
})
