import {
  computeMembershipDelta,
  hashAudienceDefinition,
  sanitizeAudienceDefinition,
} from '@/lib/email-marketing/audience-snapshot'

const base = {
  schemaVersion: 1,
  topicId: 'Newsletter',
  include: [{ type: 'contacts', contactIds: ['b', 'a', 'a'] }],
  exclude: [{ type: 'tags', tags: ['internal'] }],
  holdoutPercent: 15,
}

describe('audience snapshots', () => {
  it('sanitizes untrusted definitions, clamps holdout and deduplicates ids', () => {
    expect(sanitizeAudienceDefinition({ ...base, holdoutPercent: 140 })).toEqual({
      schemaVersion: 1,
      topicId: 'newsletter',
      include: [{ type: 'contacts', contactIds: ['b', 'a'] }],
      exclude: [{ type: 'tags', tags: ['internal'] }],
      holdoutPercent: 100,
    })
  })

  it('produces the same definition hash for equivalent key order', () => {
    const one = sanitizeAudienceDefinition(base)
    const two = sanitizeAudienceDefinition({
      exclude: base.exclude,
      include: base.include,
      topicId: 'Newsletter',
      holdoutPercent: 15,
      schemaVersion: 1,
    })
    expect(hashAudienceDefinition(one)).toBe(hashAudienceDefinition(two))
  })

  it('computes approval-time audience membership delta', () => {
    expect(computeMembershipDelta(['a', 'b', 'c'], ['b', 'c', 'd'])).toEqual({
      added: 1,
      removed: 1,
      unchanged: 2,
    })
  })

  it('rejects empty or unsafe audience definitions', () => {
    expect(() => sanitizeAudienceDefinition({ include: [] })).toThrow('include')
    expect(() =>
      sanitizeAudienceDefinition({
        include: [{ type: 'segment', segmentId: '' }],
        topicId: 'newsletter',
      }),
    ).toThrow('include')
  })
})
