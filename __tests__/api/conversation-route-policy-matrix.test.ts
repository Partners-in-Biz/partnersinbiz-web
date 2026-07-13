import {
  canAppendAgentMessage,
  canDeleteConversation,
  canStopConversationRun,
} from '@/lib/conversations/access'
import type { ApiUser } from '@/lib/api/types'
import type { Conversation } from '@/lib/conversations/types'

type Visibility = 'private' | 'shared' | 'org'

function conversation(shareMode: Visibility): Conversation {
  return {
    id: `conv-${shareMode}`,
    orgId: 'org-1',
    title: `${shareMode} conversation`,
    startedBy: 'owner-1',
    participantUids: ['owner-1', 'member-1'],
    participantAgentIds: ['pip'],
    participants: [],
    status: 'active',
    archived: false,
    messageCount: 0,
    workspaceContext: {
      workspaceId: 'workspace-1',
      orgId: 'org-1',
      orgSlug: 'org-1',
      orgName: 'Org One',
      agentDomain: 'org-1',
      vpsPath: '/workspace',
      localPath: '/workspace',
      agentDomainPath: '/agents/org-1',
      localAgentDomainPath: '/agents/org-1',
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

const actors = {
  owner: { uid: 'owner-1', role: 'client', orgId: 'org-1' },
  explicitHuman: { uid: 'member-1', role: 'client', orgId: 'org-1' },
  orgMember: { uid: 'member-2', role: 'client', orgId: 'org-1' },
  scopedAdmin: { uid: 'admin-1', role: 'admin', allowedOrgIds: ['org-1'] },
  explicitAi: { uid: 'agent:pip', role: 'ai', agentId: 'pip', orgId: 'org-1' },
  nonparticipantAi: { uid: 'agent:maya', role: 'ai', agentId: 'maya', orgId: 'org-1' },
} satisfies Record<string, ApiUser>

const expectations = {
  delete: {
    owner: true,
    explicitHuman: false,
    orgMember: false,
    scopedAdmin: true,
    explicitAi: false,
    nonparticipantAi: false,
  },
  stop: {
    owner: true,
    explicitHuman: true,
    orgMember: false,
    scopedAdmin: true,
    explicitAi: true,
    nonparticipantAi: false,
  },
  append: {
    owner: false,
    explicitHuman: false,
    orgMember: false,
    scopedAdmin: true,
    explicitAi: true,
    nonparticipantAi: false,
  },
} as const

describe.each(['private', 'shared', 'org'] as const)('%s conversation mutation policy', (visibility) => {
  const policy = {
    delete: canDeleteConversation,
    stop: canStopConversationRun,
    append: canAppendAgentMessage,
  }

  for (const action of Object.keys(policy) as Array<keyof typeof policy>) {
    it.each(Object.keys(actors) as Array<keyof typeof actors>)(`${action}: %s`, (actor) => {
      expect(policy[action](actors[actor], conversation(visibility))).toBe(expectations[action][actor])
    })
  }
})

describe('conversation mutation policy tenant boundaries', () => {
  const restrictedAdmin = { uid: 'admin-2', role: 'admin', allowedOrgIds: ['org-2'] } as ApiUser
  const crossOrgAi = { uid: 'agent:pip', role: 'ai', agentId: 'pip', orgId: 'org-2' } as ApiUser

  it.each([canDeleteConversation, canStopConversationRun, canAppendAgentMessage])(
    'rejects a manager outside the conversation organisation',
    (policy) => expect(policy(restrictedAdmin, conversation('org'))).toBe(false),
  )

  it.each([canDeleteConversation, canStopConversationRun, canAppendAgentMessage])(
    'rejects an AI participant whose credential is scoped to another organisation',
    (policy) => expect(policy(crossOrgAi, conversation('org'))).toBe(false),
  )
})
