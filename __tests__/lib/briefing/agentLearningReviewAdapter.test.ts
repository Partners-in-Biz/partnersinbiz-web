import { agentLearningReviewAdapter } from '@/lib/briefing/adapters/agentLearningReviewAdapter'

describe('agentLearningReviewAdapter', () => {
  const reviewTask = {
    id: 'task-learning-1',
    orgId: 'pib-platform-owner',
    projectId: 'project-website',
    title: 'Weekly Agent Learning Review - Theo',
    description: 'Review proposed skill hygiene items and wiki links before applying any change.',
    columnId: 'review',
    agentStatus: 'done',
    reviewStatus: 'pending',
    assigneeAgentId: 'theo',
    updatedAt: '2026-06-04T08:00:00.000Z',
    agentInput: {
      context: {
        sourceDocumentId: 'doc-learning-2026-06-04',
        approvalGateTaskId: 'approval-learning-1',
      },
    },
    agentOutput: {
      summary: 'Summarized observed agent lessons for Peet to review.',
      learningReview: {
        skillLinks: [{ label: 'systematic debugging', href: '/admin/skills/partnersinbiz/software-development/systematic-debugging' }],
        wikiLinks: [{ label: 'Agent learning log', href: '/admin/wiki/partners/agent-learning' }],
        taskLinks: [{ label: 'Follow-up task', href: '/admin/projects/project-website?taskId=task-learning-1' }],
        proposedSkillChanges: ['Add a pitfall about not rewriting skills automatically.'],
      },
    },
  }

  it('surfaces weekly learning review tasks as review items with explicit rewrite guard metadata', () => {
    expect(agentLearningReviewAdapter.shouldGenerate(reviewTask, 'task-learning-1')).toBe(true)
    expect(agentLearningReviewAdapter.extractPriority(reviewTask, 'task-learning-1')).toBe('review')

    const item = agentLearningReviewAdapter.toItem(reviewTask, 'task-learning-1')

    expect(item.source.type).toBe('agent-learning-review')
    expect(item.title).toBe('Weekly Agent Learning Review - Theo')
    expect(item.summary).toContain('No automatic skill or wiki rewrites')
    expect(item.source.url).toBe('https://partnersinbiz.online/admin/projects/project-website?taskId=task-learning-1')
    expect(item.context.taskId).toBe('task-learning-1')
    expect(item.metadata?.agentLearningReview).toMatchObject({
      reviewGate: 'proposals-only',
      automationGuard: expect.stringContaining('Proposed changes must be reviewed'),
      sourceDocumentId: 'doc-learning-2026-06-04',
      approvalGateTaskId: 'approval-learning-1',
      skillLinks: [{ label: 'systematic debugging', href: '/admin/skills/partnersinbiz/software-development/systematic-debugging', type: 'skill' }],
      wikiLinks: [{ label: 'Agent learning log', href: '/admin/wiki/partners/agent-learning', type: 'wiki' }],
      taskLinks: [{ label: 'Follow-up task', href: '/admin/projects/project-website?taskId=task-learning-1', type: 'task' }],
      proposedChanges: ['Add a pitfall about not rewriting skills automatically.'],
    })
  })

  it('does not surface ordinary tasks as learning review items', () => {
    expect(agentLearningReviewAdapter.shouldGenerate({
      ...reviewTask,
      title: 'Regular implementation task',
      description: 'Ship normal UI work.',
      agentOutput: { summary: 'Done.' },
    }, 'task-regular')).toBe(false)
  })
})
