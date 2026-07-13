import { buildEmailApprovalSnapshotHash, approvalSnapshotMatches } from '@/lib/email-marketing/approval-snapshot'

const broadcast = {
  content: { subject: 'Hello', bodyHtml: '<p>Hi</p>' }, audience: { contactIds: ['c1'] },
  senderPolicyId: 'sender-1', fromName: 'PiB', scheduledFor: '2026-08-01T08:00:00.000Z',
}

it('binds approval to content, audience, sender, and schedule', () => {
  const hash = buildEmailApprovalSnapshotHash(broadcast)
  for (const changed of [
    { ...broadcast, content: { ...broadcast.content, subject: 'Changed' } },
    { ...broadcast, audience: { contactIds: ['c2'] } },
    { ...broadcast, senderPolicyId: 'sender-2' },
    { ...broadcast, scheduledFor: '2026-08-02T08:00:00.000Z' },
  ]) expect(approvalSnapshotMatches(changed, hash)).toBe(false)
  expect(approvalSnapshotMatches(broadcast, hash)).toBe(true)
})
