import {
  buildDelegationAuthPromptBlock,
  mintMessagesDispatchDelegation,
} from '@/lib/api/delegations'
import type { ApiUser } from '@/lib/api/types'

describe('delegation prompt + messages mint helper', () => {
  it('builds a prompt block with bearer token and org header instructions', () => {
    const block = buildDelegationAuthPromptBlock({
      token: 'pib_dlg_abc',
      expiresAt: '2099-01-01T00:00:00.000Z',
      orgId: 'org-1',
      agentId: 'docs',
      actingForUserId: 'user-1',
      scopes: ['documents:create'],
    })

    expect(block).toContain('[Partners in Biz API auth — user delegation]')
    expect(block).toContain('Authorization: Bearer pib_dlg_abc')
    expect(block).toContain('X-Org-Id: org-1')
    expect(block).toContain('acting for user user-1 as agent docs')
    expect(block).toContain('documents:create')
    expect(block).toContain('Do not use AI_API_KEY')
    expect(block).toContain('/api/v1/agent/email/*')
    expect(block).toContain('Use ONLY the Bearer token in THIS block')
    expect(block).toContain('mailbox call failed')
    expect(block).not.toMatch(/re-send a message to mint a token/i)
    expect(block).not.toMatch(/send any chat message to (re)?mint/i)
  })

  it('includes mailbox delegation evidence when provided', () => {
    const block = buildDelegationAuthPromptBlock({
      token: 'pib_dlg_abc',
      expiresAt: '2099-01-01T00:00:00.000Z',
      orgId: 'org-1',
      agentId: 'docs',
      actingForUserId: 'user-1',
      scopes: ['documents:create'],
      mailboxDelegationEvidenceId: 'mailbox-dlg-1',
    })
    expect(block).toContain('delegationEvidenceId for /api/v1/agent/email/*')
    expect(block).toContain('mailbox-dlg-1')
  })

  it('skips minting for AI system users and nested delegations', async () => {
    const aiUser: ApiUser = { uid: 'agent:pip', role: 'ai', agentId: 'pip' }
    const nested: ApiUser = {
      uid: 'user-1',
      role: 'client',
      authKind: 'user_delegation',
      agentId: 'pip',
      actingForUserId: 'user-1',
    }

    await expect(mintMessagesDispatchDelegation({
      user: aiUser,
      orgId: 'org-1',
      agentId: 'pip',
      conversationId: 'conv-1',
    })).resolves.toBeNull()

    await expect(mintMessagesDispatchDelegation({
      user: nested,
      orgId: 'org-1',
      agentId: 'pip',
      conversationId: 'conv-1',
    })).resolves.toBeNull()
  })
})
