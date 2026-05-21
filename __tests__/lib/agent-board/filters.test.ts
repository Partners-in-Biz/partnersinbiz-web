import {
  getAgentBoardBadges,
  getAgentBoardFilterCounts,
  matchesAgentBoardView,
  type AgentBoardOperationalView,
  type AgentBoardTaskLike,
} from '@/lib/agent-board/filters'

const baseCard = (overrides: Partial<AgentBoardTaskLike> = {}): AgentBoardTaskLike => ({
  id: 'task-1',
  source: 'project',
  orgId: 'org-main',
  title: 'Test task',
  projectId: 'project-1',
  projectName: 'Project',
  assigneeAgentId: 'theo',
  agentStatus: 'pending',
  agentInputSpec: 'Do the work',
  agentOutputSummary: null,
  priority: 'normal',
  tags: [],
  labels: [],
  updatedAt: null,
  createdAt: null,
  href: '#',
  ...overrides,
})

describe('agent board operational filters', () => {
  it('identifies badges for agent, blocked, awaiting input, document links, dependency blockers, cron origin, and cross-client work', () => {
    const badges = getAgentBoardBadges(baseCard({
      agentStatus: 'blocked',
      linkedDocumentId: 'doc-1',
      dependsOn: ['task-parent'],
      dependencyStatuses: { 'task-parent': 'pending' },
      origin: 'cron:social-rss',
      clientOrgId: 'org-client',
    }))

    expect(badges.map((badge) => badge.id)).toEqual(expect.arrayContaining([
      'agent:theo',
      'blocked',
      'document-linked',
      'dependency-blocked',
      'cron-origin',
      'cross-client',
    ]))
  })

  it('treats awaiting-input as its own operational view separate from blocked', () => {
    const card = baseCard({ agentStatus: 'awaiting-input' })

    expect(matchesAgentBoardView(card, 'awaiting-input')).toBe(true)
    expect(matchesAgentBoardView(card, 'blocked')).toBe(false)
    expect(getAgentBoardBadges(card).map((badge) => badge.id)).toContain('awaiting-input')
  })

  it('computes filter counts from cards without double-counting repeated labels', () => {
    const cards = [
      baseCard({ id: 'a', labels: ['document:doc-1', 'document:doc-1'] }),
      baseCard({ id: 'b', agentStatus: 'blocked' }),
      baseCard({ id: 'c', sourceOrigin: 'cron' }),
      baseCard({ id: 'd', clientOrgId: 'org-client' }),
    ]

    const counts = getAgentBoardFilterCounts(cards)

    expect(counts['all']).toBe(4)
    expect(counts['document-linked']).toBe(1)
    expect(counts['blocked']).toBe(1)
    expect(counts['cron-origin']).toBe(1)
    expect(counts['cross-client']).toBe(1)
  })

  it('treats linkedDocuments arrays as document-linked work', () => {
    const card = baseCard({ linkedDocuments: [{ id: 'client-doc-1', type: 'client_document' }] })

    expect(matchesAgentBoardView(card, 'document-linked')).toBe(true)
    expect(getAgentBoardBadges(card).map((badge) => badge.id)).toContain('document-linked')
  })

  it.each<AgentBoardOperationalView>([
    'all',
    'blocked',
    'awaiting-input',
    'document-linked',
    'dependency-blocked',
    'cron-origin',
    'cross-client',
  ])('supports %s as a filter view', (view) => {
    expect(typeof matchesAgentBoardView(baseCard(), view)).toBe('boolean')
  })
})
