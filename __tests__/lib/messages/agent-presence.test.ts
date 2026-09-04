import {
  AGENT_PRESENCE_DONE_DECAY_MS,
  decayDoneToIdle,
  presenceFromRunStatus,
  type AgentPresence,
} from '@/lib/messages/agent-presence'

describe('agent presence helpers', () => {
  it('maps run statuses onto presence states', () => {
    expect(presenceFromRunStatus('queued')).toEqual({ state: 'thinking' })
    expect(presenceFromRunStatus('pending')).toEqual({ state: 'thinking' })
    expect(presenceFromRunStatus('streaming', 'Reading inbox')).toEqual({
      state: 'working',
      currentStep: 'Reading inbox',
    })
    expect(presenceFromRunStatus('running')).toEqual({ state: 'working' })
    expect(presenceFromRunStatus('waiting_approval')).toEqual({ state: 'waiting' })
    expect(presenceFromRunStatus('failed')).toEqual({ state: 'blocked' })
    expect(presenceFromRunStatus('completed')).toEqual({ state: 'done' })
    expect(presenceFromRunStatus('unknown-status')).toBeNull()
  })

  it('decays done to idle after 60 seconds', () => {
    const presence: AgentPresence = {
      orgId: 'org-1',
      agentId: 'theo',
      state: 'done',
      currentStep: 'Finished reply',
      updatedAtMs: 1_000,
    }
    expect(decayDoneToIdle(presence, 1_000 + AGENT_PRESENCE_DONE_DECAY_MS - 1)).toEqual(presence)
    expect(decayDoneToIdle(presence, 1_000 + AGENT_PRESENCE_DONE_DECAY_MS)).toEqual({
      ...presence,
      state: 'idle',
      currentStep: undefined,
    })
    expect(decayDoneToIdle({ ...presence, state: 'working' }, 1_000 + AGENT_PRESENCE_DONE_DECAY_MS * 2)).toEqual({
      ...presence,
      state: 'working',
    })
  })
})
