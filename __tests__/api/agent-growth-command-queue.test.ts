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
})
