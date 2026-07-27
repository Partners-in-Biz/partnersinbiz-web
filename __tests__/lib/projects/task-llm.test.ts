/**
 * @jest-environment node
 */
import {
  cleanTaskAgentProvider,
  cleanTaskLlmCredentialSource,
  inferHermesProviderFromModel,
} from '@/lib/projects/task-llm'

describe('project task LLM credential helpers', () => {
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
    expect(inferHermesProviderFromModel('grok-4.5')).toBe('xai-oauth')
    expect(inferHermesProviderFromModel('openai/gpt-5.5')).toBe('openai-codex')
  })
})
