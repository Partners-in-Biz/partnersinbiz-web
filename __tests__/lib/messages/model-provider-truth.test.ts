import {
  expandProviderAliases,
  providersShareCredentialFamily,
} from '@/lib/messages/model-provider-aliases'
import { extractConfiguredRuntimeProviders, buildRuntimeModelSummary } from '@/lib/agents/runtime-config'

describe('model provider aliases', () => {
  it('treats openai-codex and openai as the same credential family', () => {
    expect(providersShareCredentialFamily('openai-codex', 'openai')).toBe(true)
    expect(expandProviderAliases(['openai-codex']).has('openai')).toBe(true)
  })

  it('does not treat anthropic as interchangeable with openai-codex', () => {
    expect(providersShareCredentialFamily('openai-codex', 'anthropic')).toBe(false)
  })
})

describe('extractConfiguredRuntimeProviders', () => {
  it('returns primary and fallback providers from live Hermes config', () => {
    const entries = extractConfiguredRuntimeProviders({
      config: {
        model: { provider: 'openai-codex', default: 'gpt-5.6-luna' },
        fallback_providers: [
          { provider: 'xai', model: 'grok-4.20-0309-reasoning' },
          { provider: 'gemini', model: 'gemini-2.5-pro' },
        ],
      },
    })

    expect(entries).toEqual([
      { provider: 'openai-codex', model: 'gpt-5.6-luna', role: 'primary' },
      { provider: 'xai', model: 'grok-4.20-0309-reasoning', role: 'fallback' },
      { provider: 'gemini', model: 'gemini-2.5-pro', role: 'fallback' },
    ])
  })
})

describe('buildRuntimeModelSummary live primary', () => {
  it('prefers live Hermes primary over stale registry Claude labels', () => {
    const summary = buildRuntimeModelSummary(
      { agentId: 'pip', defaultModel: 'claude-sonnet-4-6' },
      {
        config: {
          model: { provider: 'openai-codex', default: 'gpt-5.6-luna' },
          fallback_providers: [{ provider: 'xai', model: 'grok-4.20-0309-reasoning' }],
        },
      },
    )

    expect(summary).toMatchObject({
      source: 'live_config',
      primaryProvider: 'openai-codex',
      primaryModel: 'gpt-5.6-luna',
      staleRegistry: true,
    })
  })
})
