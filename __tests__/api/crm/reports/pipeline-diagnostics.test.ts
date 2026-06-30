import { NextRequest } from 'next/server'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn() },
}))

import { adminDb } from '@/lib/firebase/admin'
import { buildCrmPipelineDiagnostics } from '@/lib/crm/pipeline-diagnostics'
import { GET } from '@/app/api/v1/crm/reports/pipeline-diagnostics/route'

const AI_KEY = 'test-pipeline-diagnostics-key'
process.env.AI_API_KEY = AI_KEY

function makeReq(orgId = 'org-a') {
  return new NextRequest('http://localhost/api/v1/crm/reports/pipeline-diagnostics', {
    headers: { authorization: `Bearer ${AI_KEY}`, 'x-org-id': orgId },
  })
}

function docs(rows: Record<string, unknown>[], prefix: string) {
  return rows.map((row, index) => ({ id: `${prefix}-${index}`, data: () => row }))
}

function setupCollections({
  contacts = [],
  deals = [],
  pipelines = [],
}: {
  contacts?: Record<string, unknown>[]
  deals?: Record<string, unknown>[]
  pipelines?: Record<string, unknown>[]
}) {
  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    if (name === 'organizations') {
      return {
        doc: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ settings: {} }) }),
        }),
      }
    }
    if (name === 'contacts') {
      return {
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ docs: docs(contacts, 'contact') }),
      }
    }
    if (name === 'deals') {
      return {
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ docs: docs(deals, 'deal') }),
      }
    }
    if (name === 'pipelines') {
      return {
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ docs: docs(pipelines, 'pipeline') }),
      }
    }
    throw new Error(`Unexpected collection: ${name}`)
  })
}

describe('CRM pipeline diagnostics', () => {
  beforeEach(() => jest.clearAllMocks())

  it('identifies lead volume with no deals as a conversion workflow gap', () => {
    const diagnostics = buildCrmPipelineDiagnostics({
      contacts: [
        { id: 'c1', type: 'lead', stage: 'new', source: 'manual' },
        { id: 'c2', type: 'lead', stage: 'contacted', source: 'import' },
        { id: 'c3', type: 'prospect', stage: 'demo', source: 'outreach' },
        { id: 'c4', type: 'client', stage: 'won', source: 'manual' },
      ],
      deals: [],
      pipelines: [{
        id: 'pipe-1',
        name: 'Sales',
        isDefault: true,
        archived: false,
        stages: [{ id: 'new', label: 'New', kind: 'open', probability: 20 }],
      }],
    })

    expect(diagnostics.summary.totalContacts).toBe(4)
    expect(diagnostics.summary.leadLikeContacts).toBe(3)
    expect(diagnostics.summary.openDeals).toBe(0)
    expect(diagnostics.summary.openPipelineValue).toBe(0)
    expect(diagnostics.primaryFinding.code).toBe('contacts_without_deals')
    expect(diagnostics.nextActions[0]).toContain('Create or repair the lead-to-deal conversion workflow')
  })

  it('separates zero-value open deals from a genuinely empty pipeline', () => {
    const diagnostics = buildCrmPipelineDiagnostics({
      contacts: [{ id: 'c1', type: 'lead', stage: 'proposal', source: 'manual' }],
      deals: [
        { id: 'd1', title: 'Website', value: 0, probability: 50, pipelineId: 'pipe-1', stageId: 'proposal' },
        { id: 'd2', title: 'SEO', value: 0, probability: 20, pipelineId: 'pipe-1', stageId: 'new' },
      ],
      pipelines: [{
        id: 'pipe-1',
        name: 'Sales',
        isDefault: true,
        archived: false,
        stages: [
          { id: 'new', label: 'New', kind: 'open', probability: 20 },
          { id: 'proposal', label: 'Proposal', kind: 'open', probability: 60 },
        ],
      }],
    })

    expect(diagnostics.summary.openDeals).toBe(2)
    expect(diagnostics.summary.openPipelineValue).toBe(0)
    expect(diagnostics.dataQuality.openDealsMissingValue).toBe(2)
    expect(diagnostics.primaryFinding.code).toBe('open_deals_without_value')
  })

  it('returns read-only diagnostics from the API using org-scoped collection reads', async () => {
    const whereMock = jest.fn().mockReturnThis()
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'organizations') {
        return {
          doc: jest.fn().mockReturnValue({
            get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ settings: {} }) }),
          }),
        }
      }
      return {
        where: whereMock,
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({
          docs: name === 'contacts'
            ? docs([{ type: 'lead', stage: 'new', source: 'manual' }], 'contact')
            : name === 'pipelines'
              ? docs([{
                name: 'Sales',
                isDefault: true,
                archived: false,
                stages: [{ id: 'new', label: 'New', kind: 'open', probability: 20 }],
              }], 'pipeline')
              : [],
        }),
      }
    })

    const res = await GET(makeReq('pib-platform-owner'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.summary.leadLikeContacts).toBe(1)
    expect(body.data.primaryFinding.code).toBe('contacts_without_deals')
    expect(whereMock).toHaveBeenCalledWith('orgId', '==', 'pib-platform-owner')
    expect(whereMock).toHaveBeenCalledTimes(3)
  })
})
