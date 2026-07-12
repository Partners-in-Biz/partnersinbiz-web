import { buildReconciliationReport } from '@/lib/email-events/reconciliation'

describe('email event reconciliation', () => {
  it('rebuilds idempotent totals and uniques and reports drift without mutation', () => {
    const report = buildReconciliationReport({
      events: [
        { id: 'e1', orgId: 'org-1', messageId: 'm1', event: 'delivered', uniqueEventKey: 'u1' },
        { id: 'e1', orgId: 'org-1', messageId: 'm1', event: 'delivered', uniqueEventKey: 'u1' },
        { id: 'e2', orgId: 'org-1', messageId: 'm1', event: 'opened', uniqueEventKey: 'open:m1' },
        { id: 'e3', orgId: 'org-1', messageId: 'm1', event: 'opened', uniqueEventKey: 'open:m1' },
        { id: 'e4', orgId: 'other-org', messageId: 'm2', event: 'clicked', uniqueEventKey: 'click:m2' },
      ],
      stored: { delivered: 0, opened: 8 },
      orgId: 'org-1',
    })
    expect(report.rebuilt).toEqual({ delivered: 1, opened: 2, uniqueOpened: 1 })
    expect(report.drift).toEqual({ delivered: 1, opened: -6, uniqueOpened: 1 })
    expect(report.hasDrift).toBe(true)
  })
})
