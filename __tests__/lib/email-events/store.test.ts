import { appendEmailEvent } from '@/lib/email-events/store'

function fakeDb(existing: Record<string, Record<string, unknown>> = {}) {
  const rows = new Map(Object.entries(existing))
  const creates: Array<{ id: string; value: Record<string, unknown> }> = []
  const db = {
    collection: jest.fn((_name: string) => ({
      doc: (id: string) => ({ id }),
    })),
    runTransaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        get: async (ref: { id: string }) => ({
          exists: rows.has(ref.id),
          data: () => rows.get(ref.id),
        }),
        create: (ref: { id: string }, value: Record<string, unknown>) => {
          if (rows.has(ref.id)) throw new Error('already exists')
          rows.set(ref.id, value)
          creates.push({ id: ref.id, value })
        },
      }),
    ),
  }
  return { db, rows, creates }
}

const input = {
  orgId: 'org-a',
  messageId: 'email-doc-1',
  contactId: 'contact-1',
  provider: 'resend' as const,
  providerMessageId: 'provider-message-1',
  providerEventId: 'svix-delivery-1',
  event: 'delivered' as const,
  providerTimestamp: '2026-07-12T12:00:00.000Z',
}

describe('appendEmailEvent', () => {
  it('creates one immutable ledger row and treats replay as a no-op', async () => {
    const { db, creates } = fakeDb()

    const first = await appendEmailEvent(input, { db: db as never, now: () => 'received-ts' as never })
    const replay = await appendEmailEvent(input, { db: db as never, now: () => 'later-ts' as never })

    expect(first.created).toBe(true)
    expect(replay).toEqual({ ...first, created: false })
    expect(creates).toHaveLength(1)
    expect(creates[0].value).toMatchObject({
      orgId: 'org-a',
      immutable: true,
      schemaVersion: 1,
      receivedAt: 'received-ts',
    })
  })

  it('rejects a replay whose immutable canonical payload differs', async () => {
    const { db } = fakeDb()
    await appendEmailEvent(input, { db: db as never, now: () => 'received-ts' as never })
    await expect(appendEmailEvent({ ...input, contactId: 'other-contact' }, { db: db as never }))
      .rejects.toThrow('immutable payload collision')
  })

  it('rejects missing tenant lineage', async () => {
    const { db } = fakeDb()
    await expect(appendEmailEvent({ ...input, orgId: '' }, { db: db as never })).rejects.toThrow(
      'orgId is required',
    )
  })
})
