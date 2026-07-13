import { buildIdempotencyKey, normalizeConversationOrigin } from '@/lib/chat-context/lineage'

const origin = {
  conversationId: 'conversation-1', requestMessageId: 'request-1', responseMessageId: 'response-1', bundleId: 'bundle-1', sequence: 2,
}

describe('conversation lineage', () => {
  it('normalises the new conversationOrigin envelope', () => {
    expect(normalizeConversationOrigin({ conversationOrigin: origin })).toEqual(origin)
  })

  it('normalises the existing chatOrigin envelope', () => {
    expect(normalizeConversationOrigin({ chatOrigin: origin })).toEqual(origin)
  })

  it('prefers conversationOrigin while both formats coexist', () => {
    expect(normalizeConversationOrigin({ conversationOrigin: origin, chatOrigin: { ...origin, bundleId: 'legacy' } })).toEqual(origin)
  })

  it('rejects incomplete or invalid untrusted lineage', () => {
    expect(normalizeConversationOrigin({ conversationOrigin: { ...origin, sequence: -1 } })).toBeUndefined()
    expect(normalizeConversationOrigin({ chatOrigin: { bundleId: 'partial' } })).toBeUndefined()
    expect(normalizeConversationOrigin({ conversationOrigin: { ...origin, conversationId: '   ' } })).toBeUndefined()
  })

  it('builds idempotency from target domain, bundle and sequence', () => {
    expect(buildIdempotencyKey('video_editor', origin)).toBe('12:video_editor8:bundle-1:2')
  })

  it('uses a collision-safe encoding when values contain delimiters', () => {
    expect(buildIdempotencyKey('a:b', { bundleId: 'c', sequence: 2 })).not.toBe(
      buildIdempotencyKey('a', { bundleId: 'b:c', sequence: 2 }),
    )
  })

  it('projects only the five serialisable lineage fields', () => {
    expect(normalizeConversationOrigin({
      conversationOrigin: { ...origin, unknown: 'exclude me', callback: () => undefined },
    })).toStrictEqual(origin)
  })
})
