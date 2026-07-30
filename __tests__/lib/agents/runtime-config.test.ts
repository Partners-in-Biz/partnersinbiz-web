import {
  applyAgentRuntimeModelSettings,
  buildRuntimeModelSummary,
  extractRuntimeModelSettings,
  formatRegistryDefaultModel,
  parseRuntimeModelSettings,
} from '@/lib/agents/runtime-config'

describe('buildRuntimeModelSummary', () => {
  const baseAgent = {
    agentId: 'pip',
    defaultModel: 'gpt-5.5 / glm-4.7',
  }

  it('prefers live Hermes model provider and fallback over stale registry labels', () => {
    const summary = buildRuntimeModelSummary(baseAgent, {
      config: {
        model: { provider: 'openai-codex', default: 'gpt-5.5' },
        agent: { reasoning_effort: 'high', max_turns: 90 },
        fallback_providers: [
          { provider: 'anthropic', model: 'claude-sonnet-4-6' },
        ],
      },
    })

    expect(summary).toMatchObject({
      source: 'live_config',
      primaryProvider: 'openai-codex',
      primaryModel: 'gpt-5.5',
      fallbackProvider: 'anthropic',
      fallbackModel: 'claude-sonnet-4-6',
      reasoningEffort: 'high',
      registryDefaultModel: 'gpt-5.5 / glm-4.7',
      staleRegistry: true,
    })
    expect(summary.label).toBe('openai-codex / gpt-5.5 → anthropic / claude-sonnet-4-6')
  })

  it('falls back to the registry default when live config is unavailable', () => {
    const summary = buildRuntimeModelSummary({ agentId: 'support', defaultModel: 'gpt-5.4' }, null)

    expect(summary).toMatchObject({
      source: 'registry',
      primaryModel: 'gpt-5.4',
      registryDefaultModel: 'gpt-5.4',
      staleRegistry: false,
    })
    expect(summary.label).toBe('gpt-5.4')
  })
})

describe('extract/apply/parse runtime model settings', () => {
  const sampleConfig = {
    model: {
      provider: 'openai-codex',
      default: 'gpt-5.6-luna',
      base_url: 'https://chatgpt.com/backend-api/codex',
    },
    agent: {
      max_turns: 90,
      reasoning_effort: 'medium',
    },
    fallback_providers: [
      { provider: 'xai', model: 'grok-4.20-0309-reasoning' },
      { provider: 'gemini', model: 'gemini-2.5-pro' },
    ],
    skills: { external_dirs: ['/skills/pip'] },
  }

  it('extracts primary, effort, and all fallbacks from live config', () => {
    expect(extractRuntimeModelSettings({ config: sampleConfig })).toEqual({
      primaryProvider: 'openai-codex',
      primaryModel: 'gpt-5.6-luna',
      primaryBaseUrl: 'https://chatgpt.com/backend-api/codex',
      reasoningEffort: 'medium',
      fallbacks: [
        { provider: 'xai', model: 'grok-4.20-0309-reasoning' },
        { provider: 'gemini', model: 'gemini-2.5-pro' },
      ],
    })
  })

  it('applies settings without wiping unrelated keys', () => {
    const next = applyAgentRuntimeModelSettings(sampleConfig, {
      primaryProvider: 'xai',
      primaryModel: 'grok-4.20-0309-reasoning',
      primaryBaseUrl: '',
      reasoningEffort: 'high',
      fallbacks: [
        { provider: 'openai-codex', model: 'gpt-5.6-sol' },
      ],
    })

    expect(next.model).toEqual({
      provider: 'xai',
      default: 'grok-4.20-0309-reasoning',
    })
    expect(next.fallback_providers).toEqual([
      { provider: 'openai-codex', model: 'gpt-5.6-sol' },
    ])
    expect(next.agent).toMatchObject({
      max_turns: 90,
      reasoning_effort: 'high',
    })
    expect(next.skills).toEqual({ external_dirs: ['/skills/pip'] })
  })

  it('clears reasoning effort when unset and validates parse payloads', () => {
    const cleared = applyAgentRuntimeModelSettings(sampleConfig, {
      primaryProvider: 'openai-codex',
      primaryModel: 'gpt-5.6-luna',
      primaryBaseUrl: 'https://chatgpt.com/backend-api/codex',
      reasoningEffort: '',
      fallbacks: [],
    })
    expect((cleared.agent as { reasoning_effort: string }).reasoning_effort).toBe('')
    expect(cleared.fallback_providers).toEqual([])

    expect(parseRuntimeModelSettings({
      primaryProvider: 'xai',
      primaryModel: 'grok-4',
      reasoningEffort: 'xhigh',
      fallbacks: [{ provider: 'anthropic', model: 'claude-sonnet-4-6' }],
    })).toEqual({
      ok: true,
      settings: {
        primaryProvider: 'xai',
        primaryModel: 'grok-4',
        primaryBaseUrl: '',
        reasoningEffort: 'xhigh',
        fallbacks: [{ provider: 'anthropic', model: 'claude-sonnet-4-6' }],
      },
    })

    expect(parseRuntimeModelSettings({ primaryProvider: 'xai' }).ok).toBe(false)
    expect(parseRuntimeModelSettings({
      primaryProvider: 'xai',
      primaryModel: 'grok-4',
      reasoningEffort: 'insane',
    }).ok).toBe(false)
  })

  it('formats a registry defaultModel label from primary + first fallback', () => {
    expect(formatRegistryDefaultModel({
      primaryProvider: 'openai-codex',
      primaryModel: 'gpt-5.6-luna',
      primaryBaseUrl: '',
      reasoningEffort: 'high',
      fallbacks: [{ provider: 'xai', model: 'grok-4.20-0309-reasoning' }],
    })).toBe('openai-codex / gpt-5.6-luna → xai / grok-4.20-0309-reasoning')
  })
})

