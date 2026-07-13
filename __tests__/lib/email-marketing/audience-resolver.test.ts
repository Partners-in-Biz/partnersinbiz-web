import type { Contact } from '@/lib/crm/types'
import {
  applyDeterministicHoldout,
  classifyAudienceEligibility,
  dedupeAudienceContacts,
} from '@/lib/email-marketing/audience-resolver'

function contact(id: string, email = `${id}@example.com`): Contact {
  return {
    id,
    orgId: 'org-1',
    capturedFromId: '',
    name: id,
    email,
    phone: '',
    company: '',
    website: '',
    source: 'manual',
    type: 'lead',
    stage: 'new',
    tags: [],
    notes: '',
    assignedTo: '',
    subscribedAt: null,
    unsubscribedAt: null,
    bouncedAt: null,
    createdAt: null,
    updatedAt: null,
    lastContactedAt: null,
  }
}

describe('email marketing audience eligibility', () => {
  it('deduplicates by normalized email and reports duplicate contacts', () => {
    const result = dedupeAudienceContacts([
      contact('a', 'PERSON@example.com'),
      contact('b', ' person@example.com '),
      contact('c'),
    ])

    expect(result.contacts.map((item) => item.id)).toEqual(['a', 'c'])
    expect(result.duplicateContactIds).toEqual(['b'])
  })

  it('classifies every exclusion with a stable reason precedence', async () => {
    const contacts = [
      contact('missing', ''),
      contact('invalid', 'invalid'),
      contact('suppressed'),
      contact('optout'),
      contact('frequency'),
      contact('sender'),
      contact('eligible'),
    ]

    const estimate = await classifyAudienceEligibility({
      contacts,
      topicId: 'newsletter',
      isSuppressed: async (item) => item.id === 'suppressed',
      checkPreference: async (item) => ({
        allowed: item.id !== 'optout',
        reason: item.id === 'optout' ? 'topic opt-out' : undefined,
      }),
      checkFrequency: async (item) => ({
        allowed: item.id !== 'frequency',
        reason: item.id === 'frequency' ? 'frequency cap' : undefined,
      }),
      checkSender: async (item) => ({
        allowed: item.id !== 'sender',
        reason: item.id === 'sender' ? 'sender policy block' : undefined,
      }),
    })

    expect(estimate.totalCandidates).toBe(7)
    expect(estimate.eligibleCount).toBe(1)
    expect(estimate.eligibleContactIds).toEqual(['eligible'])
    expect(estimate.excludedCounts).toEqual({
      no_email: 1,
      invalid_email: 1,
      suppressed: 1,
      topic_opt_out: 1,
      frequency_cap: 1,
      sender_failure: 1,
    })
    expect(estimate.exclusions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ contactId: 'optout', reason: 'topic_opt_out' }),
        expect.objectContaining({ contactId: 'sender', reason: 'sender_failure' }),
      ]),
    )
  })

  it('uses a deterministic holdout that is stable across input order', () => {
    const ids = Array.from({ length: 100 }, (_, index) => `contact-${index}`)
    const first = applyDeterministicHoldout(ids, 20, 'program-1')
    const second = applyDeterministicHoldout([...ids].reverse(), 20, 'program-1')

    expect(first.holdoutContactIds).toEqual(second.holdoutContactIds)
    expect(first.eligibleContactIds).toEqual(second.eligibleContactIds)
    expect(first.holdoutContactIds).toHaveLength(20)
  })
})
