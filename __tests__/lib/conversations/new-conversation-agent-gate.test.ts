import {
  filterAgentsByGate,
  resolveNewConversationAgentGate,
} from '@/lib/conversations/new-conversation-agent-gate'

describe('resolveNewConversationAgentGate', () => {
  it('keeps platform agents for general conversation without a machine', () => {
    expect(resolveNewConversationAgentGate({
      scope: 'general',
      runtimeRequired: false,
      runtimeSelected: false,
    })).toEqual({
      mode: 'platform',
      allowedAgentIds: null,
      reason: null,
    })
  })

  it('waits for a computer before showing agents on workspace/company/project', () => {
    expect(resolveNewConversationAgentGate({
      scope: 'company',
      runtimeRequired: true,
      runtimeSelected: false,
    })).toEqual({
      mode: 'awaiting-runtime',
      allowedAgentIds: [],
      reason: 'Select a computer first to see which agents are available there.',
    })
  })

  it('filters to the agents reported on the selected machine', () => {
    expect(resolveNewConversationAgentGate({
      scope: 'project',
      runtimeRequired: true,
      runtimeSelected: true,
      runtimeAvailableAgentIds: ['pip', 'theo', 'pip'],
    })).toEqual({
      mode: 'runtime',
      allowedAgentIds: ['pip', 'theo'],
      reason: null,
    })
  })

  it('shows an empty runtime message when the machine has no healthy agents', () => {
    expect(resolveNewConversationAgentGate({
      scope: 'workspace',
      runtimeRequired: true,
      runtimeSelected: true,
      runtimeAvailableAgentIds: [],
    })).toEqual({
      mode: 'runtime-empty',
      allowedAgentIds: [],
      reason: 'No agents are running on this computer yet. Install or start Hermes agents on it, then retry.',
    })
  })

  it('treats unknown inventory on a selected machine as empty, not the org roster', () => {
    expect(resolveNewConversationAgentGate({
      scope: 'company',
      runtimeRequired: true,
      runtimeSelected: true,
      runtimeAvailableAgentIds: null,
    })).toEqual({
      mode: 'runtime-empty',
      allowedAgentIds: [],
      reason: 'No agents are running on this computer yet. Install or start Hermes agents on it, then retry.',
    })
  })

  it('requires a computer for general chats when the caller marks runtime required', () => {
    expect(resolveNewConversationAgentGate({
      scope: 'general',
      runtimeRequired: true,
      runtimeSelected: false,
    })).toEqual({
      mode: 'awaiting-runtime',
      allowedAgentIds: [],
      reason: 'Select a computer first to see which agents are available there.',
    })
  })
})

describe('filterAgentsByGate', () => {
  const agents = [
    { agentId: 'pip', name: 'Pip' },
    { agentId: 'theo', name: 'Theo' },
    { agentId: 'maya', name: 'Maya' },
  ]

  it('returns all agents when the gate is unrestricted', () => {
    expect(filterAgentsByGate(agents, null)).toEqual(agents)
  })

  it('intersects with the allowed machine inventory', () => {
    expect(filterAgentsByGate(agents, ['theo', 'unknown'])).toEqual([
      { agentId: 'theo', name: 'Theo' },
    ])
  })

  it('returns none when the gate is empty', () => {
    expect(filterAgentsByGate(agents, [])).toEqual([])
  })
})
