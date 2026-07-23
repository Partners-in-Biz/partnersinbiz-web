import {
  COMPANY_COWORK_ENSURE_BUDGET_MS,
  conversationTimestampMs,
  ensureCompanyCoworkFolderWithinBudget,
  formatCreateConversationNetworkError,
  isNetworkFetchFailure,
  matchReconciledCreatedConversation,
  newConversationCreateIdempotencyKey,
} from '@/lib/conversations/create-resilience'

describe('conversation create resilience helpers', () => {
  it('detects browser network failures that hide a successful create', () => {
    expect(isNetworkFetchFailure(new TypeError('Failed to fetch'))).toBe(true)
    expect(isNetworkFetchFailure(new Error('NetworkError when attempting to fetch resource.'))).toBe(true)
    expect(isNetworkFetchFailure(new Error('Computer unavailable'))).toBe(false)
    expect(formatCreateConversationNetworkError('checking')).toContain('checking if the chat was created')
    expect(formatCreateConversationNetworkError('unconfirmed')).toContain('may already exist')
  })

  it('parses Firestore-ish timestamps for reconcile windows', () => {
    expect(conversationTimestampMs({ seconds: 1_700_000_000 })).toBe(1_700_000_000_000)
    expect(conversationTimestampMs({ _seconds: 1_700_000_000 })).toBe(1_700_000_000_000)
    expect(conversationTimestampMs('2026-07-23T08:22:36.197Z')).toBe(Date.parse('2026-07-23T08:22:36.197Z'))
  })

  it('matches a just-created company conversation after a dropped create response', () => {
    const now = Date.parse('2026-07-23T08:22:50.000Z')
    const matched = matchReconciledCreatedConversation(
      [
        {
          id: 'old',
          startedBy: 'user-1',
          scope: 'company',
          scopeRefId: 'company-ahs',
          participantAgentIds: ['pip'],
          messageCount: 0,
          title: 'New conversation',
          createdAt: { seconds: Math.floor(Date.parse('2026-07-23T07:00:00.000Z') / 1000) },
          workspaceContext: {
            workspaceId: 'ws-1',
            runtimeTarget: 'linked-device:mac',
            companyId: 'company-ahs',
          },
        },
        {
          id: '25y1fEodknhwsNItSpTR',
          startedBy: 'user-1',
          scope: 'company',
          scopeRefId: 'company-ahs',
          participantAgentIds: ['pip'],
          messageCount: 0,
          title: 'New conversation',
          createdAt: { seconds: Math.floor(Date.parse('2026-07-23T08:22:36.197Z') / 1000) },
          workspaceContext: {
            workspaceId: 'ws-1',
            runtimeTarget: 'linked-device:mac',
            companyId: 'company-ahs',
          },
        },
      ],
      {
        startedBy: 'user-1',
        scope: 'company',
        scopeRefId: 'company-ahs',
        companyId: 'company-ahs',
        workspaceId: 'ws-1',
        runtimeTarget: 'linked-device:mac',
        agentIds: ['pip'],
        nowMs: now,
      },
    )

    expect(matched?.id).toBe('25y1fEodknhwsNItSpTR')
  })

  it('ignores conversations that already have messages or mismatched agents', () => {
    const now = Date.now()
    expect(matchReconciledCreatedConversation(
      [{
        id: 'busy',
        startedBy: 'user-1',
        scope: 'general',
        participantAgentIds: ['pip'],
        messageCount: 2,
        createdAt: { seconds: Math.floor(now / 1000) },
      }],
      { startedBy: 'user-1', scope: 'general', agentIds: ['pip'], nowMs: now },
    )).toBeNull()

    expect(matchReconciledCreatedConversation(
      [{
        id: 'wrong-agent',
        startedBy: 'user-1',
        scope: 'general',
        participantAgentIds: ['theo'],
        messageCount: 0,
        createdAt: { seconds: Math.floor(now / 1000) },
      }],
      { startedBy: 'user-1', scope: 'general', agentIds: ['pip'], nowMs: now },
    )).toBeNull()
  })

  it('generates conversation create idempotency keys', () => {
    expect(newConversationCreateIdempotencyKey()).toMatch(/^conversation-create:/)
  })

  it('soft-succeeds company ensure when the budget elapses', async () => {
    const result = await ensureCompanyCoworkFolderWithinBudget(
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
        return { ok: true as const, workspace: { id: 'late' }, createdOrVerified: true as const }
      },
      5,
    )
    expect(result).toEqual({ ok: true, deferred: true, reason: 'company_ensure_timeout' })
    expect(COMPANY_COWORK_ENSURE_BUDGET_MS).toBeGreaterThan(1000)
  })

  it('returns hard ensure failures inside the budget', async () => {
    const result = await ensureCompanyCoworkFolderWithinBudget(
      async () => ({ ok: false as const, code: 'company_workspace_missing' as const, error: 'missing' }),
      100,
    )
    expect(result).toEqual({ ok: false, code: 'company_workspace_missing', error: 'missing' })
  })
})
