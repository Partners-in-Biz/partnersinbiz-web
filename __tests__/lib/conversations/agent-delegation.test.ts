import {
  AGENT_DELEGATION_BRANCH_PART,
  applyChildCompletionToBranch,
  buildAgentDelegationBranchPart,
  buildChatDelegationGoals,
  buildChildSummaryParentMessage,
  buildDelegationBranchSystemMessage,
  extractAgentMentionsForDelegation,
  overallDelegationStatus,
} from '@/lib/conversations/agent-delegation'
import {
  completeChild,
  markChildUnknown,
  normalizeDelegationGoals,
  spawnDelegations,
} from '@/lib/hermes-features/delegation'
import {
  completeDelegationChild,
  spawnObservableDelegations,
} from '@/lib/hermes-features/delegation-runtime'
import { createMemoryRepository } from '@/lib/hermes-features/repository'
import {
  buildConversationMentionLink,
} from '@/lib/comments/conversation-mentions'

describe('chat-native agent delegation (criterion 4)', () => {
  it('extracts @agent tags excluding the primary dispatcher', () => {
    expect(extractAgentMentionsForDelegation([
      { type: 'agent', id: 'pip', raw: '@agent:pip' },
      { type: 'agent', id: 'maya', raw: '@agent:maya' },
      { type: 'user', id: 'u1', raw: '@user:u1' },
      { type: 'agent', id: 'maya', raw: '@agent:maya' },
      { type: 'agent', id: 'sales', raw: '@agent:sales' },
    ], { excludeAgentIds: ['pip'] })).toEqual(['maya', 'sales'])
  })

  it('builds Hermes-style goal+context packages per specialist', () => {
    const goals = buildChatDelegationGoals({
      agentIds: ['maya', 'sales'],
      messageContent: 'Please draft the LinkedIn launch and update the CRM @agent:maya @agent:sales',
      parentAgentId: 'pip',
      parentMessageId: 'msg-1',
      conversationId: 'conv-1',
      actorDisplayName: 'Peet',
    })
    expect(goals).toHaveLength(2)
    expect(goals[0]).toMatchObject({ agentId: 'maya' })
    expect(goals[0].goal).toContain('@agent:maya')
    expect(goals[0].context).toContain('conversationId: conv-1')
    expect(goals[0].context).toContain('parentAgent: pip')
    expect(goals[0].context).toContain('do not re-delegate')
    expect(goals[1].agentId).toBe('sales')
  })

  it('spawns pure children as queued with optional agent overrides', () => {
    const spawn = spawnDelegations({
      parentRunHint: 'messages:conv-1',
      goals: [
        { goal: 'Draft social', context: 'brand kit v2', agentId: 'maya' },
        { goal: 'Update deal', agentId: 'sales' },
      ],
      maxConcurrent: 2,
    })
    expect(spawn.children).toHaveLength(2)
    expect(spawn.children[0]).toMatchObject({
      status: 'queued',
      agentId: 'maya',
      context: 'brand kit v2',
    })
    expect(spawn.children.every((c) => c.status === 'queued')).toBe(true)
  })

  it('normalizes mixed string and structured goals', () => {
    expect(normalizeDelegationGoals(['  a  ', { goal: 'b', agentId: 'maya' }, '  ', { goal: '' }])).toEqual([
      { goal: 'a' },
      { goal: 'b', agentId: 'maya' },
    ])
  })

  it('spawn → complete → parent summary transitions through running/done', async () => {
    const repo = createMemoryRepository()
    const createRun = jest.fn(async ({ childId, agentId, goal, context }: {
      childId: string
      agentId: string
      goal: string
      context?: string
    }) => {
      expect(goal).toBeTruthy()
      expect(context).toContain('conversationId')
      return { ok: true, runId: `run-${agentId}-${childId}`, runDocId: `doc-${childId}` }
    })

    const record = await spawnObservableDelegations({
      orgId: 'org-1',
      agentId: 'pip',
      conversationId: 'conv-1',
      parentRunHint: 'messages:conv-1',
      goals: buildChatDelegationGoals({
        agentIds: ['maya'],
        messageContent: 'Handle the social pack @agent:maya',
        parentAgentId: 'pip',
        conversationId: 'conv-1',
      }),
    }, repo, { createRun })

    expect(createRun).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'maya',
      orgId: 'org-1',
      conversationId: 'conv-1',
    }))
    expect(record.children[0].status).toBe('running')
    expect(record.children[0].agentId).toBe('maya')
    expect(record.children[0].runId).toMatch(/^run-maya-/)

    const branchOpen = buildAgentDelegationBranchPart(record)
    expect(branchOpen.type).toBe(AGENT_DELEGATION_BRANCH_PART)
    expect(branchOpen.status).toBe('running')
    expect(branchOpen.children[0].status).toBe('running')

    const systemMsg = buildDelegationBranchSystemMessage({
      conversationId: 'conv-1',
      record,
    })
    expect(systemMsg.authorKind).toBe('system')
    expect(systemMsg.richParts?.[0]).toMatchObject({
      type: AGENT_DELEGATION_BRANCH_PART,
      status: 'running',
    })

    const completed = await completeDelegationChild(
      'org-1',
      record.id,
      record.children[0].id,
      'Drafted 3 LinkedIn posts and queued for QA.',
      true,
      repo,
    )
    expect(completed.children[0].status).toBe('done')
    expect(completed.children[0].result).toContain('LinkedIn')

    const summary = buildChildSummaryParentMessage({
      conversationId: 'conv-1',
      record: completed,
      childId: completed.children[0].id,
    })
    expect(summary).toMatchObject({
      role: 'assistant',
      authorKind: 'agent',
      authorId: 'maya',
      status: 'completed',
    })
    expect(summary?.content).toContain('@maya finished')
    expect(summary?.content).toContain('LinkedIn')
    expect(summary?.richParts?.[0]).toMatchObject({
      type: AGENT_DELEGATION_BRANCH_PART,
      status: 'done',
    })
  })

  it('marks failed and unknown child states distinctly', () => {
    const child = spawnDelegations({
      parentRunHint: 'p',
      goals: ['x'],
    }).children[0]
    expect(completeChild(child, 'boom', false).status).toBe('failed')
    expect(markChildUnknown(child, 'runtime lost').status).toBe('unknown')
    expect(overallDelegationStatus([
      { status: 'done' },
      { status: 'running' },
    ])).toBe('partial')
    expect(overallDelegationStatus([
      { status: 'failed' },
      { status: 'unknown' },
    ])).toBe('failed')
  })

  it('applies child completion onto a branch card snapshot', () => {
    const part = applyChildCompletionToBranch({
      type: AGENT_DELEGATION_BRANCH_PART,
      id: 'branch_1',
      title: 'Branch',
      delegationId: 'del_1',
      parentRunHint: 'p',
      parentAgentId: 'pip',
      status: 'running',
      children: [
        { id: 'c1', agentId: 'maya', goal: 'g', status: 'running' },
      ],
    }, 'c1', 'done summary', true)
    expect(part.status).toBe('done')
    expect(part.children[0].status).toBe('done')
    expect(part.summary).toContain('@maya')
  })
})

describe('conversation mention deep links (criterion 1)', () => {
  it('builds Messages deep links with convId', () => {
    expect(buildConversationMentionLink({
      orgSlug: 'partners-in-biz',
      conversationId: 'conv-abc',
      messageId: 'msg-1',
    })).toBe('/admin/org/partners-in-biz/messages?convId=conv-abc&messageId=msg-1')

    expect(buildConversationMentionLink({
      conversationId: 'conv-abc',
    })).toBe('/admin/messages?convId=conv-abc')
  })
})
