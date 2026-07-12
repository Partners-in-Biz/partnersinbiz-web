import { normalizeReplyQueueItem } from '@/lib/email-marketing/reply-queue'

it('projects persisted lineage, human correction and missed SLA without fabricated metrics', () => {
  const item = normalizeReplyQueueItem('reply-1', {
    orgId: 'org-1', inboundId: 'in-1', contactId: 'c-1', ownerUserId: 'u-1', queueId: 'q-1',
    campaignId: 'camp-1', programId: 'prog-1', sequenceId: 'seq-1', broadcastId: 'b-1', salespersonUid: 'sales-1',
    subject: 'Interested', bodyText: 'Please call me', fromEmail: 'buyer@example.com', receivedAt: { toMillis: () => 1_000 },
    slaMinutes: 1, createdAt: { toMillis: () => 1_000 },
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
  const item = normalizeReplyQueueItem('reply-1', { orgId: 'org-1', createdAt: { toMillis: () => 10_000 }, slaMinutes: 60 }, 20_000)
  expect(item.slaState).toBe('due')
  expect(item.slaDueAt).toBe(3_610_000)
})
