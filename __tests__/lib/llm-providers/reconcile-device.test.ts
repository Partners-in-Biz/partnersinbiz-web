import {
  credentialBindingNeedsDelivery,
  runtimeSupportsCredentialDelivery,
} from '@/lib/llm-providers/reconcile-device'
import type { LlmCredentialBinding } from '@/lib/llm-providers/types'

function binding(update: Partial<LlmCredentialBinding> = {}): LlmCredentialBinding {
  return {
    id: 'binding-1',
    connectionId: 'connection-1',
    credentialVersion: 2,
    orgId: 'org-1',
    ownerUid: 'user-1',
    scope: 'user',
    provider: 'xai-oauth',
    hermesProvider: 'xai-oauth',
    runtimeTargetId: 'linked-device:device-1',
    deviceId: 'device-1',
    machineLabel: 'Mac · theo',
    agentId: 'theo',
    status: 'ready',
    liveAuthVerified: true,
    verifiedModelIds: ['grok-4.20'],
    lastError: null,
    deliveryJobId: 'job-1',
    lastVerifiedAt: null,
    createdAt: 0,
    updatedAt: 1_000,
    ...update,
  }
}

describe('linked-device LLM credential reconciliation', () => {
  it('only activates after runtime protocol 1.1.13', () => {
    expect(runtimeSupportsCredentialDelivery('1.1.12')).toBe(false)
    expect(runtimeSupportsCredentialDelivery('1.1.13')).toBe(true)
    expect(runtimeSupportsCredentialDelivery('1.2.0')).toBe(true)
  })

  it('skips current ready or in-flight bindings and repairs missing/stale generations', () => {
    expect(credentialBindingNeedsDelivery({ binding: binding(), credentialVersion: 2 })).toBe(false)
    expect(credentialBindingNeedsDelivery({
      binding: binding({ status: 'delivering', liveAuthVerified: false }),
      credentialVersion: 2,
      nowMs: 899_000,
    })).toBe(false)
    expect(credentialBindingNeedsDelivery({
      binding: binding({ status: 'delivering', liveAuthVerified: false }),
      credentialVersion: 2,
      nowMs: 901_000,
    })).toBe(true)
    expect(credentialBindingNeedsDelivery({ credentialVersion: 2 })).toBe(true)
    expect(credentialBindingNeedsDelivery({ binding: binding(), credentialVersion: 3 })).toBe(true)
  })

  it('backs off failed canaries before retrying automatically', () => {
    const failed = binding({ status: 'failed', liveAuthVerified: false, updatedAt: 1_000 })
    expect(credentialBindingNeedsDelivery({ binding: failed, credentialVersion: 2, nowMs: 299_000 })).toBe(false)
    expect(credentialBindingNeedsDelivery({ binding: failed, credentialVersion: 2, nowMs: 301_000 })).toBe(true)
  })
})
