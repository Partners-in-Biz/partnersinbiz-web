import {
  addCrossOrgConversationParticipant,
  canManageCrossOrgConversation,
  canReadCrossOrgConversationMessage,
  evaluateCrossOrgConversationAccess,
  removeCrossOrgConversationParticipant,
  setCrossOrgConversationStatus,
  type CrossOrgConversationPolicy,
} from '@/lib/conversations/cross-org'
import type { Conversation, ConversationMessage } from '@/lib/conversations/types'
import type { ApiUser } from '@/lib/api/types'

const policy: CrossOrgConversationPolicy = {
  decide: jest.fn(async () => ({ allowed: true, reasonCode: 'ALLOWED' as const, chain: [] })),
}

function conversation(): Conversation {
  return {
    id: 'conv-ab',
    orgId: 'org-a',
    startedBy: 'owner-a',
    title: 'A and B project thread',
    participants: [],
    participantUids: ['owner-a', 'member-b', 'member-a'],
    participantAgentIds: ['pip'],
    messageCount: 0,
    archived: false,
    crossOrg: {
      partnerLinkId: 'link-ab',
      ownerOrgId: 'org-a',
      participantOrgIds: ['org-a', 'org-b'],
      thread: { kind: 'project', resourceType: 'project', resourceId: 'project-ab' },
      status: 'active',
      accessEpoch: 3,
      retention: { foreignParticipantRetentionDays: 30 },
      participants: [
        { principalId: 'user:owner-a', kind: 'user', uid: 'owner-a', orgId: 'org-a', role: 'owner', status: 'active' },
        { principalId: 'user:member-a', kind: 'user', uid: 'member-a', orgId: 'org-a', role: 'member', status: 'active' },
        { principalId: 'user:member-b', kind: 'user', uid: 'member-b', orgId: 'org-b', role: 'member', status: 'active' },
        { principalId: 'agent:pip:org-a', kind: 'agent', agentId: 'pip', memberUid: 'owner-a', orgId: 'org-a', role: 'agent', status: 'active' },
      ],
    },
  }
}

const owner = { uid: 'owner-a', role: 'client', orgId: 'org-a' } as ApiUser
const intendedMember = { uid: 'member-b', role: 'client', orgId: 'org-b' } as ApiUser
const unrelatedThirdOrg = { uid: 'member-c', role: 'client', orgId: 'org-c' } as ApiUser
const sameOrgNonParticipant = { uid: 'member-b2', role: 'client', orgId: 'org-b' } as ApiUser

beforeEach(() => jest.clearAllMocks())

describe('cross-organisation Conversation policy adapter', () => {
  it('allows explicitly named recipient-org participants only after the canonical policy decision', async () => {
    await expect(evaluateCrossOrgConversationAccess({
      conversation: conversation(), user: intendedMember, action: 'read', policy,
    })).resolves.toMatchObject({ allowed: true, principalId: 'user:member-b' })
    expect(policy.decide).toHaveBeenCalledWith(expect.objectContaining({
      actor: expect.objectContaining({ userId: 'member-b', orgId: 'org-b' }),
      partnerLinkId: 'link-ab',
      resourceType: 'conversation',
      resourceId: 'conv-ab',
      action: 'read',
      requiredCapability: 'messages',
      recordDecision: false,
    }))
  })

  it('denies an unrelated third org and an ungranted member before a policy decision can leak data', async () => {
    await expect(evaluateCrossOrgConversationAccess({
      conversation: conversation(), user: unrelatedThirdOrg, action: 'read', policy,
    })).resolves.toMatchObject({ allowed: false, reason: 'EXPLICIT_PARTICIPANT_REQUIRED' })
    await expect(evaluateCrossOrgConversationAccess({
      conversation: conversation(), user: sameOrgNonParticipant, action: 'read', policy,
    })).resolves.toMatchObject({ allowed: false, reason: 'EXPLICIT_PARTICIPANT_REQUIRED' })
    expect(policy.decide).not.toHaveBeenCalled()
  })

  it('fails closed immediately when link/grant policy is revoked or the thread is frozen', async () => {
    const deniedPolicy: CrossOrgConversationPolicy = {
      decide: jest.fn(async () => ({ allowed: false, reasonCode: 'GRANT_NOT_ACTIVE' as const, chain: [] })),
    }
    await expect(evaluateCrossOrgConversationAccess({
      conversation: conversation(), user: intendedMember, action: 'read', policy: deniedPolicy,
    })).resolves.toMatchObject({ allowed: false, reason: 'GRANT_NOT_ACTIVE' })

    const frozen = conversation()
    frozen.crossOrg!.status = 'frozen'
    await expect(evaluateCrossOrgConversationAccess({
      conversation: frozen, user: intendedMember, action: 'read', policy,
    })).resolves.toMatchObject({ allowed: false, reason: 'THREAD_FROZEN' })
  })

  it('does not expose a principal-only message or attachment to another named participant', async () => {
    const message: ConversationMessage = {
      id: 'message-a-only', conversationId: 'conv-ab', role: 'user', content: 'A-only',
      authorKind: 'user', authorId: 'owner-a', authorDisplayName: 'A',
      visibility: { principalIds: ['user:owner-a', 'agent:pip:org-a'] },
    }
    await expect(canReadCrossOrgConversationMessage({
      conversation: conversation(), message, user: intendedMember, policy,
    })).resolves.toBe(false)
    await expect(canReadCrossOrgConversationMessage({
      conversation: conversation(), message, user: owner, policy,
    })).resolves.toBe(true)
  })

  it('limits participant and agent management to the source-org owner', () => {
    expect(canManageCrossOrgConversation(owner, conversation())).toBe(true)
    expect(canManageCrossOrgConversation(intendedMember, conversation())).toBe(false)
  })

  it('revokes a foreign participant immediately and fences cached context with accessEpoch', async () => {
    const next = removeCrossOrgConversationParticipant({
      conversation: conversation(),
      actor: owner,
      principalId: 'user:member-b',
      now: 'now',
    })
    expect(next.crossOrg?.accessEpoch).toBe(4)
    expect(next.crossOrg?.participants.find((participant) => participant.principalId === 'user:member-b')).toMatchObject({
      status: 'removed',
      removedByUid: 'owner-a',
    })
    await expect(evaluateCrossOrgConversationAccess({
      conversation: next, user: intendedMember, action: 'read', policy,
    })).resolves.toMatchObject({ allowed: false, reason: 'EXPLICIT_PARTICIPANT_REQUIRED' })
    expect(policy.decide).not.toHaveBeenCalled()
  })

  it('rejects foreign participant management and third-org additions', () => {
    expect(() => removeCrossOrgConversationParticipant({
      conversation: conversation(),
      actor: intendedMember,
      principalId: 'user:member-b',
    })).toThrow(/source-org owner/i)

    expect(() => addCrossOrgConversationParticipant({
      conversation: conversation(),
      actor: owner,
      participant: {
        principalId: 'user:member-c',
        kind: 'user',
        uid: 'member-c',
        orgId: 'org-c',
        role: 'member',
        status: 'active',
      },
    })).toThrow(/outside this bilateral thread/i)
  })

  it('freezes the thread for all foreign access while keeping owner management possible', async () => {
    const frozen = setCrossOrgConversationStatus({
      conversation: conversation(),
      actor: owner,
      status: 'frozen',
    })
    expect(frozen.crossOrg?.accessEpoch).toBe(4)
    await expect(evaluateCrossOrgConversationAccess({
      conversation: frozen, user: intendedMember, action: 'read', policy,
    })).resolves.toMatchObject({ allowed: false, reason: 'THREAD_FROZEN' })
  })
})
