/**
 * Tests for GET /api/v1/crm/dashboard
 */
import { NextRequest } from 'next/server'
import { Timestamp } from 'firebase-admin/firestore'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn() },
}))

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { seedOrgMember, callAsMember, callAsAgent } from '../../../helpers/crm'
import { makePortalAuthCollections } from '../../../helpers/firebase-admin'

const AI_API_KEY = 'test-ai-key-abc'
process.env.AI_API_KEY = AI_API_KEY
process.env.SESSION_COOKIE_NAME = '__session'

// ── Types ──────────────────────────────────────────────────────────────────

interface DealFixture {
  id: string
  orgId: string
  title: string
  value: number
  probability?: number
  lostReason?: string
  deleted?: boolean
  updatedAt?: { toDate: () => Date } | null
}

interface ActivityFixture {
  id: string
  orgId: string
  type: string
  createdAt: Timestamp
}

// ── Helpers ────────────────────────────────────────────────────────────────

function buildQueryChain(docs: Array<{ id: string; data: Record<string, unknown> }>) {
  const chain: Record<string, jest.Mock> = {}
  chain.where = jest.fn().mockReturnValue(chain)
  chain.orderBy = jest.fn().mockReturnValue(chain)
  chain.limit = jest.fn().mockReturnValue(chain)
  chain.offset = jest.fn().mockReturnValue(chain)
  chain.get = jest.fn().mockResolvedValue({ docs: docs.map((d) => ({ id: d.id, data: () => d.data })) })
  return chain
}

function stageAuth(
  member: { uid: string; orgId: string; role: string; firstName?: string; lastName?: string },
  opts: {
    deals?: DealFixture[]
    activities?: ActivityFixture[]
  } = {},
) {
  ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })
  const authCollections = makePortalAuthCollections(member)
  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    if (name in authCollections) return authCollections[name as keyof typeof authCollections]
    if (name === 'users')
      return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ activeOrgId: member.orgId }) }) }) }
    if (name === 'orgMembers')
      return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => member }) }) }
    if (name === 'organizations')
      return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ settings: { permissions: {} } }) }) }) }
    if (name === 'deals') {
      const dealDocs = (opts.deals ?? []).map((d) => ({ id: d.id, data: d as unknown as Record<string, unknown> }))
      return buildQueryChain(dealDocs)
    }
    if (name === 'activities') {
      const actDocs = (opts.activities ?? []).map((a) => ({ id: a.id, data: a as unknown as Record<string, unknown> }))
      return buildQueryChain(actDocs)
    }
    return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
  })
}

// ── Fixtures ───────────────────────────────────────────────────────────────

const now = new Date()
const thisMonth = new Date(now.getFullYear(), now.getMonth(), 5)
const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 5)

