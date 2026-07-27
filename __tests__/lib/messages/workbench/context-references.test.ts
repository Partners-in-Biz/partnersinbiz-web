import { createWorkbenchPathContextReference } from '@/lib/messages/workbench/context-references'
import type { AuthorizedWorkbenchContext } from '@/lib/messages/workbench/authorization'

const binding = {
  conversation: { id: 'conv-a', orgId: 'org-a' },
  projectId: null,
  rootBindingId: 'loyalty-plus-workspace',
  relativeFolder: '.',
  workingDirectory: '/Users/private/Cowork/partners/Loyalty Plus',
  binding: {
    kind: 'linked-computer',
    deviceId: 'device-a',
    runtimeTargetId: 'runtime-a',
    machineLabel: 'Mac',
    mappingId: 'mapping-a',
    mappingLabel: 'Client Growth',
    workspaceId: 'workspace-a',
    credentialVersion: 3,
    runtimeVersion: '1.1.10',
    availableAgentIds: ['pip'],
    platform: 'macos',
    lastSeenAt: '2026-07-27T00:00:00.000Z',
    publicKey: 'public',
    accessMode: 'selected_users',
  },
} as AuthorizedWorkbenchContext

describe('Workbench path context references', () => {
  it('persists only a safe relative path and immutable runtime binding', () => {
    const ref = createWorkbenchPathContextReference(binding, { path: 'rmicdev/src/index.ts', type: 'file' })
    expect(ref).toMatchObject({
      type: 'file',
      label: 'rmicdev/src/index.ts',
      metadata: {
        contextKind: 'workbench_path',
        path: 'rmicdev/src/index.ts',
        entryType: 'file',
        conversationId: 'conv-a',
        deviceId: 'device-a',
        workspaceId: 'workspace-a',
        mappingId: 'mapping-a',
        rootBindingId: 'loyalty-plus-workspace',
      },
    })
    expect(JSON.stringify(ref)).not.toContain('/Users/private')
  })

  it.each(['../secret', '/etc/passwd', 'rmicdev\\secret'])(
    'rejects unsafe relative path %s',
    (path) => {
      expect(() => createWorkbenchPathContextReference(binding, { path, type: 'file' }))
        .toThrow('workbench: invalid context path')
    },
  )
})
