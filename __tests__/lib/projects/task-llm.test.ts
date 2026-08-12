/**
 * @jest-environment node
 */
const mockListConnections = jest.fn()

jest.mock('@/lib/llm-providers/store', () => ({
  listLlmProviderConnections: (...args: unknown[]) => mockListConnections(...args),
}))
jest.mock('@/lib/llm-providers/sync-hermes', () => ({
  syncLlmConnectionToHermes: jest.fn(),
}))

import {
  cleanTaskAgentProvider,
  cleanTaskLlmCredentialSource,
  inferHermesProviderFromModel,
  resolveTaskLlmCredentials,
} from '@/lib/projects/task-llm'

describe('project task LLM credential helpers', () => {
  beforeEach(() => {
    mockListConnections.mockResolvedValue([
      {
        id: 'org:org-1:xai-oauth',
        provider: 'xai-oauth',
        hermesProvider: 'xai-oauth',
        scope: 'org',
        ownerUid: null,
        status: 'connected',
        hasCredentials: true,
      },
      {
        id: 'user:user-1:xai-oauth',
        provider: 'xai-oauth',
        hermesProvider: 'xai-oauth',
        scope: 'user',
        ownerUid: 'user-1',
        status: 'connected',
        hasCredentials: true,
      },
    ])
  })
  it('cleans credential sources', () => {
    expect(cleanTaskLlmCredentialSource('personal')).toBe('personal')
    expect(cleanTaskLlmCredentialSource('ORG')).toBe('org')
    expect(cleanTaskLlmCredentialSource('nope')).toBeNull()
  })

  it('cleans hermes provider ids', () => {
    expect(cleanTaskAgentProvider('openai-codex')).toBe('openai-codex')
    expect(cleanTaskAgentProvider('XAI-OAuth')).toBe('xai-oauth')
    expect(cleanTaskAgentProvider('../evil')).toBeNull()
  })

  it('infers providers from model ids', () => {
    expect(inferHermesProviderFromModel('claude-sonnet-4-6')).toBe('anthropic')
    expect(inferHermesProviderFromModel('gpt-5.4')).toBe('openai-codex')
    expect(inferHermesProviderFromModel('grok-4.6')).toBe('xai-oauth')
    expect(inferHermesProviderFromModel('grok-4.5')).toBe('xai-oauth')
    expect(inferHermesProviderFromModel('openai/gpt-5.5')).toBe('openai-codex')
  })

  it('keeps a chat-origin Mac task on the owner personal account', async () => {
    await expect(resolveTaskLlmCredentials({
      orgId: 'org-1',
      ownerUid: 'user-1',
      requestedSource: 'auto',
      requestedProvider: 'xai-oauth',
      runtimeTargetId: 'linked-device:mac-1',
    })).resolves.toMatchObject({
      resolvedSource: 'personal',
      connectionId: 'user:user-1:xai-oauth',
      personalConnectionId: 'user:user-1:xai-oauth',
      agentProvider: 'xai-oauth',
    })
  })

  it('defaults Auto (no model/provider) to SuperGrok primary, not first Codex connection', async () => {
    mockListConnections.mockResolvedValue([
      {
        id: 'user:user-1:openai-codex',
        provider: 'openai-codex',
        hermesProvider: 'openai-codex',
        scope: 'user',
        ownerUid: 'user-1',
        status: 'connected',
        hasCredentials: true,
      },
      {
        id: 'user:user-1:xai-oauth',
        provider: 'xai-oauth',
        hermesProvider: 'xai-oauth',
        scope: 'user',
        ownerUid: 'user-1',
        status: 'connected',
        hasCredentials: true,
      },
      {
        id: 'org:org-1:openai-codex',
        provider: 'openai-codex',
        hermesProvider: 'openai-codex',
        scope: 'org',
        ownerUid: null,
        status: 'connected',
        hasCredentials: true,
      },
      {
        id: 'org:org-1:xai-oauth',
        provider: 'xai-oauth',
        hermesProvider: 'xai-oauth',
        scope: 'org',
        ownerUid: null,
        status: 'connected',
        hasCredentials: true,
      },
    ])

    await expect(resolveTaskLlmCredentials({
      orgId: 'org-1',
      ownerUid: 'user-1',
      requestedSource: 'auto',
      runtimeTargetId: 'linked-device:mac-1',
    })).resolves.toMatchObject({
      resolvedSource: 'personal',
      connectionId: 'user:user-1:xai-oauth',
      agentProvider: 'xai-oauth',
    })

    await expect(resolveTaskLlmCredentials({
      orgId: 'org-1',
      ownerUid: 'user-1',
      requestedSource: 'auto',
      runtimeTargetId: 'vps',
    })).resolves.toMatchObject({
      resolvedSource: 'org',
      connectionId: 'org:org-1:xai-oauth',
      agentProvider: 'xai-oauth',
    })
  })
})
