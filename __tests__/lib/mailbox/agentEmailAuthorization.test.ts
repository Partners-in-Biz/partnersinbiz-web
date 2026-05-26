jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: jest.fn() },
}))

import { adminDb } from '@/lib/firebase/admin'
import { authorizeAgentMailboxDelegation } from '@/lib/mailbox/agentEmailAuthorization'

function stageDelegations(records: Record<string, Record<string, unknown>>) {
  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    if (name !== 'mailbox_agent_delegations') throw new Error(`Unexpected collection ${name}`)
    return {
      doc: jest.fn((id: string) => ({
        get: jest.fn(async () => {
          const data = records[id]
          return data ? { id, exists: true, data: () => data } : { id, exists: false, data: () => undefined }
        }),
      })),
    }
  })
}

describe('agent mailbox delegation authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    stageDelegations({})
  })

  it('rejects a legacy ai key guessing another user uid without delegation evidence', async () => {
    await expect(authorizeAgentMailboxDelegation({
      user: { uid: 'ai-agent', role: 'ai', authKind: 'legacy_ai_key' },
      orgId: 'org-1',
      uid: 'user-1',
      actionClass: 'read',
    })).rejects.toMatchObject({ status: 403 })
  })

  it('allows an agent api key only when the permission is scoped to the exact org uid and action', async () => {
    await expect(authorizeAgentMailboxDelegation({
      user: {
        uid: 'agent:theo',
        role: 'ai',
        authKind: 'agent_api_key',
        agentId: 'theo',
        apiKeyId: 'key-1',
        orgId: 'org-1',
        permissions: [{ resource: 'mailbox:org-1:user-1', actions: ['read', 'draft'] }],
      },
      orgId: 'org-1',
      uid: 'user-1',
      actionClass: 'draft',
    })).resolves.toMatchObject({ evidenceType: 'api_key_permission', uid: 'user-1', orgId: 'org-1' })

    await expect(authorizeAgentMailboxDelegation({
      user: {
        uid: 'agent:theo',
        role: 'ai',
        authKind: 'agent_api_key',
        agentId: 'theo',
        apiKeyId: 'key-1',
        orgId: 'org-1',
        permissions: [{ resource: 'mailbox:org-1:user-1', actions: ['read'] }],
      },
      orgId: 'org-1',
      uid: 'user-2',
      actionClass: 'read',
    })).rejects.toMatchObject({ status: 403 })
  })

  it('allows delegated agents only for the delegated uid org and action class', async () => {
    stageDelegations({
      'delegation-1': {
        orgId: 'org-1',
        uid: 'user-1',
        agentId: 'theo',
        status: 'active',
        actionClasses: ['read', 'draft'],
      },
    })

    await expect(authorizeAgentMailboxDelegation({
      user: { uid: 'agent:theo', role: 'ai', authKind: 'agent_api_key', agentId: 'theo', apiKeyId: 'key-1', orgId: 'org-1' },
      orgId: 'org-1',
      uid: 'user-1',
      actionClass: 'read',
      delegationEvidenceId: 'delegation-1',
    })).resolves.toMatchObject({ evidenceId: 'delegation-1', evidenceType: 'delegation_record' })

    await expect(authorizeAgentMailboxDelegation({
      user: { uid: 'agent:theo', role: 'ai', authKind: 'agent_api_key', agentId: 'theo', apiKeyId: 'key-1', orgId: 'org-1' },
      orgId: 'org-1',
      uid: 'user-1',
      actionClass: 'send',
      delegationEvidenceId: 'delegation-1',
    })).rejects.toMatchObject({ status: 403 })
  })

  it('fails closed for cross-org attempts before accepting delegation evidence', async () => {
    stageDelegations({
      'delegation-1': { orgId: 'org-2', uid: 'user-1', agentId: 'theo', status: 'active', actionClasses: ['read'] },
    })

    await expect(authorizeAgentMailboxDelegation({
      user: { uid: 'agent:theo', role: 'ai', authKind: 'agent_api_key', agentId: 'theo', apiKeyId: 'key-1', orgId: 'org-1' },
      orgId: 'org-2',
      uid: 'user-1',
      actionClass: 'read',
      delegationEvidenceId: 'delegation-1',
    })).rejects.toMatchObject({ status: 403 })
  })
})
