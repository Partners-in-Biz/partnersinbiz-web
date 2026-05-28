import { NextRequest } from 'next/server'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn() },
}))

import { adminDb } from '@/lib/firebase/admin'
import { GET } from '@/app/api/v1/crm/reports/funnel/route'

const AI_KEY = 'test-key'
process.env.AI_API_KEY = AI_KEY

const ORG_A = 'org-a'
const ORG_B = 'org-b'

function makeReq(orgId = ORG_A) {
  return new NextRequest('http://localhost/api/v1/crm/reports/funnel', {
    headers: { authorization: `Bearer ${AI_KEY}`, 'x-org-id': orgId },
  })
}

type DocData = Record<string, unknown>

function setupContacts(contacts: DocData[]) {
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
        get: jest.fn().mockResolvedValue({
          docs: contacts.map((c, i) => ({ id: `c${i}`, data: () => c })),
        }),
      }
    }
    throw new Error(`Unexpected: ${name}`)
  })
}

describe('GET /api/v1/crm/reports/funnel', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns correct byType counts', async () => {
    setupContacts([
      { orgId: ORG_A, type: 'lead', stage: 'new', deleted: false },
      { orgId: ORG_A, type: 'lead', stage: 'contacted', deleted: false },
      { orgId: ORG_A, type: 'prospect', stage: 'demo', deleted: false },
      { orgId: ORG_A, type: 'client', stage: 'won', deleted: false },
      { orgId: ORG_A, type: 'churned', stage: 'lost', deleted: false },
    ])
    const res = await GET(makeReq())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.byType.lead).toBe(2)
    expect(body.data.byType.prospect).toBe(1)
    expect(body.data.byType.client).toBe(1)
    expect(body.data.byType.churned).toBe(1)
    expect(body.data.byType.other).toBe(0)
  })

  it('excludes soft-deleted contacts in memory after tenant scoping', async () => {
    setupContacts([
      { orgId: ORG_A, type: 'lead', stage: 'new', deleted: false },
      { orgId: ORG_A, type: 'client', stage: 'won', deleted: true },
    ])
    const res = await GET(makeReq())
    const body = await res.json()
    expect(body.data.total).toBe(1)
    expect(body.data.byType.lead).toBe(1)
    expect(body.data.byType.client).toBe(0)
  })

  it('counts unknown types under "other"', async () => {
    setupContacts([
      { orgId: ORG_A, type: 'partner', stage: 'new', deleted: false },
    ])
    const res = await GET(makeReq())
    const body = await res.json()
    expect(body.data.byType.other).toBe(1)
  })

  it('total matches sum of byType values', async () => {
    setupContacts([
      { orgId: ORG_A, type: 'lead', stage: 'new', deleted: false },
      { orgId: ORG_A, type: 'prospect', stage: 'demo', deleted: false },
      { orgId: ORG_A, type: 'client', stage: 'won', deleted: false },
    ])
    const res = await GET(makeReq())
    const body = await res.json()
    const { byType, total } = body.data
    const sum = byType.lead + byType.prospect + byType.client + byType.churned + byType.other
    expect(sum).toBe(total)
    expect(total).toBe(3)
  })

  it('returns all zeros for empty org', async () => {
    setupContacts([])
    const res = await GET(makeReq())
    const body = await res.json()
    expect(body.data.total).toBe(0)
    expect(body.data.byType.lead).toBe(0)
    expect(body.data.byType.prospect).toBe(0)
    expect(body.data.byType.client).toBe(0)
    expect(body.data.byType.churned).toBe(0)
    expect(body.data.byType.other).toBe(0)
  })

  it('groups byStage correctly', async () => {
    setupContacts([
      { orgId: ORG_A, type: 'lead', stage: 'new', deleted: false },
      { orgId: ORG_A, type: 'lead', stage: 'new', deleted: false },
      { orgId: ORG_A, type: 'prospect', stage: 'demo', deleted: false },
    ])
    const res = await GET(makeReq())
    const body = await res.json()
    expect(body.data.byStage.new).toBe(2)
    expect(body.data.byStage.demo).toBe(1)
  })

  it('scopes to orgId via Firestore query (query receives correct where clauses)', async () => {
    const whereMock = jest.fn().mockReturnThis()
    const getMock = jest.fn().mockResolvedValue({ docs: [] })
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'organizations') {
        return {
          doc: jest.fn().mockReturnValue({
            get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ settings: {} }) }),
          }),
        }
      }
      return { where: whereMock, get: getMock }
    })
    await GET(makeReq(ORG_B))
    // First where call should be orgId scoping
    expect(whereMock).toHaveBeenCalledWith('orgId', '==', ORG_B)
    expect(whereMock).toHaveBeenCalledTimes(1)
  })
})
