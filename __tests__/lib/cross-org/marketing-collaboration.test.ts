import {
  MARKETING_COLLABORATION_CONTRACTS,
  MarketingCollaborationPolicyError,
  resolveMarketingCollaborationAction,
  projectAnalyticsReportingRecord,
} from '@/lib/cross-org/marketing-collaboration'

describe('marketing/analytics cross-org collaboration contracts', () => {
  it('defines only the six declared marketing/analytics modules with an explicit capability and resource type', () => {
    expect(Object.keys(MARKETING_COLLABORATION_CONTRACTS).sort()).toEqual([
      'ads',
      'analytics',
      'campaigns',
      'email',
      'seo',
      'social',
    ])
    expect(MARKETING_COLLABORATION_CONTRACTS.campaigns).toMatchObject({
      resourceType: 'campaign',
      requiredCapability: 'campaigns',
      namedUserRequired: true,
    })
    expect(MARKETING_COLLABORATION_CONTRACTS.analytics).toMatchObject({
      resourceType: 'analytics',
      requiredCapability: 'analytics',
      namedUserRequired: true,
    })
  })

  it('maps a social draft review to a non-publishing audited action', () => {
    expect(resolveMarketingCollaborationAction('social', 'draft_review')).toEqual({
      action: 'review_draft',
      resourceType: 'social_post',
      requiredCapability: 'social',
      namedUserRequired: true,
      humanApprovalRequired: false,
    })
  })

  it('allows an approval decision but never turns it into a publish, spend, or send operation', () => {
    expect(resolveMarketingCollaborationAction('ads', 'approval')).toMatchObject({
      action: 'approve',
      humanApprovalRequired: true,
    })
    expect(() => resolveMarketingCollaborationAction('ads', 'publish' as never)).toThrow(MarketingCollaborationPolicyError)
    expect(() => resolveMarketingCollaborationAction('email', 'delegated_operation', 'send')).toThrow('owner-only')
    expect(() => resolveMarketingCollaborationAction('ads', 'delegated_operation', 'spend')).toThrow('owner-only')
    expect(() => resolveMarketingCollaborationAction('social', 'delegated_operation', 'publish')).toThrow('owner-only')
  })

  it('limits delegated operations to preparation or analysis and keeps configuration owner-only', () => {
    expect(resolveMarketingCollaborationAction('seo', 'delegated_operation')).toMatchObject({ action: 'delegate_analyze' })
    expect(resolveMarketingCollaborationAction('campaigns', 'delegated_operation')).toMatchObject({ action: 'delegate_draft' })
    expect(() => resolveMarketingCollaborationAction('campaigns', 'delegated_operation', 'configure')).toThrow('owner-only')
    expect(() => resolveMarketingCollaborationAction('analytics', 'draft_review' as never)).toThrow(MarketingCollaborationPolicyError)
  })

  it('projects analytics reporting data to field-safe aggregate data even when a grant has no field restriction', () => {
    const projected = projectAnalyticsReportingRecord({
      period: { from: '2026-08-01', to: '2026-08-09' },
      metrics: { sessions: 42, conversions: 5 },
      dimensions: { channel: 'organic', country: 'ZA', email: 'private@example.com' },
      series: [{ date: '2026-08-09', sessions: 42, distinctId: 'visitor-1' }],
      rawEvents: [{ distinctId: 'visitor-1', ip: '10.0.0.1' }],
      customerEmail: 'private@example.com',
      approvalState: 'approved',
    }, { fields: null, items: null })

    expect(projected).toEqual({
      period: { from: '2026-08-01', to: '2026-08-09' },
      metrics: { sessions: 42, conversions: 5 },
      dimensions: { channel: 'organic', country: 'ZA' },
      series: [{ date: '2026-08-09', sessions: 42 }],
    })
  })

  it('further narrows analytics reporting to the named grant fields', () => {
    expect(projectAnalyticsReportingRecord({
      metrics: { sessions: 42 },
      dimensions: { channel: 'organic' },
    }, { fields: ['metrics'], items: null })).toEqual({ metrics: { sessions: 42 } })
  })
})
