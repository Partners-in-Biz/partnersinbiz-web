import { buildCaptureFunnel } from '@/lib/lead-capture/funnel'

describe('capture funnel', () => {
  it('reports only counts observed on persisted submissions', () => {
    expect(buildCaptureFunnel([
      { confirmedAt: {}, completedSteps: true, qualifiedAt: {}, opportunityId: 'deal-1', revenueAmount: 2500 },
      { confirmedAt: null, completedSteps: false },
    ], { honeypot: 3, disposable: 2, rateLimit: 1, captcha: 0 })).toEqual({
      views: null,
      starts: null,
      submissions: 2,
      completed: 1,
      confirmed: 1,
      qualified: 1,
      opportunities: 1,
      revenue: 2500,
      blocked: 6,
      unavailableMetrics: ['views', 'starts'],
    })
  })
})
