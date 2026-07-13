import {
  buildEmailEventIdentity,
  canonicalizeEventMetadata,
} from '@/lib/email-events/identity'

const base = {
  orgId: 'org-a',
  provider: 'resend' as const,
  providerMessageId: 'msg-1',
  event: 'clicked' as const,
  messageId: 'email-doc-1',
  providerTimestamp: '2026-07-12T12:00:00.000Z',
  url: 'https://example.com/a',
}

describe('email event identity', () => {
  it('prefers an org-scoped provider event id for replay deduplication', () => {
    const first = buildEmailEventIdentity({ ...base, providerEventId: 'svix-1' })
    const replay = buildEmailEventIdentity({
      ...base,
      providerEventId: 'svix-1',
      receivedAt: '2026-07-12T12:05:00.000Z',
      metadata: { deliveryAttempt: 2 },
    })
    const otherOrg = buildEmailEventIdentity({ ...base, orgId: 'org-b', providerEventId: 'svix-1' })

    expect(replay).toEqual(first)
    expect(otherOrg.id).not.toBe(first.id)
  })

  it('derives a stable fallback independent of metadata key ordering', () => {
    const a = buildEmailEventIdentity({ ...base, metadata: { z: 1, a: { y: 2, x: 1 } } })
    const b = buildEmailEventIdentity({ ...base, metadata: { a: { x: 1, y: 2 }, z: 1 } })

    expect(a).toEqual(b)
    expect(a.id).toMatch(/^evt_[a-f0-9]{40}$/)
  })

  it('derives separate unique click keys by URL but one unique delivery per message', () => {
    expect(buildEmailEventIdentity(base).uniqueEventKey).not.toBe(
      buildEmailEventIdentity({ ...base, url: 'https://example.com/b' }).uniqueEventKey,
    )
    expect(
      buildEmailEventIdentity({ ...base, event: 'delivered', url: 'https://example.com/a' }).uniqueEventKey,
    ).toBe(
      buildEmailEventIdentity({ ...base, event: 'delivered', url: 'https://example.com/b' }).uniqueEventKey,
    )
  })

  it('canonicalizes nested metadata without undefined values', () => {
    expect(canonicalizeEventMetadata({ b: undefined, a: [2, undefined, { d: 4, c: 3 }] })).toBe(
      '{"a":[2,null,{"c":3,"d":4}]}',
    )
  })
})
