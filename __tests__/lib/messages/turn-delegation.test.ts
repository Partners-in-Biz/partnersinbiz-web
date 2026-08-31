import type { ApiUser } from '@/lib/api/types'

const mockMintMessagesDispatchDelegation = jest.fn()

jest.mock('@/lib/api/delegations', () => {
  const actual = jest.requireActual('@/lib/api/delegations') as typeof import('@/lib/api/delegations')
  return {
    ...actual,
    mintMessagesDispatchDelegation: (...args: unknown[]) => mockMintMessagesDispatchDelegation(...args),
  }
})

import {
  buildDelegationAuthPromptBlock,
  CHAT_REMINT_RITUAL_PATTERNS,
} from '@/lib/api/delegations'

describe('fresh Messages turn delegation injector', () => {
  const staff: ApiUser = {
    uid: 'staff-1',
    role: 'admin',
    authKind: 'session',
    orgId: 'org-1',
    activeOrgId: 'org-1',
    orgIds: ['org-1'],
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockMintMessagesDispatchDelegation.mockResolvedValue({
      id: 'dlg-fresh',
      token: 'pib_dlg_fresh_turn_token',
      expiresAt: '2099-01-01T00:00:00.000Z',
      actingForUserId: 'staff-1',
      agentId: 'pip',
      orgIds: ['org-1'],
      scopes: ['documents:create'],
    })
  })

  it('mints a fresh pib_dlg_ at turn start via the system-auth mint path', async () => {
    const { mintFreshMessagesTurnDelegation } = await import('@/lib/messages/turn-delegation')

    const minted = await mintFreshMessagesTurnDelegation({
      user: staff,
      orgId: 'org-1',
      agentId: 'pip',
      conversationId: 'conv-1',
    })

    expect(mockMintMessagesDispatchDelegation).toHaveBeenCalledTimes(1)
    expect(mockMintMessagesDispatchDelegation).toHaveBeenCalledWith({
      user: staff,
      orgId: 'org-1',
      agentId: 'pip',
      conversationId: 'conv-1',
    })
    expect(minted?.token).toBe('pib_dlg_fresh_turn_token')
  })

  it('returns null when mint fails instead of inventing a token', async () => {
    mockMintMessagesDispatchDelegation.mockResolvedValueOnce(null)
    const { mintFreshMessagesTurnDelegation } = await import('@/lib/messages/turn-delegation')

    const minted = await mintFreshMessagesTurnDelegation({
      user: staff,
      orgId: 'org-1',
      agentId: 'pip',
      conversationId: 'conv-1',
    })

    expect(minted).toBeNull()
  })
})

describe('delegation prompt copy — no remint-via-chat ritual', () => {
  it('does not tell staff to re-send a chat message to mint a token', () => {
    const block = buildDelegationAuthPromptBlock({
      token: 'pib_dlg_abc',
      expiresAt: '2099-01-01T00:00:00.000Z',
      orgId: 'org-1',
      agentId: 'pip',
      actingForUserId: 'staff-1',
      scopes: ['documents:create'],
      mailboxDelegationEvidenceId: 'mailbox-dlg-1',
    })

    for (const pattern of CHAT_REMINT_RITUAL_PATTERNS) {
      expect(block).not.toMatch(pattern)
    }
    expect(block).toContain('Use ONLY the Bearer token in THIS block')
    expect(block).toContain('mailbox call failed')
    expect(block).toContain('Do not use AI_API_KEY')
  })
})
