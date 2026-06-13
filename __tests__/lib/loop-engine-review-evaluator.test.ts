import { buildConservativeReviewTaskDrafts } from '@/lib/loop-engine/review-evaluator'

describe('conservative loop review evaluator', () => {
  it('creates review-gated agent evolution drafts from repeated failure patterns', () => {
    const drafts = buildConservativeReviewTaskDrafts({
      orgId: 'pib-platform-owner',
      projectId: 'agent-ops-project',
      sourceWindow: {
        from: '2026-06-06T00:00:00.000Z',
        to: '2026-06-13T00:00:00.000Z',
      },
      agentSignals: [
        {
          id: 'run-1',
          category: 'missing-context',
          targetSurface: 'Hermes watcher prompt',
          title: 'Theo blocked on missing project context',
          summary: 'Task lacked source document links and repeated the same blocker.',
          severity: 82,
          confidence: 90,
          easeOfFix: 70,
          risk: 25,
          source: { type: 'run', id: 'run-1', href: '/admin/agents/runs/run-1', label: 'Run 1' },
          occurredAt: '2026-06-10T08:00:00.000Z',
        },
        {
          id: 'run-2',
          category: 'missing-context',
          targetSurface: 'Hermes watcher prompt',
          title: 'Maya blocked on missing project context',
          summary: 'A second task lacked source document links.',
          severity: 78,
          confidence: 85,
          easeOfFix: 70,
          risk: 25,
          source: { type: 'run', id: 'run-2', href: '/admin/agents/runs/run-2', label: 'Run 2' },
          occurredAt: '2026-06-11T08:00:00.000Z',
        },
      ],
      businessSignals: [],
      existingSuppressionKeys: [],
    })

    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toMatchObject({
      loopId: 'agent-evolution-review',
      orgId: 'pib-platform-owner',
      projectId: 'agent-ops-project',
      columnId: 'review',
      agentStatus: 'done',
      reviewStatus: 'pending',
      assigneeAgentId: 'pip',
      reviewerAgentId: 'qa-release',
      requiredCapability: 'agent-evolution-review',
      riskLevel: 'high',
      sideEffectPolicy: 'internal-review-only',
    })
    expect(drafts[0].title).toMatch(/Agent Evolution Review: missing context/i)
    expect(drafts[0].metadata.agentEvolutionReview).toMatchObject({
      type: 'agent-evolution-review',
      pattern: {
        category: 'missing-context',
        summary: 'Repeated missing-context pattern on Hermes watcher prompt',
        recurrenceCount: 2,
      },
      recommendation: {
        action: 'skill-proposal',
        approvalGate: 'human-review',
      },
      reviewStatus: 'pending',
    })
    expect(drafts[0].metadata.agentLearningReview).toMatchObject({
      learningReview: true,
      reviewGate: 'proposals-only',
    })
    expect(drafts[0].metadata.agentEvolutionReview.sourceLinks).toEqual([
      { type: 'run', id: 'run-1', href: '/admin/agents/runs/run-1', label: 'Run 1' },
      { type: 'run', id: 'run-2', href: '/admin/agents/runs/run-2', label: 'Run 2' },
    ])
  })

  it('creates business insight drafts from unsuppressed high-impact signals', () => {
    const drafts = buildConservativeReviewTaskDrafts({
      orgId: 'pib-platform-owner',
      projectId: 'growth-project',
      sourceWindow: {
        from: '2026-06-06T00:00:00.000Z',
        to: '2026-06-13T00:00:00.000Z',
      },
      agentSignals: [],
      businessSignals: [
        {
          id: 'crm-gap-1',
          lane: 'crm',
          insightKind: 'follow-up-gap',
          summary: 'Three high-intent CRM leads have no owner or next action.',
          impactEstimate: 'Potential response-time revenue leakage',
          metric: 'unowned_high_intent_leads',
          value: 3,
          impact: 82,
          urgency: 88,
          confidence: 78,
          actionability: 90,
          risk: 30,
          ownerAgentId: 'sales',
          ownerRole: 'sales',
          nextAction: 'Assign Blake to triage the leads and create a follow-up task.',
          suppressionKey: 'crm:unowned-high-intent-leads:pib-platform-owner',
          sourceLinks: [{ type: 'contact', id: 'contact-1', href: '/admin/crm/contacts/contact-1', label: 'Contact 1' }],
          evidence: [{ label: 'High-intent leads without owner', value: 3 }],
          hasNewSourceItem: true,
        },
      ],
      existingSuppressionKeys: [],
    })

    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toMatchObject({
      loopId: 'business-insight-review',
      orgId: 'pib-platform-owner',
      projectId: 'growth-project',
      columnId: 'review',
      agentStatus: 'done',
      reviewStatus: 'pending',
      assigneeAgentId: 'pip',
      reviewerAgentId: 'nora',
      requiredCapability: 'business-insight-review',
      riskLevel: 'high',
      sideEffectPolicy: 'internal-review-only',
    })
    expect(drafts[0].metadata.businessInsightReview).toMatchObject({
      type: 'business-insight-review',
      lane: 'crm',
      insightKind: 'follow-up-gap',
      summary: 'Three high-intent CRM leads have no owner or next action.',
      businessImpact: {
        estimateLabel: 'Potential response-time revenue leakage',
        metric: 'unowned_high_intent_leads',
        value: 3,
        confidence: 78,
      },
      recommendation: {
        nextAction: 'Assign Blake to triage the leads and create a follow-up task.',
        ownerAgentId: 'sales',
        approvalGate: 'human-review',
      },
      suppressionKey: 'crm:unowned-high-intent-leads:pib-platform-owner',
      reviewStatus: 'pending',
    })
    expect(drafts[0].metadata.businessInsightReview.score.total).toBe(77)
    expect(drafts[0].metadata.businessInsightReview.evidence).toEqual([{ label: 'High-intent leads without owner', value: 3 }])
  })

  it('suppresses repeated weak business insight signals without new evidence', () => {
    const drafts = buildConservativeReviewTaskDrafts({
      orgId: 'pib-platform-owner',
      projectId: 'growth-project',
      sourceWindow: {
        from: '2026-06-06T00:00:00.000Z',
        to: '2026-06-13T00:00:00.000Z',
      },
      agentSignals: [],
      businessSignals: [
        {
          id: 'crm-gap-1',
          lane: 'crm',
          insightKind: 'follow-up-gap',
          summary: 'One older CRM lead still has no owner.',
          impactEstimate: 'Small follow-up gap',
          impact: 35,
          urgency: 30,
          confidence: 45,
          actionability: 40,
          risk: 15,
          nextAction: 'Review if this still matters.',
          suppressionKey: 'crm:weak-lead-gap:pib-platform-owner',
          sourceLinks: [{ type: 'contact', id: 'contact-1', href: '/admin/crm/contacts/contact-1', label: 'Contact 1' }],
          evidence: [{ label: 'Weak repeated lead gap', value: 1 }],
        },
      ],
      existingSuppressionKeys: ['crm:weak-lead-gap:pib-platform-owner'],
    })

    expect(drafts).toEqual([])
  })
})
