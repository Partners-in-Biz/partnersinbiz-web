import { buildRuntimeModelSummary } from '@/lib/agents/runtime-config'

describe('buildRuntimeModelSummary', () => {
  const baseAgent = {
    agentId: 'pip',
    defaultModel: 'gpt-5.5 / glm-4.7',
  }

  it('prefers live Hermes model provider and fallback over stale registry labels', () => {
    const summary = buildRuntimeModelSummary(baseAgent, {
      config: {
        model: { provider: 'openai-codex', default: 'gpt-5.5' },
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
