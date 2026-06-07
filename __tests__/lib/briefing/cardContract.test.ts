import { seoTaskAdapter } from '@/lib/briefing/adapters/seoTaskAdapter'
import { agentOutputAdapter } from '@/lib/briefing/adapters/agentOutputAdapter'
import { buildBriefingCardContract } from '@/lib/briefing/cardContract'
import type { BriefingSourceItem } from '@/lib/briefing/types'

describe('briefing v2 card contract', () => {
  it('adds first-class decision fields to SEO decision cards without hiding source evidence', () => {
    const item = seoTaskAdapter.toItem({
      orgId: 'pib-platform-owner',
      orgSlug: 'partners-in-biz',
      sprintId: 'sprint-1',
      title: 'Choose keyword theme',
      focus: 'Keyword theme',
      taskType: 'decision',
      status: 'not_started',
      blockerReason: 'Peet must choose the next theme before SEO can continue.',
      createdAt: '2026-06-07T08:00:00.000Z',
      updatedAt: '2026-06-07T08:00:00.000Z',
    }, 'seo-task-1')

    expect(item.decisionRequest).toMatchObject({
      prompt: expect.stringContaining('Choose keyword theme'),
      scope: 'internal',
      source: 'seo-task',
    })
    expect(item.options).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'complete', label: expect.stringContaining('Complete') }),
      expect.objectContaining({ id: 'skip', label: expect.stringContaining('Skip') }),
    ]))
    expect(item.recommendedOption).toMatchObject({ id: 'complete' })
    expect(item.inputTarget).toMatchObject({ action: 'complete', resourceType: 'seo-task', resourceId: 'seo-task-1' })
    expect(item.afterSubmit).toMatchObject({ consequence: expect.stringContaining('SEO') })
    expect(item.agentHandoff).toMatchObject({ targetAgentId: 'seo', sourceTaskId: 'seo-task-1' })
    expect(item.evidenceLinks).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: expect.stringContaining('Open source'), href: expect.stringContaining('seo-task-1') }),
    ]))
    expect(item.safetyGate).toMatchObject({ sideEffectAllowed: false, requiresApproval: true })
    expect(item.disabledReason).toContain('approval')
    expect(item.nearestValidActions).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'create-task' }),
      expect.objectContaining({ action: 'open-evidence' }),
    ]))
  })

  it('normalizes agent output review cards into the same shared v2 contract', () => {
    const item = agentOutputAdapter.toItem({
      orgId: 'pib-platform-owner',
      projectId: 'project-1',
      taskId: 'task-1',
      assigneeAgentId: 'theo',
      reviewStatus: 'pending',
      columnId: 'review',
      completedAt: '2026-06-07T08:00:00.000Z',
      summary: 'Implemented a development-only change and ran focused tests.',
      artifacts: [{ type: 'commit', ref: 'abc123', label: 'development commit' }],
    }, 'task-1:agent-output')

    expect(item.decisionRequest).toMatchObject({
      prompt: expect.stringContaining('review'),
      source: 'agent-output',
    })
    expect(item.options).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'approve-review' }),
      expect.objectContaining({ id: 'request-changes' }),
    ]))
    expect(item.recommendedOption).toMatchObject({ id: 'approve-review' })
    expect(item.agentHandoff).toMatchObject({ targetAgentId: 'theo', sourceTaskId: 'task-1' })
    expect(item.evidenceLinks).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'source', href: expect.stringContaining('task-1') }),
    ]))
    expect(item.safetyGate).toMatchObject({ sideEffectAllowed: false, requiresApproval: false })
    expect(item.nearestValidActions).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'open-evidence' }),
    ]))
  })

  it('redacts custom contract text and never allows source-controlled side effects or cross-org targets', () => {
    const baseItem: BriefingSourceItem = {
      orgId: 'org-safe',
      source: {
        type: 'task',
        id: 'task-safe',
        collectionPath: 'tasks',
        url: '/admin/projects?taskId=task-safe',
      },
      priority: 'progress',
      status: 'active',
      title: 'Review safe task',
      summary: 'Review output that accidentally includes apiKey: should-redact-me',
      excerpt: null,
      actor: { id: 'agent:theo', role: 'ai', type: 'agent' },
      context: {},
      occurredAt: new Date('2026-06-07T08:00:00.000Z'),
      sourceHash: 'hash-safe',
      metadata: null,
      decisionRequest: {
        prompt: 'Approve Bearer secret-token-123456',
        scope: 'public',
        source: 'task',
        reason: 'token: secret-token-123456',
      },
      inputTarget: {
        action: 'publish-now',
        resourceType: 'task',
        resourceId: 'other-task',
        orgId: 'other-org',
      },
      safetyGate: {
        level: 'disabled',
        summary: 'custom gate',
        sideEffectAllowed: true,
        requiresApproval: false,
        gatedActions: ['public-publish'],
      },
      evidenceLinks: [{ id: 'e1', label: 'API key evidence', description: 'apiKey: should-redact-me', kind: 'evidence' }],
      nearestValidActions: [{ action: 'open-evidence', label: 'Open evidence' }],
    }

    const contract = buildBriefingCardContract(baseItem)

    expect(contract.decisionRequest.prompt).toContain('[REDACTED]')
    expect(contract.decisionRequest.reason).toContain('[REDACTED]')
    expect(contract.evidenceLinks[0]?.description).toContain('[REDACTED]')
    expect(contract.inputTarget.orgId).toBe('org-safe')
    expect(contract.safetyGate.sideEffectAllowed).toBe(false)
    expect(contract.safetyGate.gatedActions).toContain('public-publish')
  })
})
