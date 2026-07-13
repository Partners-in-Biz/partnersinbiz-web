import { appendConsentEvent, buildConsentEventIdentity } from '@/lib/consent-ledger/store'

function fakeDb() {
  const rows = new Map<string, Record<string, unknown>>()
  const creates: Array<{ id: string; value: Record<string, unknown> }> = []
  const db = {
    collection: jest.fn((_name: string) => ({ doc: (id: string) => ({ id }) })),
    runTransaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        get: async (ref: { id: string }) => ({ exists: rows.has(ref.id), data: () => rows.get(ref.id) }),
        create: (ref: { id: string }, value: Record<string, unknown>) => {
          rows.set(ref.id, value)
          creates.push({ id: ref.id, value })
        },
      }),
    ),
  }
  return { db, creates }
}

const input = {
  orgId: 'org-a',
  contactId: 'contact-1',
  channel: 'email' as const,
  topicId: '*',
  state: 'revoked' as const,
  legalBasis: 'consent' as const,
  source: 'provider-complaint' as const,
  sourceEventId: 'evt-provider-1',
  occurredAt: '2026-07-12T12:00:00.000Z',
  proofRef: 'resend:provider-message-1',
}

describe('consent ledger store', () => {
  it('uses an org-scoped stable source event identity', () => {
    const a = buildConsentEventIdentity(input)
    expect(buildConsentEventIdentity({ ...input, proofRef: 'changed-on-retry' })).toEqual(a)
    expect(buildConsentEventIdentity({ ...input, orgId: 'org-b' }).id).not.toBe(a.id)
  })

  it('appends once and never mutates an existing audit event', async () => {
    const { db, creates } = fakeDb()
    const first = await appendConsentEvent(input, { db: db as never, now: () => 'received-ts' as never })
    const replay = await appendConsentEvent(input, { db: db as never, now: () => 'later-ts' as never })

    expect(first.created).toBe(true)
    expect(replay.created).toBe(false)
    expect(creates).toHaveLength(1)
    expect(creates[0].value).toMatchObject({ immutable: true, schemaVersion: 1, receivedAt: 'received-ts' })
  })

  it('requires strict organisation and contact scope', async () => {
    const { db } = fakeDb()
    await expect(appendConsentEvent({ ...input, contactId: '' }, { db: db as never })).rejects.toThrow(
      'contactId is required',
    )
  })
})
