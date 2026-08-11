import {
  MODEL_REGISTRY,
  agentTaskModelIds,
  agentTaskModelOptions,
  cleanAgentTaskModel,
  curatedModelsForProvider,
  getCanonicalModel,
  isAgentTaskModel,
  resolveAgentTaskModelEligibility,
} from '@/lib/llm-providers/model-registry'
import { getLlmProvider } from '@/lib/llm-providers/providers'
import { AGENT_MODEL_OPTIONS, VALID_AGENT_MODELS, cleanAgentModel } from '@/lib/agents/runRouting'

describe('canonical model registry', () => {
  it('derives the chat curated provider lists byte-identically to the maintained catalogue', () => {
    // Regression: the chat picker catalogue must not change because lists are derived.
    expect(curatedModelsForProvider('xai-oauth')).toEqual([
      'grok-build-0.1',
      'grok-4.5',
      'grok-4.3',
      'grok-composer-2.5-fast',
      'grok-4.20-0309-reasoning',
      'grok-4.20-0309-non-reasoning',
      'grok-4.20-multi-agent-0309',
    ])
    expect(curatedModelsForProvider('openai-codex')).toEqual([
      'gpt-5.6-luna',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.5',
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.3-codex',
      'gpt-5.3-codex-spark',
      'gpt-5.2-codex',
    ])
    expect(curatedModelsForProvider('openai-api')).toEqual(['gpt-5.4', 'gpt-5.4-mini', 'gpt-4.1', 'gpt-4o'])
    expect(curatedModelsForProvider('anthropic')).toEqual(['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5'])
    expect(curatedModelsForProvider('gemini')).toEqual(['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-3-flash-preview'])
    expect(curatedModelsForProvider('deepseek')).toEqual([
      'deepseek-v4-flash',
      'deepseek-v4-pro',
      'deepseek-chat',
      'deepseek-reasoner',
    ])
    expect(curatedModelsForProvider('openrouter')).toEqual([
      'anthropic/claude-sonnet-4-6',
      'google/gemini-2.5-flash',
      'x-ai/grok-4.5',
      'openai/gpt-5.4',
    ])
    expect(curatedModelsForProvider('copilot')).toEqual(['gpt-5.4', 'gpt-5.4-mini', 'claude-sonnet-4'])
    expect(curatedModelsForProvider('nous')).toEqual(expect.arrayContaining([
      'anthropic/claude-opus-5',
      'openai/gpt-5.6-terra',
      'google/gemini-3.6-flash',
      'z-ai/glm-5.2',
    ]))
    expect(curatedModelsForProvider('nous')).toHaveLength(30)

    // The live provider definitions consume the same derived lists.
    expect(getLlmProvider('openai-codex')?.curatedModels).toContain('gpt-5.6-terra')
    expect(getLlmProvider('xai')?.curatedModels).toEqual(getLlmProvider('xai-oauth')?.curatedModels)
  })

  it('keeps every registry id in at least one provider curated list (no orphans)', () => {
    const curated = new Set(MODEL_REGISTRY.flatMap((entry) => entry.providerKeys).flatMap((key) => curatedModelsForProvider(key)))
    for (const entry of MODEL_REGISTRY) {
      expect(curated.has(entry.id)).toBe(true)
    }
  })

  it('agent-task allowlist includes the approved Nous DeepSeek route for org defaults', () => {
    expect(VALID_AGENT_MODELS).toEqual([
      'grok-4.5',
      'claude-sonnet-4-6',
      'gpt-5.6-terra',
      'gpt-5.5',
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.3-codex-spark',
      'deepseek/deepseek-v4-flash-0731',
    ])
    expect(agentTaskModelIds()).toEqual(VALID_AGENT_MODELS)
  })

  it('agent picker options derive from the registry with a GPT-5.6 Terra entry', () => {
    expect(AGENT_MODEL_OPTIONS).toEqual(agentTaskModelOptions())
    expect(AGENT_MODEL_OPTIONS).toEqual(expect.arrayContaining([
      { value: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
      { value: 'gpt-5.3-codex-spark', label: 'GPT-5.3 Spark' },
      { value: 'grok-4.5', label: 'Grok 4.5 (SuperGrok)' },
    ]))
    expect(AGENT_MODEL_OPTIONS).not.toEqual(expect.arrayContaining([
      { value: 'gpt-5.6-luna', label: expect.any(String) },
    ]))
  })

  it('cleanAgentModel keeps legacy semantics and accepts gpt-5.6-terra', () => {
    expect(cleanAgentModel('gpt-5.6-terra')).toBe('gpt-5.6-terra')
    expect(cleanAgentModel(' claude-sonnet-4-6 ')).toBe('claude-sonnet-4-6')
    expect(cleanAgentModel('gpt-5.4')).toBe('gpt-5.4')
    expect(cleanAgentModel('deepseek/deepseek-v4-flash-0731')).toBe('deepseek/deepseek-v4-flash-0731')
    expect(cleanAgentModel('glm-4.7')).toBeNull()
    expect(cleanAgentModel('gpt-5.6-luna')).toBeNull() // policy-restricted
    expect(cleanAgentModel('gpt-4o')).toBeNull() // runtime-unsupported
    expect(cleanAgentModel('')).toBeNull()
    expect(cleanAgentModel(null)).toBeNull()
    expect(cleanAgentTaskModel(42)).toBeNull()
    expect(isAgentTaskModel('gpt-5.6-terra')).toBe(true)
    expect(isAgentTaskModel('deepseek/deepseek-v4-flash-0731')).toBe(true)
    expect(isAgentTaskModel('gpt-5.6-luna')).toBe(false)
  })

  it('resolver accepts gpt-5.6-terra for a compatible agent with a connected OpenAI provider (default + explicit)', () => {
    const byDefault = resolveAgentTaskModelEligibility({ model: 'gpt-5.6-terra' })
    expect(byDefault.ok).toBe(true)
    if (byDefault.ok) expect(byDefault.model.provider).toBe('openai-codex')

    const withProvider = resolveAgentTaskModelEligibility({ model: 'gpt-5.6-terra', providerAvailable: true })
    expect(withProvider.ok).toBe(true)
    if (withProvider.ok) expect(withProvider.model.id).toBe('gpt-5.6-terra')
  })

  it('resolver fails closed for an unavailable provider with an explicit reason', () => {
    const result = resolveAgentTaskModelEligibility({ model: 'gpt-5.6-terra', providerAvailable: false })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('provider-unavailable')
      expect(result.status).toBe(400)
      expect(result.reason).toMatch(/openai-codex/)
      expect(result.reason).toMatch(/no live-verified/i)
    }
  })

  it('resolver fails closed for an unsupported runtime with an explicit reason', () => {
    const result = resolveAgentTaskModelEligibility({ model: 'gpt-4o' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('runtime-unsupported')
      expect(result.reason).toMatch(/not supported by Hermes agent runtimes/)
    }
    // OpenRouter-prefixed ids are chat-only and not runtime-compatible.
    const prefixed = resolveAgentTaskModelEligibility({ model: 'openai/gpt-5.4' })
    expect(prefixed.ok).toBe(false)
    if (!prefixed.ok) expect(prefixed.code).toBe('runtime-unsupported')
  })

  it('resolver fails closed for a policy-restricted model with an explicit reason', () => {
    const luna = resolveAgentTaskModelEligibility({ model: 'gpt-5.6-luna' })
    expect(luna.ok).toBe(false)
    if (!luna.ok) {
      expect(luna.code).toBe('policy-restricted')
      expect(luna.status).toBe(403)
      expect(luna.reason).toMatch(/not permitted for agent-task dispatch/)
    }
    const sol = resolveAgentTaskModelEligibility({ model: 'gpt-5.6-sol' })
    expect(sol.ok).toBe(false)
    if (!sol.ok) expect(sol.code).toBe('policy-restricted')
  })

  it('resolver fails closed for chat-only catalogue models with an explicit reason', () => {
    const result = resolveAgentTaskModelEligibility({ model: 'grok-4.3' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('chat-only')
      expect(result.reason).toMatch(/not offered for agent-task dispatch/)
    }
  })

  it('resolver fails closed for unknown models with an explicit reason', () => {
    const unknown = resolveAgentTaskModelEligibility({ model: 'glm-4.7' })
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) {
      expect(unknown.code).toBe('unknown-model')
      expect(unknown.reason).toMatch(/not in the platform model catalogue/)
    }
    const empty = resolveAgentTaskModelEligibility({ model: '' })
    expect(empty.ok).toBe(false)
    if (!empty.ok) expect(empty.code).toBe('unknown-model')
    const nonString = resolveAgentTaskModelEligibility({ model: 42 })
    expect(nonString.ok).toBe(false)
    if (!nonString.ok) expect(nonString.code).toBe('unknown-model')
  })

  it('registry entries carry precise metadata and no duplicates', () => {
    const ids = MODEL_REGISTRY.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(getCanonicalModel('gpt-5.6-terra')?.runtimeCompatible).toBe(true)
    expect(getCanonicalModel('gpt-4o')?.runtimeCompatible).toBe(false)
    expect(getCanonicalModel('does-not-exist')).toBeNull()
  })
})
