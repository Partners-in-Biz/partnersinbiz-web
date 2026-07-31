/**
 * Criterion 4 completion wiring: child Hermes finish → completeDelegationChild
 * → branch rich-part patch → parent summary message.
 *
 * Drives the real finalizeDelegationChildRun entry point (not a hand-rolled reimplementation).
 */

const mockCreateMessage = jest.fn()
const mockTouchConversation = jest.fn()
const mockMessagesCollection = jest.fn()
const mockMsgGet = jest.fn()
const mockMsgUpdate = jest.fn()
const mockHermesRunsDocSet = jest.fn()
const mockHermesRunsWhereGet = jest.fn()
const mockCallHermesJson = jest.fn()
const mockGetAgentDispatchHermesProfileLink = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => {
      if (name === 'hermes_runs') {
        return {
          doc: () => ({ set: (...args: unknown[]) => mockHermesRunsDocSet(...args) }),
          where: () => ({
            limit: () => ({ get: () => mockHermesRunsWhereGet() }),
          }),
        }
      }
      return { doc: () => ({}), where: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) }) }
    },
  },
}))

jest.mock('@/lib/conversations/conversations', () => ({
  createMessage: (...args: unknown[]) => mockCreateMessage(...args),
  touchConversation: (...args: unknown[]) => mockTouchConversation(...args),
  messagesCollection: (...args: unknown[]) => mockMessagesCollection(...args),
}))

jest.mock('@/lib/agents/team', () => ({
  getAgentDispatchHermesProfileLink: (...args: unknown[]) => mockGetAgentDispatchHermesProfileLink(...args),
}))

jest.mock('@/lib/hermes/server', () => ({
  HERMES_RUNS_COLLECTION: 'hermes_runs',
  callHermesJson: (...args: unknown[]) => mockCallHermesJson(...args),
}))

import { hermesFeaturesService } from '@/lib/hermes-features/service'
import {
  finalizeDelegationChildRun,
  findPendingDelegationChildRuns,
  reconcilePendingDelegationRuns,
} from '@/lib/conversations/delegation-finalizer'
import { AGENT_DELEGATION_BRANCH_PART } from '@/lib/conversations/agent-delegation'
import { sanitizeDispatchMetadata } from '@/lib/workspaces/dispatch-errors'
import { HERMES_FEATURES_DELEGATION_SOURCE } from '@/lib/hermes-features/delegation-runtime'

