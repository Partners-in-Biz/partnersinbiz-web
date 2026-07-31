import { CONTEXT_REFERENCE_TYPES } from '@/lib/context-references/types'
import {
  CHAT_CONTEXT_LIVE_REFRESH_MS,
  listChatContextCapabilities,
  summarizeChatContextCoverage,
} from '@/lib/chat-context/capabilities'

describe('chat context capability contract', () => {
  it('declares an authoritative live source and owner for every context kind', () => {
    const capabilities = listChatContextCapabilities()

    expect(capabilities.map((item) => item.kind)).toEqual(CONTEXT_REFERENCE_TYPES)
    expect(new Set(capabilities.map((item) => item.kind)).size).toBe(CONTEXT_REFERENCE_TYPES.length)
    expect(capabilities).toHaveLength(25)
    for (const capability of capabilities) {
      expect(capability.liveRead).toBe(true)
      expect(capability.authoritativeSource).not.toBe('')
      expect(capability.refreshIntervalMs).toBe(CHAT_CONTEXT_LIVE_REFRESH_MS)
      expect(capability.recommendedAgentIds.length).toBeGreaterThan(0)
    }
  })

  it('makes specialized, sealed-runtime, and navigation-only coverage explicit', () => {
    expect(summarizeChatContextCoverage()).toEqual({
      totalKinds: 25,
      liveReadKinds: 25,
      specializedKinds: 18,
      sealedRuntimeKinds: 1,
      inlineActionKinds: 18,
      navigateActionKinds: 7,
    })
  })
})
