const documents = new Map<string, Record<string, unknown>>()
const writes: string[] = []

type Ref = { path: string; id: string }
const adminDb = {
  collection: (name: string) => ({ doc: (id: string): Ref => ({ path: `${name}/${id}`, id }) }),
  runTransaction: async (callback: Function) => callback({
    get: async (ref: Ref) => ({ id: ref.id, exists: documents.has(ref.path), data: () => documents.get(ref.path) }),
    update: (ref: Ref) => { writes.push(`update:${ref.path}`) },
    set: (ref: Ref) => { writes.push(`set:${ref.path}`) },
    create: (ref: Ref, data: Record<string, unknown>) => { writes.push(`create:${ref.path}`); documents.set(ref.path, data) },
  }),
}

jest.mock('@/lib/firebase/admin', () => ({ adminDb }))

import { correctReplyClassification } from '@/lib/email-marketing/reply-queue'

beforeEach(() => { documents.clear(); writes.length = 0 })

it('refuses to mirror a correction when the inbound record belongs to another tenant', async () => {
  documents.set('email_reply_routes/reply-1', { orgId: 'org-1', inboundId: 'in-1', classification: { classification: 'neutral' } })
  documents.set('inbound_emails/in-1', { orgId: 'org-2' })
  await expect(correctReplyClassification('org-1', 'reply-1', 'positive', 'u-1', '', 'retry-key')).rejects.toThrow('does not belong')
  expect(writes).toEqual([])
})

it('uses one deterministic audit record when the same correction is retried', async () => {
  documents.set('email_reply_routes/reply-1', { orgId: 'org-1', inboundId: 'in-1', classification: { classification: 'neutral' } })
  documents.set('inbound_emails/in-1', { orgId: 'org-1' })
  await correctReplyClassification('org-1', 'reply-1', 'positive', 'u-1', 'Qualified', 'retry-key')
  await correctReplyClassification('org-1', 'reply-1', 'positive', 'u-1', 'Qualified', 'retry-key')
  expect(writes.filter((write) => write.startsWith('create:email_reply_classification_audit/'))).toHaveLength(1)
  expect(Array.from(documents.keys()).filter((key) => key.startsWith('email_reply_classification_audit/'))).toHaveLength(1)
})

it('rejects an idempotency key reused with a different correction payload', async () => {
  documents.set('email_reply_routes/reply-1', { orgId: 'org-1', inboundId: 'in-1', classification: { classification: 'neutral' } })
  documents.set('inbound_emails/in-1', { orgId: 'org-1' })
  await correctReplyClassification('org-1', 'reply-1', 'positive', 'u-1', 'Qualified', 'same-key')
  writes.length = 0
  await expect(correctReplyClassification('org-1', 'reply-1', 'negative', 'u-1', 'Declined', 'same-key')).rejects.toMatchObject({ status: 409 })
  expect(writes).toEqual([])
})

it('returns the newer effective state when an older correction is retried out of order', async () => {
  documents.set('email_reply_routes/reply-1', { orgId: 'org-1', inboundId: 'in-1', classification: { classification: 'neutral' } })
  documents.set('inbound_emails/in-1', { orgId: 'org-1' })
  await correctReplyClassification('org-1', 'reply-1', 'positive', 'u-1', 'Qualified', 'older-key')
  documents.set('email_reply_routes/reply-1', {
    orgId: 'org-1', inboundId: 'in-1', classification: { classification: 'neutral' },
    classificationCorrection: { classification: 'negative', correctedBy: 'u-2' },
  })
  await correctReplyClassification('org-1', 'reply-1', 'negative', 'u-2', 'Declined', 'newer-key')
  writes.length = 0
  const replay = await correctReplyClassification('org-1', 'reply-1', 'positive', 'u-1', 'Qualified', 'older-key')
  expect(replay).toMatchObject({ classification: 'negative', correctedBy: 'u-2', replayed: true, staleReplay: true })
  expect(writes).toEqual([])
})
