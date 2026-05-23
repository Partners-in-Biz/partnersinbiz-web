import {
  AgentCapabilityError,
  agentHasCapability,
  assertAgentCapability,
  assertAgentCapabilityForApiUser,
  getAgentCapabilityGate,
} from '@/lib/agents/capabilities'

describe('agent capability policy', () => {
  it('knows which specialist owns risky capabilities', () => {
    expect(agentHasCapability('ads', 'spend')).toBe(true)
    expect(agentHasCapability('theo', 'deploy')).toBe(true)
    expect(agentHasCapability('maya', 'spend')).toBe(false)
    expect(agentHasCapability('support', 'message_client')).toBe(true)
  })

  it('requires hard approval for risky actions', () => {
    expect(() => assertAgentCapability(
      { uid: 'agent:ads', role: 'ai', authKind: 'agent_api_key', agentId: 'ads' },
      'spend',
      { approvalStatus: 'pending' },
    )).toThrow(AgentCapabilityError)

    expect(assertAgentCapability(
      { uid: 'agent:ads', role: 'ai', authKind: 'agent_api_key', agentId: 'ads' },
      'spend',
      { approvalStatus: 'approved', approvalGateTaskId: 'gate-1' },
    )).toEqual({ ok: true, gateRequired: true })
  })

  it('allows non-risky granted capabilities without approval', () => {
    expect(assertAgentCapability(
      { uid: 'agent:docs', role: 'ai', authKind: 'agent_api_key', agentId: 'docs' },
      'draft',
    )).toEqual({ ok: true, gateRequired: false })
  })

  it('does not block human sessions at the agent gate', () => {
    expect(assertAgentCapabilityForApiUser(
      { uid: 'admin-1', role: 'admin', authKind: 'session' },
      'spend',
    )).toEqual({ ok: true, gateRequired: false })
  })

  it('keeps the legacy AI key as a migration fallback', () => {
    expect(assertAgentCapabilityForApiUser(
      { uid: 'ai-agent', role: 'ai', authKind: 'legacy_ai_key' },
      'deploy',
    )).toEqual({ ok: true, gateRequired: false })
  })

  it('documents the gate reason for production release work', () => {
    expect(getAgentCapabilityGate('qa-release', 'deploy')).toEqual(expect.objectContaining({
      requiresApproval: true,
      reason: expect.stringContaining('production'),
    }))
  })
})
