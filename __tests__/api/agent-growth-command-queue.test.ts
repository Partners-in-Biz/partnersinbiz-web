import { NextRequest } from 'next/server'

const AI_KEY = 'test-growth-command-queue-key'
process.env.AI_API_KEY = AI_KEY

const mockCollection = jest.fn()
const mockBuildBriefingFeed = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/briefing/feed', () => ({
  buildBriefingFeed: mockBuildBriefingFeed,
}))

function docs(rows: Record<string, unknown>[], prefix: string) {
  return rows.map((row, index) => ({ id: `${prefix}-${index}`, data: () => row }))
}

function timestamp(iso: string) {
  return { toDate: () => new Date(iso) }
}

function collectionRows(name: string): Record<string, unknown>[] {
  if (name === 'organizations') return [{ settings: {} }]
  if (name === 'contacts') return [{ type: 'lead', stage: 'proposal', source: 'manual' }]
  if (name === 'deals') return [{ title: 'Proposal', value: 0, probability: 60, pipelineId: 'pipe-1', stageId: 'proposal' }]
  if (name === 'pipelines') {
    return [{
      name: 'Partners Growth Pipeline',
      isDefault: true,
      archived: false,
      stages: [{ id: 'proposal', label: 'Proposal', kind: 'open', probability: 60 }],
    }]
  }
  if (name === 'social_posts') return [{ status: 'draft', platforms: ['linkedin'], content: 'Draft post' }]
  if (name === 'social_accounts') return [{ status: 'active', platform: 'linkedin' }]
  if (name === 'social_queue') return []
  throw new Error(`Unexpected collection: ${name}`)
}

describe('GET /api/v1/agent/growth-command-queue', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockBuildBriefingFeed.mockResolvedValue({
      generatedAt: '2026-07-01T08:00:00.000Z',
      total: 0,
      items: [],
      pageSize: 80,
      hasMore: false,
      scope: { orgId: 'pib-platform-owner' },
    })
    mockCollection.mockImplementation((name: string) => {
      if (name === 'organizations') {
        return {
          doc: jest.fn(() => ({
            get: jest.fn().mockResolvedValue({ exists: true, data: () => collectionRows(name)[0] }),
          })),
        }
      }
      return {
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ docs: docs(collectionRows(name), name) }),
      }
    })
  })

  it('returns a read-only growth command queue from stored CRM, social, and briefing data', async () => {
    const { GET } = await import('@/app/api/v1/agent/growth-command-queue/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/agent/growth-command-queue', {
      headers: { authorization: `Bearer ${AI_KEY}`, 'x-org-id': 'pib-platform-owner' },
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.orgId).toBe('pib-platform-owner')
    expect(body.data.operatingRule.dashboardPolicy).toContain('permanent dashboard')
    expect(body.data.sourceReports.crmPipelineDiagnostics.primaryFinding.code).toBe('open_deals_without_value')
    expect(body.data.sourceReports.socialContentReadiness.primaryFinding.code).toBe('missing_active_platform_accounts')
    expect(body.data.queue.some((item: { kind: string }) => item.kind === 'crm-cleanup')).toBe(true)
    expect(body.data.queue.some((item: { kind: string }) => item.kind === 'marketing-review')).toBe(true)
    expect(mockBuildBriefingFeed).toHaveBeenCalledWith(expect.objectContaining({
      role: 'ai',
      orgId: 'pib-platform-owner',
    }), expect.objectContaining({
      orgId: 'pib-platform-owner',
      limit: 80,
    }))
  })

  it('downgrades failed agent-run cards when the source conversation has later assistant recovery output', async () => {
    mockBuildBriefingFeed.mockResolvedValue({
      generatedAt: '2026-07-01T08:00:00.000Z',
      total: 1,
      items: [{
        id: 'agent-run:run-doc-recovered:hash',
        title: 'Pip run needs recovery',
        summary: 'Pip run failed and needs review.',
        excerpt: null,
        priority: 'critical',
        source: { type: 'agent-run', id: 'run-doc-recovered', collectionPath: 'hermes_runs', url: '/admin/agents/pip?run=run_123' },
        context: { orgId: 'pib-platform-owner', reviewerAgentId: 'pip' },
        actor: { id: 'agent:pip', role: 'ai', type: 'agent' },
        occurredAt: new Date('2026-06-29T17:16:46.825Z'),
        createdAt: new Date('2026-06-29T17:16:46.825Z'),
        updatedAt: new Date('2026-06-29T17:16:46.825Z'),
        timeAgo: '2 days ago',
        unread: true,
        requiresAction: true,
        relevanceScore: 100,
        status: 'active',
        sourceHash: 'hash',
        actions: [],
        metadata: {},
      }],
      pageSize: 80,
      hasMore: false,
      scope: { orgId: 'pib-platform-owner' },
    })

    mockCollection.mockImplementation((name: string) => {
      if (name === 'organizations') {
        return {
          doc: jest.fn(() => ({
            get: jest.fn().mockResolvedValue({ exists: true, data: () => collectionRows(name)[0] }),
          })),
        }
      }
      if (name === 'hermes_runs') {
        return {
          doc: jest.fn(() => ({
            get: jest.fn().mockResolvedValue({
              exists: true,
              data: () => ({
                status: 'failed',
                updatedAt: timestamp('2026-06-29T17:16:46.825Z'),
                prompt: '[Conversation — convId: conv-recovered, participants: Peet Stander (admin), Pip (agent)]',
              }),
            }),
          })),
        }
      }
      if (name === 'conversations') {
        return {
          doc: jest.fn(() => ({
            collection: jest.fn(() => ({
              orderBy: jest.fn().mockReturnThis(),
              limit: jest.fn().mockReturnThis(),
              get: jest.fn().mockResolvedValue({
                docs: [{
                  data: () => ({
                    role: 'assistant',
                    status: 'completed',
                    content: 'Done. I recovered the proposal output.',
                    createdAt: timestamp('2026-06-29T17:37:34.516Z'),
                  }),
                }],
              }),
            })),
          })),
        }
      }
      return {
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ docs: docs(collectionRows(name), name) }),
      }
    })

    const { GET } = await import('@/app/api/v1/agent/growth-command-queue/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/agent/growth-command-queue', {
      headers: { authorization: `Bearer ${AI_KEY}`, 'x-org-id': 'pib-platform-owner' },
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    const recoveredItem = body.data.queue.find((item: { id: string }) => item.id === 'briefing:agent-run:run-doc-recovered:hash')
    expect(recoveredItem).toMatchObject({
      kind: 'ops-cleanup',
      priority: 'review',
      approvalRequired: false,
    })
    expect(recoveredItem.summary).toContain('already recovered')
    expect(body.data.sourceReports.briefingFeed.approvalLikeItems).toBe(0)
  })
})
