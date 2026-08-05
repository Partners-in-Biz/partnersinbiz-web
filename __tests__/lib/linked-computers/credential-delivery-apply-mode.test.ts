import {
  credentialDeliveryApplyMode,
  type CredentialApplyMode,
} from '@/lib/linked-computers/agent-jobs'

describe('credentialDeliveryApplyMode', () => {
  it('uses the explicit applyMode when present', () => {
    expect(credentialDeliveryApplyMode({ applyMode: 'env', envVar: 'DEEPSEEK_API_KEY' })).toBe('env')
    expect(credentialDeliveryApplyMode({ applyMode: 'restart', envVar: null })).toBe('restart')
    expect(credentialDeliveryApplyMode({ applyMode: 'restart', envVar: 'XAI_API_KEY' })).toBe('restart')
  })

  it('falls back to env-var presence for older payloads without applyMode', () => {
    expect(credentialDeliveryApplyMode({ envVar: 'DEEPSEEK_API_KEY' })).toBe('env')
    expect(credentialDeliveryApplyMode({ envVar: null })).toBe('restart')
    expect(credentialDeliveryApplyMode(undefined)).toBe('restart')
    expect(credentialDeliveryApplyMode(null)).toBe('restart')
  })

  it('narrows the union to the two supported modes', () => {
    const mode: CredentialApplyMode = credentialDeliveryApplyMode({ applyMode: 'env', envVar: 'DEEPSEEK_API_KEY' })
    expect(['env', 'restart']).toContain(mode)
  })
})
