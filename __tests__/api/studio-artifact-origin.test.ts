import { validateStudioArtifactOrigin } from '@/lib/chat-context/originStore'

const origin = { conversationId: 'conv-1', requestMessageId: 'req-1', responseMessageId: 'res-1', bundleId: 'bundle-1', sequence: 0 }
const conversation = {
  id: 'conv-1', orgId: 'org-1', participantUids: ['user-1'], contextRefs: [{ type: 'studio', id: 'marketing_studio', orgId: 'org-1' }],
} as any

describe('Studio artifact conversation origin', () => {
  it('accepts exact accessible same-org lineage when the target Studio is attached', async () => {
    await expect(validateStudioArtifactOrigin({
      value: origin, orgId: 'org-1', targetDomain: 'marketing_studio', conversation, user: { uid: 'user-1', role: 'client', orgId: 'org-1' } as any,
      loadMessage: async (id) => id === 'req-1' ? { conversationId: 'conv-1', role: 'user' } : { conversationId: 'conv-1', role: 'assistant' },
    })).resolves.toEqual(origin)
  })

  it.each([
    ['cross-org', { orgId: 'org-2' }],
    ['detached target', { contextRefs: [] }],
  ])('rejects %s lineage', async (_label, patch) => {
    await expect(validateStudioArtifactOrigin({
      value: origin, orgId: 'org-1', targetDomain: 'marketing_studio', conversation: { ...conversation, ...patch },
      user: { uid: 'user-1', role: 'client', orgId: 'org-1' } as any, loadMessage: async () => ({ conversationId: 'conv-1' }),
    })).rejects.toThrow()
  })

  it('rejects missing or mismatched request and response messages', async () => {
    await expect(validateStudioArtifactOrigin({
      value: origin, orgId: 'org-1', targetDomain: 'marketing_studio', conversation, user: { uid: 'user-1', role: 'client', orgId: 'org-1' } as any,
      loadMessage: async (id) => id === 'req-1' ? { conversationId: 'another-conversation' } : null,
    })).rejects.toThrow('message')
  })

  it.each([
    ['assistant request', async (id: string) => ({ conversationId: 'conv-1', role: id === 'req-1' ? 'assistant' : 'assistant' })],
    ['user response', async (id: string) => ({ conversationId: 'conv-1', role: id === 'req-1' ? 'user' : 'user' })],
  ])('rejects a %s role pairing', async (_label, loadMessage) => {
    await expect(validateStudioArtifactOrigin({
      value: origin, orgId: 'org-1', targetDomain: 'marketing_studio', conversation,
      user: { uid: 'user-1', role: 'client', orgId: 'org-1' } as any, loadMessage,
    })).rejects.toThrow('roles')
  })
})
