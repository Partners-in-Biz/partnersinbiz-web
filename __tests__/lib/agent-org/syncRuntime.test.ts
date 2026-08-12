import {
  buildOrgDefaultsFromRuntime,
  buildRuntimePatchFromOrgDefaults,
} from '@/lib/agent-org/syncRuntime'
import type { AgentRuntimeModelSettings } from '@/lib/agents/runtime-config'

const base: AgentRuntimeModelSettings = {
  primaryProvider: 'xai-oauth',
  primaryModel: 'grok-4.6',
  primaryBaseUrl: '',
  reasoningEffort: 'medium',
  fallbacks: [{ provider: 'nous', model: 'deepseek/deepseek-v4-flash' }],
}

describe('agent-org syncRuntime', () => {
  it('patches primary model and effort from org defaults', () => {
    const next = buildRuntimePatchFromOrgDefaults(base, {
      defaultModel: 'deepseek-v4-flash',
      defaultEffort: 'low',
    })
    expect(next.primaryModel).toBe('deepseek-v4-flash')
    expect(next.reasoningEffort).toBe('low')
    expect(next.primaryProvider).toBe('xai-oauth')
    expect(next.fallbacks).toEqual(base.fallbacks)
  })

  it('keeps current values when org defaults are empty', () => {
    const next = buildRuntimePatchFromOrgDefaults(base, {
      defaultModel: '',
      defaultEffort: null,
    })
    expect(next.primaryModel).toBe('grok-4.6')
    expect(next.reasoningEffort).toBe('medium')
  })

  it('maps runtime settings back to org task defaults', () => {
    const defaults = buildOrgDefaultsFromRuntime({
      ...base,
      primaryModel: 'grok-4.6',
      reasoningEffort: 'high',
    })
    expect(defaults.defaultModel).toBe('grok-4.6')
    expect(defaults.defaultEffort).toBe('high')
  })
})
