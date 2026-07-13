import { listReplyQueue, normalizeReplyQueueItem, type ReplyQueuePage } from '@/lib/email-marketing/reply-queue'

it('projects persisted lineage, human correction and missed SLA without fabricated metrics', () => {
  const item = normalizeReplyQueueItem('reply-1', {
    orgId: 'org-1', inboundId: 'in-1', contactId: 'c-1', ownerUserId: 'u-1', queueId: 'q-1',
    campaignId: 'camp-1', programId: 'prog-1', sequenceId: 'seq-1', broadcastId: 'b-1', salespersonUid: 'sales-1',
    subject: 'Interested', bodyText: 'Please call me', fromEmail: 'buyer@example.com', receivedAt: { toMillis: () => 1_000 },
    slaMinutes: 1, slaDueAt: { toMillis: () => 61_000 }, createdAt: { toMillis: () => 1_000 },
    classification: { classification: 'positive', confidence: 0.78, assistiveOnly: true },
    classificationCorrection: { classification: 'neutral', correctedBy: 'manager-1', correctedAt: { toMillis: () => 2_000 } },
  }, 62_000)

  expect(item).toMatchObject({
    id: 'reply-1', contactId: 'c-1', ownerUserId: 'u-1', queueId: 'q-1', campaignId: 'camp-1', programId: 'prog-1',
    classification: 'neutral', modelClassification: 'positive', confidence: 0.78, corrected: true, slaState: 'missed', salespersonUid: 'sales-1',
  })
  expect(item).not.toHaveProperty('replyRate')
})

it('marks an open reply due when its SLA has not elapsed', () => {
  const item = normalizeReplyQueueItem('reply-1', { orgId: 'org-1', receivedAt: { toMillis: () => 10_000 }, slaDueAt: { toMillis: () => 3_610_000 } }, 20_000)
  expect(item.slaState).toBe('due')
  expect(item.slaDueAt).toBe(3_610_000)
})

it('clamps model confidence to the supported zero-to-one range', () => {
  expect(normalizeReplyQueueItem('high', { classification: { classification: 'positive', confidence: 8 } }).confidence).toBe(1)
  expect(normalizeReplyQueueItem('low', { classification: { classification: 'negative', confidence: -2 } }).confidence).toBe(0)
})

it('scans stable datastore pages beyond 500 records for selective filters', async () => {
  const all = Array.from({ length: 620 }, (_, index) => ({
    id: `reply-${String(620 - index).padStart(4, '0')}`,
    data: { orgId: 'org-1', receivedAt: 10_000 - Math.floor(index / 2), ownerUserId: index === 610 ? 'wanted' : 'other' },
  }))
  const queryPage = jest.fn(async (_orgId: string, cursor: string | null, pageSize: number): Promise<ReplyQueuePage> => {
    const offset = cursor ? Number(Buffer.from(cursor, 'base64url').toString().split(':')[0]) : 0
    const docs = all.slice(offset, offset + pageSize)
    const nextOffset = offset + docs.length
    return { docs, nextCursor: nextOffset < all.length ? Buffer.from(`${nextOffset}:opaque`).toString('base64url') : null }
  })

  const result = await listReplyQueue('org-1', { ownerUserId: 'wanted', cursor: null, limit: 1 }, { queryPage })
  expect(result.items).toHaveLength(1)
  expect(result.items[0].ownerUserId).toBe('wanted')
  expect(queryPage).toHaveBeenCalledTimes(7)
  expect(result.nextCursor).toBeTruthy()
})

it('does not emit a cursor when an exact-size page exhausts the datastore', async () => {
  const result = await listReplyQueue('org-1', { cursor: null, limit: 2 }, {
    queryPage: async () => ({
      docs: [
        { id: 'reply-2', data: { orgId: 'org-1', receivedAt: 2_000 } },
        { id: 'reply-1', data: { orgId: 'org-1', receivedAt: 1_000 } },
      ],
      nextCursor: null,
    }),
  })
  expect(result.items).toHaveLength(2)
  expect(result.nextCursor).toBeNull()
})