describe('finalizeDelegationChildRun — real completion path', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    hermesFeaturesService.useMemoryRepositoryForTests()
    mockMessagesCollection.mockReturnValue({
      doc: () => ({
        get: mockMsgGet,
        update: mockMsgUpdate,
      }),
    })
    mockMsgGet.mockResolvedValue({
      exists: true,
      data: () => ({
        role: 'system',
        content: 'Subagent branch opened (running)',
        richParts: [{ type: AGENT_DELEGATION_BRANCH_PART, status: 'running', children: [] }],
      }),
    })
    mockMsgUpdate.mockResolvedValue(undefined)
    mockCreateMessage.mockImplementation(async (convId: string, msg: Record<string, unknown>) => ({
      id: 'summary-msg-1',
      conversationId: convId,
      ...msg,
    }))
    mockTouchConversation.mockResolvedValue(undefined)
    mockHermesRunsDocSet.mockResolvedValue(undefined)
    mockHermesRunsWhereGet.mockResolvedValue({ empty: true, docs: [] })
  })

  it('spawn child → Hermes complete → completeDelegationChild + branch patch + parent summary', async () => {
    const createRun = jest.fn(async ({ childId, delegationId, agentId }: {
      childId: string
      delegationId: string
      agentId: string
    }) => {
      expect(delegationId).toMatch(/^del_/)
      expect(agentId).toBe('maya')
      return { ok: true, runId: `hermes-run-${childId}`, runDocId: `doc-${childId}` }
    })

    const record = await hermesFeaturesService.spawnObservableDelegations(
      {
        orgId: 'org-1',
        agentId: 'pip',
        conversationId: 'conv-1',
        parentRunHint: 'messages:conv-1',
        goals: [{
          goal: 'Draft social pack',
          context: 'conversationId: conv-1\nrequestedBy: Peet',
          agentId: 'maya',
        }],
      },
      { createRun },
    )

    expect(createRun).toHaveBeenCalledWith(expect.objectContaining({
      delegationId: record.id,
      agentId: 'maya',
      goal: 'Draft social pack',
    }))
    expect(record.children[0].status).toBe('running')

    const linked = await hermesFeaturesService.attachDelegationBranchMessage(
      'org-1',
      record.id,
      'branch-msg-1',
    )
    expect(linked.branchMessageId).toBe('branch-msg-1')

    const finalized = await finalizeDelegationChildRun({
      orgId: 'org-1',
      delegationId: record.id,
      childId: record.children[0].id,
      result: 'Posted 3 LinkedIn drafts for QA.',
      ok: true,
      runId: record.children[0].runId,
      conversationId: 'conv-1',
      branchMessageId: 'branch-msg-1',
    })

    expect(finalized.status).toBe('completed')
    expect(finalized.alreadyFinal).toBeUndefined()
    expect(finalized.summaryMessageId).toBe('summary-msg-1')
    expect(finalized.record?.children[0].status).toBe('done')
    expect(finalized.record?.children[0].result).toContain('LinkedIn')

    // Branch card on the system message is patched with terminal status
    expect(mockMsgUpdate).toHaveBeenCalledWith(expect.objectContaining({
      richParts: expect.arrayContaining([
        expect.objectContaining({
          type: AGENT_DELEGATION_BRANCH_PART,
          status: 'done',
        }),
      ]),
    }))

    // Structured summary re-enters the parent conversation
    expect(mockCreateMessage).toHaveBeenCalledWith('conv-1', expect.objectContaining({
      role: 'assistant',
      authorKind: 'agent',
      authorId: 'maya',
      status: 'completed',
      content: expect.stringContaining('@maya finished'),
    }))
    expect(mockTouchConversation).toHaveBeenCalledWith(
      'conv-1',
      expect.stringContaining('@maya finished'),
      'assistant',
      'summary-msg-1',
    )

    // Idempotent: second finalize does not double-post summary
    mockCreateMessage.mockClear()
    const again = await finalizeDelegationChildRun({
      orgId: 'org-1',
      delegationId: record.id,
      childId: record.children[0].id,
      result: 'ignored',
      ok: true,
    })
    expect(again.alreadyFinal).toBe(true)
    expect(mockCreateMessage).not.toHaveBeenCalled()
  })

  it('failed child marks branch failed and posts failure summary', async () => {
    const record = await hermesFeaturesService.spawnObservableDelegations(
      {
        orgId: 'org-1',
        agentId: 'pip',
        conversationId: 'conv-1',
        parentRunHint: 'p',
        goals: [{ goal: 'Fix invoice', agentId: 'finance' }],
      },
      {
        createRun: async ({ childId }) => ({
          ok: true,
          runId: `run-${childId}`,
          runDocId: `doc-${childId}`,
        }),
      },
    )

    const finalized = await finalizeDelegationChildRun({
      orgId: 'org-1',
      delegationId: record.id,
      childId: record.children[0].id,
      result: 'Gateway timeout',
      ok: false,
      conversationId: 'conv-1',
      branchMessageId: 'branch-x',
    })

    expect(finalized.status).toBe('failed')
    expect(finalized.record?.children[0].status).toBe('failed')
    expect(mockCreateMessage).toHaveBeenCalledWith('conv-1', expect.objectContaining({
      status: 'failed',
      content: expect.stringContaining('@finance branch failed'),
    }))
  })
})

