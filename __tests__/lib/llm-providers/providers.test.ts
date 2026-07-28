import { getLlmProvider, listLlmProviders, UNSUPPORTED_CURSOR_NOTE, hermesProviderForConnection } from '@/lib/llm-providers/providers'
import { llmConnectionId, llmConnectionScopeKey, maskLlmConnection } from '@/lib/llm-providers/types'

describe('llm providers catalogue', () => {
  it('includes xAI OAuth, xAI API key, and Codex OAuth', () => {
    const keys = listLlmProviders().map((p) => p.key)
    expect(keys).toEqual(expect.arrayContaining(['xai', 'xai-oauth', 'openai-codex', 'gemini', 'openrouter']))
    expect(getLlmProvider('xai')?.envVar).toBe('XAI_API_KEY')
    expect(hermesProviderForConnection('xai-oauth')).toBe('xai-oauth')
  })

  it('keeps linked-computer fallbacks aligned with the Hermes override allowlist', () => {
    expect(getLlmProvider('openai-codex')?.curatedModels).toEqual(expect.arrayContaining([
      'gpt-5.6-luna',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.3-codex-spark',
    ]))
    expect(getLlmProvider('xai-oauth')?.curatedModels).toContain('grok-4.20-multi-agent-0309')
    expect(getLlmProvider('xai')?.curatedModels).toEqual(getLlmProvider('xai-oauth')?.curatedModels)
  })

  it('documents that Cursor is not a Hermes inference provider', () => {
    expect(UNSUPPORTED_CURSOR_NOTE.toLowerCase()).toContain('cursor')
    expect(UNSUPPORTED_CURSOR_NOTE.toLowerCase()).toContain('cannot power hermes')
    expect(listLlmProviders().some((p) => p.key.includes('cursor'))).toBe(false)
  })

  it('builds stable connection ids and masks credentials', () => {
    expect(llmConnectionId({ provider: 'xai', scope: 'org', orgId: 'acme', ownerUid: null })).toBe('org:acme:xai')
    expect(llmConnectionScopeKey({ scope: 'user', orgId: 'acme', ownerUid: 'u1' })).toBe('user:u1')
    const masked = maskLlmConnection({
      id: 'org:acme:xai',
      provider: 'xai',
      hermesProvider: 'xai',
      authKind: 'api_key',
      scope: 'org',
      orgId: 'acme',
      ownerUid: null,
      label: 'xAI',
      status: 'connected',
      credentialsEnc: { ciphertext: 'c', iv: 'i', tag: 't' },
      scopeKeyRef: 'org:acme',
      credentialHint: 'xai-…abcd',
      meta: {},
      syncedAgentIds: ['pip'],
      lastValidatedAt: null,
      lastUsedAt: null,
      lastSyncedAt: null,
      lastError: null,
      createdAt: null,
      updatedAt: null,
      createdBy: 'u1',
      createdByType: 'user',
    })
    expect(masked.hasCredentials).toBe(true)
    expect(masked).not.toHaveProperty('credentialsEnc')
  })
})
