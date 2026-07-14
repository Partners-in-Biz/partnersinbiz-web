import { resolveConversationDispatchAgentId } from '@/lib/conversations/dispatch-agent'

describe('conversation dispatch-agent resolution', () => {
  it('uses the only selected agent without consulting team state', async () => {
    const isAgentEnabled = jest.fn()
    await expect(resolveConversationDispatchAgentId({
      participantAgentIds: ['maya'],
    }, { isAgentEnabled })).resolves.toBe('maya')
    expect(isAgentEnabled).not.toHaveBeenCalled()
  })

  it('uses an enabled explicit orchestrator for a multi-agent conversation', async () => {
    const isAgentEnabled = jest.fn(async (agentId: string) => agentId === 'pip')
    await expect(resolveConversationDispatchAgentId({
      participantAgentIds: ['maya', 'pip', 'sage'],
      orchestration: { mode: 'pip-orchestrator', dispatcherAgentId: 'pip', requestedAgentIds: ['maya', 'sage'] },
    }, { isAgentEnabled })).resolves.toBe('pip')
  })

  it('fails over to the first selected agent when the orchestrator is disabled or not a participant', async () => {
    await expect(resolveConversationDispatchAgentId({
      participantAgentIds: ['maya', 'pip'],
      orchestration: { mode: 'pip-orchestrator', dispatcherAgentId: 'pip', requestedAgentIds: ['maya'] },
    }, { isAgentEnabled: async () => false })).resolves.toBe('maya')

    const isAgentEnabled = jest.fn(async () => true)
    await expect(resolveConversationDispatchAgentId({
      participantAgentIds: ['maya', 'sage'],
      orchestration: { mode: 'pip-orchestrator', dispatcherAgentId: 'pip', requestedAgentIds: ['maya', 'sage'] },
    }, { isAgentEnabled })).resolves.toBe('maya')
    expect(isAgentEnabled).not.toHaveBeenCalled()
  })
})