function makeUpdatedAt(date: Date) {
  return { toDate: () => date }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('GET /api/v1/crm/dashboard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 401 without auth', async () => {
    const req = new NextRequest('http://localhost/api/v1/crm/dashboard')
    const { GET } = await import('@/app/api/v1/crm/dashboard/route')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('returns 403 for viewer role (member+ required)', async () => {
    const viewer = seedOrgMember('org-1', 'uid-viewer', { role: 'viewer' })
    stageAuth(viewer)
    const req = callAsMember(viewer, 'GET', '/api/v1/crm/dashboard')
    const { GET } = await import('@/app/api/v1/crm/dashboard/route')
    const res = await GET(req)
    expect(res.status).toBe(403)
  })

  it('returns 200 with correct shape for member', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    stageAuth(member)
    const req = callAsMember(member, 'GET', '/api/v1/crm/dashboard')
    const { GET } = await import('@/app/api/v1/crm/dashboard/route')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data).toHaveProperty('openDealsCount')
    expect(body.data).toHaveProperty('openDealsValue')
    expect(body.data).toHaveProperty('weightedPipelineValue')
    expect(body.data).toHaveProperty('wonThisMonth')
    expect(body.data).toHaveProperty('lostThisMonth')
    expect(body.data).toHaveProperty('recentActivities')
    expect(body.data).toHaveProperty('topOpenDeals')
  })

  it('agent (bearer) can access dashboard', async () => {
    const member = seedOrgMember('org-agent', 'uid-agent', { role: 'member' })
    stageAuth(member)
    const req = callAsAgent('org-agent', 'GET', '/api/v1/crm/dashboard')
    const { GET } = await import('@/app/api/v1/crm/dashboard/route')
    const res = await GET(req)
    expect(res.status).toBe(200)
  })

  it('openDealsCount excludes deals with lostReason', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    stageAuth(member, {
      deals: [
        { id: 'd1', orgId: 'org-1', title: 'Open', value: 100, probability: 50 },
        { id: 'd2', orgId: 'org-1', title: 'Lost', value: 200, lostReason: 'No budget' },
      ],
    })
    const req = callAsMember(member, 'GET', '/api/v1/crm/dashboard')
    const { GET } = await import('@/app/api/v1/crm/dashboard/route')
    const res = await GET(req)
    const body = await res.json()
    expect(body.data.openDealsCount).toBe(1)
  })

  it('openDealsCount excludes deals with probability === 100', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    stageAuth(member, {
      deals: [
        { id: 'd1', orgId: 'org-1', title: 'Open', value: 100, probability: 60 },
        { id: 'd2', orgId: 'org-1', title: 'Won', value: 500, probability: 100 },
      ],
    })
    const req = callAsMember(member, 'GET', '/api/v1/crm/dashboard')
    const { GET } = await import('@/app/api/v1/crm/dashboard/route')
    const res = await GET(req)
    const body = await res.json()
    expect(body.data.openDealsCount).toBe(1)
    expect(body.data.openDealsValue).toBe(100)
  })

  it('weightedPipelineValue correctly computed (value × probability/100)', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    stageAuth(member, {
      deals: [
        { id: 'd1', orgId: 'org-1', title: 'Deal A', value: 1000, probability: 50 },
        { id: 'd2', orgId: 'org-1', title: 'Deal B', value: 2000, probability: 25 },
      ],
    })
    const req = callAsMember(member, 'GET', '/api/v1/crm/dashboard')
    const { GET } = await import('@/app/api/v1/crm/dashboard/route')
    const res = await GET(req)
    const body = await res.json()
    // 1000*0.5 + 2000*0.25 = 500 + 500 = 1000
    expect(body.data.weightedPipelineValue).toBe(1000)
  })

  it('wonThisMonth only includes deals updated in current calendar month', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    stageAuth(member, {
      deals: [
        { id: 'd1', orgId: 'org-1', title: 'Won this month', value: 500, probability: 100, updatedAt: makeUpdatedAt(thisMonth) },
        { id: 'd2', orgId: 'org-1', title: 'Won last month', value: 300, probability: 100, updatedAt: makeUpdatedAt(lastMonth) },
        { id: 'd3', orgId: 'org-1', title: 'Open', value: 100, probability: 50 },
      ],
    })
    const req = callAsMember(member, 'GET', '/api/v1/crm/dashboard')
    const { GET } = await import('@/app/api/v1/crm/dashboard/route')
    const res = await GET(req)
    const body = await res.json()
    expect(body.data.wonThisMonth.count).toBe(1)
    expect(body.data.wonThisMonth.value).toBe(500)
  })

  it('lostThisMonth only includes deals with lostReason updated in current month', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    stageAuth(member, {
      deals: [
        { id: 'd1', orgId: 'org-1', title: 'Lost this month', value: 200, lostReason: 'Too expensive', updatedAt: makeUpdatedAt(thisMonth) },
        { id: 'd2', orgId: 'org-1', title: 'Lost last month', value: 100, lostReason: 'Competitor', updatedAt: makeUpdatedAt(lastMonth) },
        { id: 'd3', orgId: 'org-1', title: 'Open', value: 50, probability: 40 },
      ],
    })
    const req = callAsMember(member, 'GET', '/api/v1/crm/dashboard')
    const { GET } = await import('@/app/api/v1/crm/dashboard/route')
    const res = await GET(req)
    const body = await res.json()
    expect(body.data.lostThisMonth.count).toBe(1)
  })

  it('topOpenDeals limited to 5 and sorted by value descending', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    stageAuth(member, {
      deals: [
        { id: 'd1', orgId: 'org-1', title: 'Deal 1', value: 100, probability: 50 },
        { id: 'd2', orgId: 'org-1', title: 'Deal 2', value: 600, probability: 50 },
        { id: 'd3', orgId: 'org-1', title: 'Deal 3', value: 200, probability: 50 },
        { id: 'd4', orgId: 'org-1', title: 'Deal 4', value: 500, probability: 50 },
        { id: 'd5', orgId: 'org-1', title: 'Deal 5', value: 300, probability: 50 },
        { id: 'd6', orgId: 'org-1', title: 'Deal 6', value: 400, probability: 50 },
      ],
    })
    const req = callAsMember(member, 'GET', '/api/v1/crm/dashboard')
    const { GET } = await import('@/app/api/v1/crm/dashboard/route')
    const res = await GET(req)
    const body = await res.json()
    expect(body.data.topOpenDeals).toHaveLength(5)
    // Sorted desc by value: 600, 500, 400, 300, 200
    expect(body.data.topOpenDeals[0].value).toBe(600)
    expect(body.data.topOpenDeals[4].value).toBe(200)
  })

  it('recentActivities returns up to 10 items', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    const activities: ActivityFixture[] = Array.from({ length: 10 }, (_, i) => ({
      id: `act-${i}`,
      orgId: 'org-1',
      type: 'note',
      createdAt: Timestamp.now(),
    }))
    stageAuth(member, { activities })
    const req = callAsMember(member, 'GET', '/api/v1/crm/dashboard')
    const { GET } = await import('@/app/api/v1/crm/dashboard/route')
    const res = await GET(req)
    const body = await res.json()
    expect(body.data.recentActivities).toHaveLength(10)
  })

  it('returns empty state correctly when no deals exist', async () => {
    const member = seedOrgMember('org-empty', 'uid-1', { role: 'member' })
    stageAuth(member)
    const req = callAsMember(member, 'GET', '/api/v1/crm/dashboard')
    const { GET } = await import('@/app/api/v1/crm/dashboard/route')
    const res = await GET(req)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.openDealsCount).toBe(0)
    expect(body.data.openDealsValue).toBe(0)
    expect(body.data.weightedPipelineValue).toBe(0)
    expect(body.data.wonThisMonth.count).toBe(0)
    expect(body.data.wonThisMonth.value).toBe(0)
    expect(body.data.lostThisMonth.count).toBe(0)
    expect(body.data.topOpenDeals).toHaveLength(0)
    expect(body.data.recentActivities).toHaveLength(0)
  })
})
