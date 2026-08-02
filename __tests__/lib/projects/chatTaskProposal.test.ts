import {
  buildTaskCreateBodiesFromProposal,
  createProposedTasksFromMessage,
  extractProjectTaskProposal,
  findPrecedingUserMessageId,
  isCreateTasksUiAction,
} from '@/lib/projects/chatTaskProposal'

describe('chatTaskProposal', () => {
  it('detects Create tasks ui actions', () => {
    expect(isCreateTasksUiAction({ type: 'custom', label: 'Create tasks', id: 'create-chain' })).toBe(true)
    expect(isCreateTasksUiAction({ type: 'custom', label: 'Retry', id: 'retry-run' })).toBe(false)
    expect(isCreateTasksUiAction({ type: 'custom', label: 'Go', actionId: 'create-chain' })).toBe(true)
  })

  it('extracts a project_task_proposal and builds ordered create bodies with dependsOn', () => {
    const proposal = extractProjectTaskProposal({
      richParts: [{
        type: 'project_task_proposal',
        title: 'Phase 2 chain',
        projectId: 'project-finance',
        bundleId: 'bundle-1',
        tasks: [
          { title: 'Design schema', assigneeAgentId: 'theo', dependencySequence: [] },
          { title: 'Implement APIs', assigneeAgentId: 'theo', dependencySequence: [0], reviewerAgentId: 'qa-release' },
        ],
      }],
    })
    expect(proposal).toMatchObject({
      projectId: 'project-finance',
      bundleId: 'bundle-1',
      tasks: [
        expect.objectContaining({ title: 'Design schema', assigneeAgentId: 'theo' }),
        expect.objectContaining({ title: 'Implement APIs', dependencySequence: [0] }),
      ],
    })

    const bodies = buildTaskCreateBodiesFromProposal({
      proposal: proposal!,
      conversationId: 'conv-1',
      requestMessageId: 'msg-user',
      responseMessageId: 'msg-assistant',
      createdTaskIdsBySequence: { 0: 'task-a' },
    })
    expect(bodies[0]).toMatchObject({
      title: 'Design schema',
      assigneeAgentId: 'theo',
      chatOrigin: {
        conversationId: 'conv-1',
        requestMessageId: 'msg-user',
        responseMessageId: 'msg-assistant',
        bundleId: 'bundle-1',
        sequence: 0,
      },
    })
    expect(bodies[0].dependsOn).toBeUndefined()
    expect(bodies[1]).toMatchObject({
      title: 'Implement APIs',
      dependsOn: ['task-a'],
      reviewerAgentId: 'qa-release',
    })
  })

  it('finds the preceding user message for chatOrigin', () => {
    expect(findPrecedingUserMessageId([
      { id: 'u1', role: 'user' },
      { id: 'a1', role: 'assistant' },
      { id: 'u2', role: 'user' },
      { id: 'a2', role: 'assistant' },
    ], 'a2')).toBe('u2')
  })

  it('creates tasks sequentially through the projects API without Hermes', async () => {
    const fetchImpl = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as { chatOrigin?: { sequence?: number }; title?: string }
      if (url.includes('/projects/project-finance/tasks') && init?.method === 'POST') {
        return {
          ok: true,
          status: 201,
          json: async () => ({ data: { id: `task-${body.chatOrigin?.sequence ?? 0}` } }),
        } as Response
      }
      throw new Error(`unexpected fetch ${url}`)
    })

    const result = await createProposedTasksFromMessage({
      orgId: 'org-1',
      conversationId: 'conv-1',
      message: {
        id: 'msg-assistant',
        richParts: [{
          type: 'project_task_proposal',
          projectId: 'project-finance',
          bundleId: 'bundle-1',
          tasks: [
            { title: 'Task A', assigneeAgentId: 'theo', dependencySequence: [] },
            { title: 'Task B', assigneeAgentId: 'maya', dependencySequence: [0] },
          ],
        }],
      },
      messages: [
        { id: 'msg-user', role: 'user' },
        { id: 'msg-assistant', role: 'assistant' },
      ],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(result.createdTaskIds).toEqual(['task-0', 'task-1'])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const secondBody = JSON.parse(String(fetchImpl.mock.calls[1][1]?.body ?? '{}')) as {
      dependsOn?: string[]
      chatOrigin?: { sequence?: number; requestMessageId?: string }
    }
    expect(secondBody.dependsOn).toEqual(['task-0'])
    expect(secondBody.chatOrigin).toMatchObject({
      sequence: 1,
      requestMessageId: 'msg-user',
    })
    expect(fetchImpl.mock.calls[0][1]?.headers).toEqual(
      expect.objectContaining({ 'X-Org-Id': 'org-1' }),
    )
  })
})
