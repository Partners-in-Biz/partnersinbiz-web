import { getAdapter } from '@/lib/briefing'
import { businessInsightReviewAdapter } from '@/lib/briefing/adapters/businessInsightReviewAdapter'

describe('businessInsightReviewAdapter', () => {
  const insightTask = {
    id: 'task-insight-1',
    orgId: 'pib-platform-owner',
    projectId: 'growth-project',
    title: 'Investigate unowned high-intent leads',
    description: 'CRM insight found high-intent leads without an owner or next action.',
    columnId: 'review',
    agentStatus: 'done',
    reviewStatus: 'pending',
    assigneeAgentId: 'pip',
    updatedAt: '2026-06-13T09:30:00.000Z',
    metadata: {
      businessInsightReview: {
        type: 'business-insight-review',
        schemaVersion: 1,
        orgId: 'pib-platform-owner',
        sourceWindow: {
          from: '2026-06-06T00:00:00.000Z',
          to: '2026-06-13T00:00:00.000Z',
        },
        lane: 'crm',
        insightKind: 'follow-up-gap',
        summary: 'Three high-intent CRM leads have no owner or next action.',
        businessImpact: {
          estimateLabel: 'Potential response-time revenue leakage',
          metric: 'unowned_high_intent_leads',
          value: 3,
          confidence: 78,
        },
        sourceLinks: [
          { type: 'contact', id: 'contact-1', href: '/admin/crm/contacts/contact-1', label: 'Contact 1' },
          { type: 'deal', id: 'deal-1', href: '/admin/crm/deals/deal-1', label: 'Deal 1' },
        ],
        evidence: [
          { label: 'High-intent leads without owner', value: 3 },
          { label: 'Oldest lead age', value: '4 days' },
        ],
        recommendation: {
          nextAction: 'Assign Blake to triage the leads and create a follow-up task.',
          ownerAgentId: 'sales',
          ownerRole: 'sales',
          createsTask: true,
          approvalGate: 'human-review',
        },
        score: {
          impact: 82,
          urgency: 88,
          confidence: 78,
          actionability: 90,
          risk: 30,
          total: 77,
        },
        suppressionKey: 'crm:unowned-high-intent-leads:pib-platform-owner',
        reviewStatus: 'pending',
      },
    },
  }

  it('is registered as a first-class briefing source type', () => {
    expect(getAdapter('business-insight-review')).toBe(businessInsightReviewAdapter)
  })

  it('surfaces business insight review tasks with impact, owner, and safety metadata', () => {
    expect(businessInsightReviewAdapter.shouldGenerate(insightTask, 'task-insight-1')).toBe(true)
    expect(businessInsightReviewAdapter.extractPriority(insightTask, 'task-insight-1')).toBe('needs-peet')

    const item = businessInsightReviewAdapter.toItem(insightTask, 'task-insight-1')

    expect(item.source.type).toBe('business-insight-review')
    expect(item.title).toBe('Business Insight: Three high-intent CRM leads have no owner or next action.')
    expect(item.summary).toContain('Potential response-time revenue leakage')
    expect(item.summary).toContain('Assign Blake')
    expect(item.source.url).toBe('https://partnersinbiz.online/admin/projects/growth-project?taskId=task-insight-1')
    expect(item.context).toMatchObject({
      orgId: 'pib-platform-owner',
      projectId: 'growth-project',
      taskId: 'task-insight-1',
      requiredCapability: 'business-insight-review',
      riskLevel: 'high',
      reviewerAgentId: 'nora',
    })
    expect(item.metadata?.businessInsightReview).toMatchObject({
      reviewGate: 'internal-proposals-only',
      automationGuard: expect.stringContaining('No external send'),
      lane: 'crm',
      insightKind: 'follow-up-gap',
      score: expect.objectContaining({ total: 77 }),
      suppressionKey: 'crm:unowned-high-intent-leads:pib-platform-owner',
      sourceLinks: [
        { label: 'Contact 1', href: '/admin/crm/contacts/contact-1', type: 'contact' },
        { label: 'Deal 1', href: '/admin/crm/deals/deal-1', type: 'deal' },
      ],
      evidence: [
        { label: 'High-intent leads without owner', value: '3' },
        { label: 'Oldest lead age', value: '4 days' },
      ],
      recommendation: expect.objectContaining({
        nextAction: 'Assign Blake to triage the leads and create a follow-up task.',
        ownerAgentId: 'sales',
        approvalGate: 'human-review',
      }),
    })
    expect(item.metadata?.softwareBuildEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'High-intent leads without owner', value: '3' }),
    ]))
  })

  it('does not surface ordinary tasks as business insight reviews', () => {
    expect(businessInsightReviewAdapter.shouldGenerate({
      ...insightTask,
      title: 'Regular CRM cleanup',
      metadata: {},
    }, 'task-regular')).toBe(false)
  })
})
