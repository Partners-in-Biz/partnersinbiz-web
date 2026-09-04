import {
  buildAgentRoomSystemPromptSuffix,
  mentionedRoomAgentId,
  messageHasUserEscalation,
  resolveConversationDispatchAgentId,
} from '@/lib/conversations/dispatch-agent'

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

  it('routes a room conversation to an @maya mention', async () => {
    const isAgentEnabled = jest.fn(async () => true)
    await expect(resolveConversationDispatchAgentId({
      participantAgentIds: ['pip', 'maya', 'sage'],
      agentRoom: { roomId: 'org-1_growth-desk' },
      orchestration: { mode: 'pip-orchestrator', dispatcherAgentId: 'pip', requestedAgentIds: ['pip', 'maya', 'sage'] },
    }, { isAgentEnabled, messageContent: 'Need a draft @maya' })).resolves.toBe('maya')
    expect(isAgentEnabled).not.toHaveBeenCalled()
  })

  it('routes a room conversation to dispatcherAgentId when nobody is mentioned', async () => {
    const isAgentEnabled = jest.fn(async (agentId: string) => agentId === 'pip')
    await expect(resolveConversationDispatchAgentId({
      participantAgentIds: ['pip', 'maya'],
      agentRoom: { roomId: 'org-1_growth-desk' },
      orchestration: { mode: 'pip-orchestrator', dispatcherAgentId: 'pip', requestedAgentIds: ['pip', 'maya'] },
    }, { isAgentEnabled, messageContent: 'Stand up the weekly pack' })).resolves.toBe('pip')
  })

  it('does not treat @user as an agent mention', async () => {
    const isAgentEnabled = jest.fn(async () => true)
    await expect(resolveConversationDispatchAgentId({
      participantAgentIds: ['maya', 'pip'],
      agentRoom: { roomId: 'org-1_growth-desk' },
      orchestration: { mode: 'pip-orchestrator', dispatcherAgentId: 'pip', requestedAgentIds: ['maya', 'pip'] },
    }, { isAgentEnabled, messageContent: 'Please decide @user' })).resolves.toBe('pip')
  })
})

describe('agent-room mention helpers', () => {
  it('extracts the first room member mention and ignores @user', () => {
    expect(mentionedRoomAgentId('Need a draft @maya then @user', ['pip', 'maya'])).toBe('maya')
    expect(mentionedRoomAgentId('Please decide @user', ['maya', 'pip'])).toBeNull()
    expect(messageHasUserEscalation('Please decide @user')).toBe(true)
    expect(messageHasUserEscalation('Ask @maya')).toBe(false)
  })

  it('builds a room system prompt suffix with teammate handles', () => {
    const suffix = buildAgentRoomSystemPromptSuffix({
      name: 'Growth desk',
      members: [
        { agentId: 'pip', deviceId: null },
        { agentId: 'maya', deviceId: 'device-a' },
      ],
    })
    expect(suffix).toContain('You are in room Growth desk with teammates @pip, @maya-device-a.')
    expect(suffix).toContain('not a Hermes WebSocket event')
  })
})