describe('discovery after createHermesRun metadata sanitization (production path)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    hermesFeaturesService.useMemoryRepositoryForTests()
    mockMessagesCollection.mockReturnValue({
      doc: () => ({ get: mockMsgGet, update: mockMsgUpdate }),
    })
    mockMsgGet.mockResolvedValue({
      exists: true,
      data: () => ({
        role: 'system',
        content: 'Subagent branch',
        richParts: [{ type: AGENT_DELEGATION_BRANCH_PART, status: 'running', children: [] }],
      }),
    })
    mockMsgUpdate.mockResolvedValue(undefined)
    mockCreateMessage.mockImplementation(async (convId: string, msg: Record<string, unknown>) => ({
      id: 'summary-msg-1',
      conversationId: convId,
      ...msg,
    }))
    mockTouchConversation.mockResolvedValue(undefined)
    mockHermesRunsDocSet.mockResolvedValue(undefined)
  })

  it('sanitizeDispatchMetadata keeps keys that findPendingDelegationChildRuns requires', async () => {
    // Exact shape written by productionDelegationDeps createRun before createHermesRun sanitizes it.
    const rawProductionMetadata = {
      source: HERMES_FEATURES_DELEGATION_SOURCE,
      delegationId: 'del_999_abc',
      childId: 'child_999_0',
      parentRunHint: 'messages:conv-1:msg:msg-1',
      dispatchAgentId: 'maya',
      orgId: 'org-1',
      conversationId: 'conv-1',
      branchMessageId: 'branch-msg-9',
      messageId: 'branch-msg-9',
      apiKey: 'must-be-stripped',
      baseUrl: 'https://gateway.example',
    }

    const sanitized = sanitizeDispatchMetadata(rawProductionMetadata)
    expect(sanitized.delegationId).toBe('del_999_abc')
    expect(sanitized.childId).toBe('child_999_0')
    expect(sanitized.branchMessageId).toBe('branch-msg-9')
    expect(sanitized.orgId).toBe('org-1')
    expect(sanitized.source).toBe(HERMES_FEATURES_DELEGATION_SOURCE)
    expect(sanitized).not.toHaveProperty('apiKey')
    expect(sanitized).not.toHaveProperty('baseUrl')

    // Persist as hermes_runs would after createHermesRun(sanitizeDispatchMetadata(...))
    mockHermesRunsWhereGet.mockResolvedValue({
      docs: [{
        id: 'ledger-doc-1',
        data: () => ({
          status: 'running',
          hermesRunId: 'hermes-run-child_999_0',
          metadata: sanitized,
        }),
      }],
    })

    const candidates = await findPendingDelegationChildRuns({ maxRuns: 10 })
    expect(candidates).toEqual([
      expect.objectContaining({
        orgId: 'org-1',
        delegationId: 'del_999_abc',
        childId: 'child_999_0',
        runId: 'hermes-run-child_999_0',
        runDocId: 'ledger-doc-1',
        conversationId: 'conv-1',
        branchMessageId: 'branch-msg-9',
        agentId: 'maya',
      }),
    ])
  })

  it('reconcilePendingDelegationRuns: sanitized ledger row → Hermes complete → parent summary', async () => {
    const record = await hermesFeaturesService.spawnObservableDelegations(
      {
        orgId: 'org-1',
        agentId: 'pip',
        conversationId: 'conv-1',
        branchMessageId: 'branch-msg-1',
        parentRunHint: 'messages:conv-1',
        goals: [{ goal: 'Draft posts', context: 'conversationId: conv-1', agentId: 'maya' }],
        delegationId: 'del_reconcile_1',
      },
      {
        createRun: async ({ childId, delegationId }) => ({
          ok: true,
          runId: `hermes-${childId}`,
          runDocId: `doc-${childId}`,
        }),
      },
    )
    expect(record.id).toBe('del_reconcile_1')
    expect(record.children[0].status).toBe('running')

    // What createHermesRun would store after sanitize (production path)
    const sanitized = sanitizeDispatchMetadata({
      source: HERMES_FEATURES_DELEGATION_SOURCE,
      delegationId: record.id,
      childId: record.children[0].id,
      parentRunHint: 'messages:conv-1',
      dispatchAgentId: 'maya',
      orgId: 'org-1',
      conversationId: 'conv-1',
      branchMessageId: 'branch-msg-1',
      messageId: 'branch-msg-1',
    })
    expect(sanitized.delegationId).toBe(record.id)
    expect(sanitized.childId).toBe(record.children[0].id)

    mockHermesRunsWhereGet.mockResolvedValue({
      docs: [{
        id: record.children[0].runDocId,
        data: () => ({
          status: 'completed',
          hermesRunId: record.children[0].runId,
          metadata: sanitized,
        }),
      }],
    })

    mockGetAgentDispatchHermesProfileLink.mockResolvedValue({
      orgId: 'org-1',
      profile: 'maya',
      baseUrl: 'https://hermes.test',
      enabled: true,
      capabilities: {},
      permissions: {},
    })
    mockCallHermesJson.mockResolvedValue({
      response: { ok: true, status: 200 },
      data: { status: 'completed', output: 'Three LinkedIn drafts ready for QA.' },
    })

    const summary = await reconcilePendingDelegationRuns({ maxRuns: 10 })
    expect(summary.candidates).toBe(1)
    expect(summary.completed).toBe(1)
    expect(summary.errors).toBe(0)

    const observed = await hermesFeaturesService.observeDelegation('org-1', record.id)
    expect(observed?.children[0].status).toBe('done')
    expect(observed?.children[0].result).toContain('LinkedIn')

    expect(mockCreateMessage).toHaveBeenCalledWith('conv-1', expect.objectContaining({
      role: 'assistant',
      authorId: 'maya',
      content: expect.stringContaining('@maya finished'),
    }))
    expect(mockMsgUpdate).toHaveBeenCalledWith(expect.objectContaining({
      richParts: expect.arrayContaining([
        expect.objectContaining({ type: AGENT_DELEGATION_BRANCH_PART, status: 'done' }),
      ]),
    }))
  })

  it('stripping delegationId (pre-fix sanitize) would make discovery skip the run', async () => {
    // Documents the bug: without allowlisted keys, findPending returns empty.
    const broken = sanitizeDispatchMetadata({
      source: HERMES_FEATURES_DELEGATION_SOURCE,
      // simulate old allowlist by only keeping keys that used to survive...
      // (new allowlist keeps them — so we strip manually here to prove the guard)
      orgId: 'org-1',
      conversationId: 'conv-1',
      dispatchAgentId: 'maya',
      // omit delegationId/childId intentionally
    })
    mockHermesRunsWhereGet.mockResolvedValue({
      docs: [{
        id: 'ledger-broken',
        data: () => ({
          status: 'running',
          hermesRunId: 'run-x',
          metadata: {
            ...broken,
            source: HERMES_FEATURES_DELEGATION_SOURCE,
            // missing delegationId + childId
          },
        }),
      }],
    })
    const candidates = await findPendingDelegationChildRuns({ maxRuns: 10 })
    expect(candidates).toEqual([])
  })
})
