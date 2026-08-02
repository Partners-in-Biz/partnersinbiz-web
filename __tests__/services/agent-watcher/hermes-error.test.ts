import { formatHermesWatcherError } from '../../../services/agent-watcher/src/hermes-error'

describe('formatHermesWatcherError', () => {
  it('explains ChatGPT Codex prolite usage limits are not SuperGrok', () => {
    const raw = "HTTP 429: The usage limit has been reached provider=openai-codex base_url=https://chatgpt.com/backend-api/codex {'error': {'type': 'usage_limit_reached', 'message': 'The usage limit has been reached', 'plan_type': 'prolite', 'resets_in_seconds': 3600}}"
    // use JSON-ish form that extractJsonBlob can parse
    const withJson = 'HTTP 429: The usage limit has been reached provider=openai-codex base_url=https://chatgpt.com/backend-api/codex {"error":{"type":"usage_limit_reached","message":"The usage limit has been reached","plan_type":"prolite","resets_in_seconds":7200}}'
    const out = formatHermesWatcherError(withJson, { agentId: 'theo', provider: 'openai-codex', model: 'gpt-5.6-sol' })
    expect(out).toContain('Provider usage limit reached')
    expect(out).toContain('ChatGPT Codex')
    expect(out).toContain('prolite')
    expect(out).toContain('not necessarily SuperGrok')
    expect(out).toContain('about 2 hour')
  })

  it('explains xAI API credit exhaustion separately from SuperGrok', () => {
    const raw = "Error code: 403 - {'code': 'permission-denied', 'error': 'Your team b5fafefc-1b86-4822-b3d7-6a329289c738 has either used all available credits or reached its monthly spending limit.'} provider=xai"
    const withJson = 'permission-denied credits spending limit provider=xai api.x.ai Your team used all available credits'
    const out = formatHermesWatcherError(withJson, { agentId: 'pip' })
    expect(out.toLowerCase()).toContain('api key')
    expect(out).toContain('separate from SuperGrok')
  })

  it('explains xAI managed multi-device access-token delivery', () => {
    const raw = 'Provider authentication failed: xAI OAuth state is missing refresh_token. Re-authenticate with `hermes model`.'
    const out = formatHermesWatcherError(raw, { agentId: 'pip', provider: 'xai-oauth' })
    expect(out).toContain('fresh access token')
    expect(out).toContain('access-only')
    expect(out).toContain('Do not copy refresh tokens between machines')
  })

  it('passes through unknown errors unchanged', () => {
    expect(formatHermesWatcherError('gateway failed')).toBe('gateway failed')
  })
})
