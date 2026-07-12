import { projectConsentFacts, resolveCanonicalEmailConsent } from '@/lib/consent-ledger/decision'

const event = (topicId: string, state: 'granted' | 'revoked', occurredAt: string, orgId = 'org-1') => ({
  orgId,
  contactId: 'contact-1',
  channel: 'email' as const,
  topicId,
  state,
  occurredAt,
})

describe('canonical consent decision', () => {
  it('projects latest same-org global, channel and topic facts without allowing a narrow grant to override a broad revocation', () => {
    const facts = projectConsentFacts({
      orgId: 'org-1',
      contactId: 'contact-1',
      channel: 'email',
      topicId: 'newsletter',
      events: [
        event('*', 'revoked', '2026-07-12T08:00:00.000Z'),
        event('email:*', 'granted', '2026-07-12T09:00:00.000Z'),
        event('newsletter', 'granted', '2026-07-12T10:00:00.000Z'),
        event('*', 'granted', '2026-07-12T11:00:00.000Z', 'other-org'),
      ],
    })

    expect(facts.globalConsent?.state).toBe('revoked')
    expect(facts.channelConsent?.state).toBe('granted')
    expect(facts.topicConsent?.state).toBe('granted')
  })

  it('rechecks active suppression and ledger truth immediately for marketing dispatch', async () => {
    const get = jest.fn().mockResolvedValue({ docs: [{ data: () => event('*', 'revoked', '2026-07-12T08:00:00.000Z') }] })
    const where = jest.fn(() => ({ where, get }))
    const db = { collection: jest.fn(() => ({ where })) }

    const decision = await resolveCanonicalEmailConsent({
      orgId: 'org-1', contactId: 'contact-1', email: 'person@example.com', topicId: 'newsletter',
    }, { db: db as never, lookupSuppression: jest.fn().mockResolvedValue({ active: false }) })

    expect(decision).toEqual(expect.objectContaining({ allowed: false, precedence: 'global-consent' }))
    expect(where).toHaveBeenNthCalledWith(1, 'orgId', '==', 'org-1')
    expect(where).toHaveBeenNthCalledWith(2, 'contactId', '==', 'contact-1')
  })

  it('fails closed for marketing when canonical consent cannot be read', async () => {
    const db = { collection: jest.fn(() => ({ where: () => { throw new Error('firestore unavailable') } })) }
    const decision = await resolveCanonicalEmailConsent({
      orgId: 'org-1', contactId: 'contact-1', email: 'person@example.com', topicId: 'newsletter',
    }, { db: db as never, lookupSuppression: jest.fn().mockResolvedValue({ active: false }) })
    expect(decision).toEqual(expect.objectContaining({ allowed: false, reason: 'consent-ledger-unavailable' }))
  })
})
