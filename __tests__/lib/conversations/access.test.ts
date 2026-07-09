import { canAccessConversation, conversationVisibilityLabel } from '@/lib/conversations/access'
import type { ApiUser } from '@/lib/api/types'
import type { Conversation } from '@/lib/conversations/types'

function conversation(shareMode: 'private' | 'shared' | 'org'): Conversation {
  return {
    id: 'conv-1',
    orgId: 'org-1',
    title: 'Workspace chat',
    scope: 'workspace',
    scopeRefId: 'acme',
    startedBy: 'owner-1',
    participantUids: ['owner-1', ...(shareMode === 'shared' ? ['member-1'] : [])],
    participantAgentIds: ['pip'],
    participants: [],
    status: 'active',
    archived: false,
    messageCount: 0,
    createdAt: '2026-07-09T00:00:00Z',
    updatedAt: '2026-07-09T00:00:00Z',
    workspaceContext: {
      workspaceId: 'acme',
      orgId: 'org-1',
      orgSlug: 'acme',
      orgName: 'Acme',
      agentDomain: 'acme',
      vpsPath: '/var/lib/hermes/Cowork/Acme',
      localPath: '/Users/test/Cowork/Acme',
      agentDomainPath: '/var/lib/hermes/cowork-wiki/agents/acme',
      localAgentDomainPath: '/Users/test/Cowork/Cowork/agents/acme',
      sourceOfTruth: 'vps',
      runtimeTarget: 'vps',
      runtimeLabel: 'VPS',
      shareMode,
      ownerUserId: 'owner-1',
      companyId: null,
      contactIds: [],
    },
  }
}

const owner = { uid: 'owner-1', role: 'client', orgId: 'org-1' } as ApiUser
const member = { uid: 'member-1', role: 'client', orgId: 'org-1' } as ApiUser
const outsider = { uid: 'outsider-1', role: 'client', orgId: 'org-2' } as ApiUser

describe('Workspace conversation access', () => {
  it('keeps private conversations owner/participant-only', () => {
    expect(canAccessConversation(owner, conversation('private'))).toBe(true)
    expect(canAccessConversation(member, conversation('private'))).toBe(false)
  })

  it('allows explicitly selected participants into shared conversations', () => {
    expect(canAccessConversation(member, conversation('shared'))).toBe(true)
    expect(canAccessConversation(outsider, conversation('shared'))).toBe(false)
  })

  it('allows authenticated organisation members into org-visible conversations', () => {
    expect(canAccessConversation(member, conversation('org'))).toBe(true)
    expect(canAccessConversation(outsider, conversation('org'))).toBe(false)
  })

  it('provides stable visibility labels', () => {
    expect(conversationVisibilityLabel(conversation('private'))).toBe('Private')
    expect(conversationVisibilityLabel(conversation('shared'))).toBe('Shared')
    expect(conversationVisibilityLabel(conversation('org'))).toBe('Organisation')
  })
})
