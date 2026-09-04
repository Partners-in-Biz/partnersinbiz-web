/**
 * @jest-environment node
 */

const mockConnectionGet = jest.fn()
jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: () => ({ doc: () => ({ get: (...args: unknown[]) => mockConnectionGet(...args) }) }) },
}))

jest.mock('@/lib/agents/team', () => ({ callAgentPath: jest.fn() }))
jest.mock('@/lib/hermes/server', () => ({ callHermesJson: jest.fn() }))
jest.mock('@/lib/orgMembers/access-policy', () => ({
  resolveMemberAccessPolicy: () => ({ preset: 'default' }),
}))
jest.mock('@/lib/llm-providers/store', () => ({
  getLlmProviderConnection: jest.fn(),
  getDecryptedLlmCredentials: jest.fn(),
  markLlmConnectionSynced: jest.fn(),
  markLlmConnectionSyncQueued: jest.fn(),
  markLlmConnectionSyncWarning: jest.fn(),
}))
jest.mock('@/lib/llm-providers/bindings', () => ({
  putDesiredLlmCredentialBinding: jest.fn(),
  updateLlmCredentialBinding: jest.fn(),
}))
jest.mock('@/lib/llm-providers/linked-delivery', () => ({ enqueueCredentialDelivery: jest.fn() }))
jest.mock('@/lib/llm-providers/sync-targets', () => ({
  resolveOrgLlmSyncTargets: jest.fn(),
  resolveUserLlmSyncTargets: jest.fn(),
  resolveOrgShareLinkedComputerTargets: jest.fn(async () => ({ targets: [], memberCount: 0 })),
}))
jest.mock('@/lib/llm-providers/refresh', () => ({
  ensureFreshLlmProviderConnection: async (connection: unknown) => connection,
  xaiCredentialsNeedRefresh: jest.fn(() => false),
}))

import { resolveLlmDeliveryForConnection } from '@/lib/llm-providers/sync-hermes'

describe('resolveLlmDeliveryForConnection', () => {
  it('delivers anthropic OAuth tokens via the CLAUDE_CODE_OAUTH_TOKEN env var (env path)', () => {
    expect(resolveLlmDeliveryForConnection(
      { provider: 'anthropic' },
      { access_token: 'at-oauth', refresh_token: 'rt-1' },
    )).toEqual({ mode: 'env', envVar: 'CLAUDE_CODE_OAUTH_TOKEN', value: 'at-oauth' })
  })

  it('keeps other OAuth providers on the nested-token admin-auth path', () => {
    expect(resolveLlmDeliveryForConnection(
      { provider: 'xai-oauth' },
      { access_token: 'at-1', refresh_token: 'rt-1' },
    )).toEqual({ mode: 'oauth' })
    expect(resolveLlmDeliveryForConnection(
      { provider: 'openai-codex' },
      { access_token: 'at-1', refresh_token: 'rt-1' },
    )).toEqual({ mode: 'oauth' })
    expect(resolveLlmDeliveryForConnection(
      { provider: 'nous' },
      { access_token: 'at-1', refresh_token: 'rt-1' },
    )).toEqual({ mode: 'oauth' })
  })

  it('routes API keys to their provider env var, including anthropic api-key connections', () => {
    expect(resolveLlmDeliveryForConnection(
      { provider: 'anthropic' },
      { apiKey: 'sk-ant-1234' },
    )).toEqual({ mode: 'env', envVar: 'ANTHROPIC_API_KEY', value: 'sk-ant-1234' })
    expect(resolveLlmDeliveryForConnection(
      { provider: 'xai' },
      { apiKey: 'xai-1234' },
    )).toEqual({ mode: 'env', envVar: 'XAI_API_KEY', value: 'xai-1234' })
    expect(resolveLlmDeliveryForConnection(
      { provider: 'copilot' },
      { apiKey: 'gho_1234' },
    )).toEqual({ mode: 'env', envVar: 'COPILOT_GITHUB_TOKEN', value: 'gho_1234' })
    expect(resolveLlmDeliveryForConnection(
      { provider: 'deepseek' },
      { apiKey: 'sk-1234' },
    )).toEqual({ mode: 'env', envVar: 'DEEPSEEK_API_KEY', value: 'sk-1234' })
  })

  it('returns none when there is no syncable material', () => {
    expect(resolveLlmDeliveryForConnection({ provider: 'anthropic' }, {})).toEqual({ mode: 'none' })
    expect(resolveLlmDeliveryForConnection({ provider: 'xai' }, {})).toEqual({ mode: 'none' })
  })
})
