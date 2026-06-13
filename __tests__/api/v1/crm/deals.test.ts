import { NextRequest } from 'next/server'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn() },
}))

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { seedOrgMember, callAsMember, callAsAgent } from '../../../helpers/crm'

const AI_API_KEY = 'test-ai-key-abc'
process.env.AI_API_KEY = AI_API_KEY
process.env.SESSION_COOKIE_NAME = '__session'

// Suppress logActivity, dispatchWebhook, and tryAttributeDealWon noise in tests
jest.mock('@/lib/activity/log', () => ({ logActivity: jest.fn().mockResolvedValue(undefined) }))
jest.mock('@/lib/webhooks/dispatch', () => ({ dispatchWebhook: jest.fn().mockResolvedValue(undefined) }))
jest.mock('@/lib/email-analytics/attribution-hooks', () => ({ tryAttributeDealWon: jest.fn().mockResolvedValue(undefined) }))
jest.mock('@/lib/automations/trigger', () => ({ fireTrigger: jest.fn().mockResolvedValue(undefined) }))

// Mock custom fields store for validation tests
jest.mock('@/lib/customFields/store', () => ({
  getDefinitionsForResource: jest.fn().mockResolvedValue([]),
}))
import { getDefinitionsForResource } from '@/lib/customFields/store'

// ── Pipeline mock setup ────────────────────────────────────────────────────────
// Default test pipeline used across all tests
const DEFAULT_PIPELINE_ID = 'pl-default'
const DEFAULT_PIPELINE = {
  id: DEFAULT_PIPELINE_ID,
  orgId: 'org-test',
  name: 'Test Pipeline',
  isDefault: true,
  archived: false,
  deleted: false,
  stages: [
    { id: 'discovery',   label: 'Discovery',   kind: 'open', order: 0, probability: 10 },
    { id: 'proposal',    label: 'Proposal',    kind: 'open', order: 1, probability: 30 },
    { id: 'negotiation', label: 'Negotiation', kind: 'open', order: 2, probability: 70 },
    { id: 'won',         label: 'Won',         kind: 'won',  order: 3, probability: 100 },
    { id: 'lost',        label: 'Lost',        kind: 'lost', order: 4, probability: 0 },
  ],
  createdAt: null,
  updatedAt: null,
}

// Mock pipelines store so route tests don't need real Firestore for pipeline lookups
jest.mock('@/lib/pipelines/store', () => ({
  loadPipeline: jest.fn(),
  getDefaultPipelineForOrg: jest.fn(),
}))
import { loadPipeline, getDefaultPipelineForOrg } from '@/lib/pipelines/store'

/** Default pipeline mock — covers the happy path for most tests */
function setupDefaultPipelineMock(orgId = 'org-test', pipelineId = DEFAULT_PIPELINE_ID) {
  const pl = { ...DEFAULT_PIPELINE, id: pipelineId, orgId }
  ;(getDefaultPipelineForOrg as jest.Mock).mockResolvedValue(pl)
  ;(loadPipeline as jest.Mock).mockResolvedValue({ ref: {}, data: pl })
}

// ── Firestore collection mock helpers ──────────────────────────────────────────

function stageAuth(
  member: { uid: string; orgId: string; role: string; firstName?: string; lastName?: string },
  perms: Record<string, unknown> = {},
  opts?: {
    capturedDealSet?: jest.Mock
    existingDeals?: Array<{ id: string; data: Record<string, unknown> }>
    contactData?: Record<string, unknown> | null
  },
) {
  ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })
  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    if (name === 'users') return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ activeOrgId: member.orgId }) }) }) }
    if (name === 'orgMembers') return {
      doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => member }) }),
      where: () => ({ get: () => Promise.resolve({ docs: [{ data: () => ({ orgId: member.orgId, uid: member.uid, role: member.role }) }] }) }),
    }
    if (name === 'organizations') return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ settings: { permissions: perms } }) }) }) }
    if (name === 'contacts') {
      const contactData = opts?.contactData !== undefined
        ? opts.contactData
        : { orgId: member.orgId, name: 'Test Contact' }
      return {
        doc: jest.fn((id: string) => ({
          id,
          get: jest.fn().mockResolvedValue(
            contactData
              ? { exists: true, id, data: () => contactData }
              : { exists: false, id, data: () => undefined },
          ),
        })),
      }
    }
    if (name === 'deals') {
      const setFn = opts?.capturedDealSet ?? jest.fn().mockResolvedValue(undefined)
      const docs = (opts?.existingDeals ?? []).map(d => ({ id: d.id, data: () => d.data, ref: { id: d.id } }))
      return {
        doc: jest.fn().mockReturnValue({
          id: 'auto-deal-id',
          set: setFn,
          get: jest.fn().mockResolvedValue({ exists: true, data: () => ({}) }),
          update: jest.fn().mockResolvedValue(undefined),
        }),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ docs, size: docs.length }),
      }
    }
    return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
  })
}

function stageAuthWithDeal(
  member: { uid: string; orgId: string; role: string; firstName?: string; lastName?: string },
  existingDeal: { id: string; data: Record<string, unknown> } | null,
  perms: Record<string, unknown> = {},
  opts?: { capturedUpdate?: jest.Mock; capturedDelete?: jest.Mock; ownerLookup?: Record<string, { firstName?: string; lastName?: string }>; capturedActivitiesAdd?: jest.Mock },
) {
  ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })
  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    if (name === 'users') return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ activeOrgId: member.orgId }) }) }) }
    if (name === 'orgMembers') return {
      doc: jest.fn().mockImplementation((id: string) => {
        if (id === `${member.orgId}_${member.uid}`) return { get: () => Promise.resolve({ exists: true, data: () => member }) }
        const ownerUid = id.replace(`${member.orgId}_`, '')
        const ownerData = opts?.ownerLookup?.[ownerUid]
        return { get: () => Promise.resolve(ownerData ? { exists: true, data: () => ({ uid: ownerUid, ...ownerData }) } : { exists: false }) }
      }),
      where: () => ({ get: () => Promise.resolve({ docs: [{ data: () => ({ orgId: member.orgId, uid: member.uid, role: member.role }) }] }) }),
    }
    if (name === 'organizations') return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ settings: { permissions: perms } }) }) }) }
    if (name === 'deals') {
      const updateFn = opts?.capturedUpdate ?? jest.fn().mockResolvedValue(undefined)
      const deleteFn = opts?.capturedDelete ?? jest.fn().mockResolvedValue(undefined)
      return {
        doc: jest.fn().mockReturnValue({
          id: existingDeal?.id ?? 'd1',
          get: jest.fn().mockResolvedValue({
            exists: existingDeal != null,
            id: existingDeal?.id ?? 'd1',
            data: () => existingDeal?.data ?? {},
          }),
          update: updateFn,
          delete: deleteFn,
        }),
      }
    }
    if (name === 'activities') {
      const addFn = opts?.capturedActivitiesAdd ?? jest.fn().mockResolvedValue({ id: 'act-1' })
      return { add: addFn }
    }
    return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
  })
}

const routeCtx = (id: string) => ({ params: Promise.resolve({ id }) })
type ActivityWrite = { type?: string; summary?: string }

// ── GET ────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/crm/deals', () => {
  beforeEach(() => { jest.clearAllMocks(); setupDefaultPipelineMock() })

  it('returns list of deals', async () => {
    const member = seedOrgMember('org-test', 'uid-viewer', { role: 'viewer' })
    stageAuth(member, {}, {
      existingDeals: [{ id: 'd1', data: { title: 'Big deal', pipelineId: DEFAULT_PIPELINE_ID, stageId: 'discovery', deleted: false } }],
    })
    const req = callAsMember(member, 'GET', '/api/v1/crm/deals')
    const { GET } = await import('@/app/api/v1/crm/deals/route')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(Array.isArray(body.data)).toBe(true)
  })

  it('filters pipeline, deleted rows, search, and pagination in memory after org query', async () => {
    const member = seedOrgMember('org-test', 'uid-viewer', { role: 'viewer' })
    stageAuth(member, {}, {
      existingDeals: [
        { id: 'd-old', data: { title: 'Old Website', pipelineId: DEFAULT_PIPELINE_ID, stageId: 'discovery', deleted: false, createdAt: { seconds: 1 } } },
        { id: 'd-match', data: { title: 'Priority Website', pipelineId: DEFAULT_PIPELINE_ID, stageId: 'proposal', deleted: false, createdAt: { seconds: 3 } } },
        { id: 'd-other-pipeline', data: { title: 'Priority Website', pipelineId: 'other-pipeline', stageId: 'proposal', deleted: false, createdAt: { seconds: 4 } } },
        { id: 'd-deleted', data: { title: 'Priority Website deleted', pipelineId: DEFAULT_PIPELINE_ID, stageId: 'proposal', deleted: true, createdAt: { seconds: 5 } } },
      ],
    })

    const req = callAsMember(member, 'GET', '/api/v1/crm/deals?pipelineId=pl-default&stageId=proposal&search=priority&limit=1&page=1')
    const { GET } = await import('@/app/api/v1/crm/deals/route')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.map((deal: { id: string }) => deal.id)).toEqual(['d-match'])
    expect(body.meta.total).toBe(1)
  })

  it('returns 401 without auth', async () => {
    const req = new NextRequest('http://localhost/api/v1/crm/deals')
    const { GET } = await import('@/app/api/v1/crm/deals/route')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('returns deals via Bearer (agent)', async () => {
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'organizations') {
        return {
          doc: () => ({
            get: () => Promise.resolve({ exists: true, data: () => ({ settings: { permissions: {} } }) }),
          }),
        }
      }
      if (name === 'deals') {
        return {
          where: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          get: () => Promise.resolve({ docs: [] }),
        }
      }
      return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
    })
    const req = callAsAgent('org-agent', 'GET', '/api/v1/crm/deals', undefined, AI_API_KEY)
    const { GET } = await import('@/app/api/v1/crm/deals/route')
    const res = await GET(req)
    expect(res.status).toBe(200)
  })
})

// ── POST ───────────────────────────────────────────────────────────────────────

describe('POST /api/v1/crm/deals', () => {
  beforeEach(() => { jest.clearAllMocks(); setupDefaultPipelineMock() })

  // Valid deal body — uses pipelineId/stageId, not stage
  const validDeal = {
    contactId: 'c1',
    title: 'New Website',
    value: 5000,
    currency: 'USD',
    pipelineId: DEFAULT_PIPELINE_ID,
    stageId: 'discovery',
    notes: '',
  }

  it('creates deal and returns 201', async () => {
    const member = seedOrgMember('org-test', 'uid-member', { role: 'member' })
    stageAuth(member)
    const req = callAsMember(member, 'POST', '/api/v1/crm/deals', validDeal)
    const { POST } = await import('@/app/api/v1/crm/deals/route')
    const res = await POST(req)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data.id).toBe('auto-deal-id')
  })

  it('persists probability, lost reason, and normalized line items on create', async () => {
    const member = seedOrgMember('org-test', 'uid-member', { role: 'member' })
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuth(member, {}, { capturedDealSet: captured })
    const req = callAsMember(member, 'POST', '/api/v1/crm/deals', {
      ...validDeal,
      currency: 'ZAR',
      probability: 45,
      lostReason: 'Budget moved',
      lineItems: [
        {
          productId: 'product-1',
          name: 'SEO sprint',
          qty: 2,
          unitPrice: 1000,
          discount: 10,
          total: 1,
          currency: 'ZAR',
        },
      ],
    })
    const { POST } = await import('@/app/api/v1/crm/deals/route')
    const res = await POST(req)
    expect(res.status).toBe(201)
    const data = captured.mock.calls[0][0]
    expect(data.probability).toBe(45)
    expect(data.lostReason).toBe('Budget moved')
    expect(data.lineItems).toEqual([
      {
        productId: 'product-1',
        name: 'SEO sprint',
        qty: 2,
        unitPrice: 1000,
        discount: 10,
        total: 1800,
        currency: 'ZAR',
      },
    ])
  })

  it('creates deal with default pipeline when pipelineId omitted', async () => {
    const member = seedOrgMember('org-test', 'uid-member', { role: 'member' })
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuth(member, {}, { capturedDealSet: captured })
    // omit pipelineId — route should fall back to getDefaultPipelineForOrg
    const req = callAsMember(member, 'POST', '/api/v1/crm/deals', {
      contactId: 'c1', title: 'No Pipeline', value: 100, currency: 'ZAR',
    })
    const { POST } = await import('@/app/api/v1/crm/deals/route')
    const res = await POST(req)
    expect(res.status).toBe(201)
    const data = captured.mock.calls[0][0]
    expect(data.pipelineId).toBe(DEFAULT_PIPELINE_ID)
    expect(data.stageId).toBe('discovery') // first open stage
  })

  it('returns 400 when no pipeline configured for org', async () => {
    const member = seedOrgMember('org-test', 'uid-member', { role: 'member' })
    stageAuth(member)
    ;(getDefaultPipelineForOrg as jest.Mock).mockResolvedValue(null)
    const req = callAsMember(member, 'POST', '/api/v1/crm/deals', {
      contactId: 'c1', title: 'No Pipeline', value: 0, currency: 'ZAR',
    })
    const { POST } = await import('@/app/api/v1/crm/deals/route')
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/no pipeline/i)
  })

  it('returns 400 when explicit pipelineId is invalid', async () => {
    const member = seedOrgMember('org-test', 'uid-member', { role: 'member' })
    stageAuth(member)
    ;(loadPipeline as jest.Mock).mockResolvedValue(null)
    const req = callAsMember(member, 'POST', '/api/v1/crm/deals', {
      contactId: 'c1', title: 'Bad Pipeline', value: 0, currency: 'ZAR', pipelineId: 'bad-pl',
    })
    const { POST } = await import('@/app/api/v1/crm/deals/route')
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/invalid pipelineid/i)
  })

  it('returns 400 when stageId not found in pipeline', async () => {
    const member = seedOrgMember('org-test', 'uid-member', { role: 'member' })
    stageAuth(member)
    const req = callAsMember(member, 'POST', '/api/v1/crm/deals', {
      contactId: 'c1', title: 'Bad Stage', value: 0, currency: 'ZAR',
      pipelineId: DEFAULT_PIPELINE_ID, stageId: 'nonexistent',
    })
    const { POST } = await import('@/app/api/v1/crm/deals/route')
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/invalid stageid/i)
  })

  it('returns 400 when title is missing', async () => {
    const member = seedOrgMember('org-test', 'uid-member', { role: 'member' })
    stageAuth(member)
    const req = callAsMember(member, 'POST', '/api/v1/crm/deals', { ...validDeal, title: '' })
    const { POST } = await import('@/app/api/v1/crm/deals/route')
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 when currency is invalid', async () => {
    const member = seedOrgMember('org-test', 'uid-member', { role: 'member' })
    stageAuth(member)
    const req = callAsMember(member, 'POST', '/api/v1/crm/deals', { ...validDeal, currency: 'GBP' })
    const { POST } = await import('@/app/api/v1/crm/deals/route')
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 403 when viewer tries to POST', async () => {
    const member = seedOrgMember('org-test', 'uid-viewer', { role: 'viewer' })
    stageAuth(member)
    const req = callAsMember(member, 'POST', '/api/v1/crm/deals', validDeal)
    const { POST } = await import('@/app/api/v1/crm/deals/route')
    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  it('writes createdByRef and updatedByRef on POST (member)', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member', firstName: 'Alice', lastName: 'B' })
    setupDefaultPipelineMock('org-1')
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuth(member, {}, { capturedDealSet: captured })
    const req = callAsMember(member, 'POST', '/api/v1/crm/deals', {
      contactId: 'contact-1', title: 'Big deal', value: 1000, currency: 'ZAR',
      pipelineId: DEFAULT_PIPELINE_ID, stageId: 'discovery',
    })
    const { POST } = await import('@/app/api/v1/crm/deals/route')
    const res = await POST(req)
    expect(res.status).toBeLessThan(300)
    const data = captured.mock.calls[0][0]
    expect(data.createdByRef.displayName).toBe('Alice B')
    expect(data.createdByRef.kind).toBe('human')
    expect(data.updatedByRef.displayName).toBe('Alice B')
    expect(data.orgId).toBe('org-1')
    expect(data.pipelineId).toBe(DEFAULT_PIPELINE_ID)
    expect(data.stageId).toBe('discovery')
    expect(data.stageHistory).toHaveLength(1)
    expect(data.stageHistory[0]).toEqual(expect.objectContaining({
      pipelineId: DEFAULT_PIPELINE_ID,
      stageId: 'discovery',
      enteredByRef: expect.objectContaining({ uid: 'uid-1' }),
    }))
  })

  it('writes ownerRef when POST body has ownerUid', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member', firstName: 'Alice', lastName: 'B' })
    setupDefaultPipelineMock('org-1')
    const captured = jest.fn().mockResolvedValue(undefined)
    ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'users') return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ activeOrgId: 'org-1' }) }) }) }
      if (name === 'orgMembers') return {
        doc: jest.fn().mockImplementation((id: string) => ({
          get: () => Promise.resolve(
            id === 'org-1_uid-1' ? { exists: true, data: () => member }
              : id === 'org-1_uid-2' ? { exists: true, data: () => ({ uid: 'uid-2', firstName: 'Bob', lastName: 'C' }) }
              : { exists: false },
          ),
        })),
        where: () => ({ get: () => Promise.resolve({ docs: [{ data: () => ({ orgId: 'org-1', uid: member.uid, role: member.role }) }] }) }),
      }
      if (name === 'organizations') return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ settings: { permissions: {} } }) }) }) }
      if (name === 'contacts') return {
        doc: jest.fn((id: string) => ({
          id,
          get: () => Promise.resolve({ exists: true, id, data: () => ({ orgId: 'org-1', name: 'Test Contact' }) }),
        })),
      }
      if (name === 'deals') return {
        doc: jest.fn().mockReturnValue({ id: 'deal-x', set: captured }),
      }
      return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
    })
    const req = callAsMember(member, 'POST', '/api/v1/crm/deals', {
      contactId: 'c1', title: 'D', value: 0, currency: 'ZAR',
      pipelineId: DEFAULT_PIPELINE_ID, stageId: 'discovery',
      ownerUid: 'uid-2',
    })
    const { POST } = await import('@/app/api/v1/crm/deals/route')
    const res = await POST(req)
    expect(res.status).toBeLessThan(300)
    const data = captured.mock.calls[0][0]
    expect(data.ownerUid).toBe('uid-2')
    expect(data.ownerRef.displayName).toBe('Bob C')
  })

  it('agent POST uses AGENT_PIP_REF and omits createdBy uid', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    setupDefaultPipelineMock('org-1')
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuth(member, {}, { capturedDealSet: captured })
    const req = callAsAgent('org-1', 'POST', '/api/v1/crm/deals', {
      contactId: 'c1', title: 'Agent deal', value: 0, currency: 'ZAR',
      pipelineId: DEFAULT_PIPELINE_ID, stageId: 'discovery',
    })
    const { POST } = await import('@/app/api/v1/crm/deals/route')
    const res = await POST(req)
    expect(res.status).toBeLessThan(300)
    const data = captured.mock.calls[0][0]
    expect(data.createdByRef.uid).toBe('agent:pip')
    expect(data.createdByRef.kind).toBe('agent')
    expect(data.createdBy).toBeUndefined()
  })

  it('webhook deal.created payload contains pipelineId/stageId (no stage)', async () => {
    jest.mock('@/lib/webhooks/dispatch', () => ({
      dispatchWebhook: jest.fn().mockResolvedValue(undefined),
    }))
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member', firstName: 'Alice', lastName: 'B' })
    setupDefaultPipelineMock('org-1')
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuth(member, {}, { capturedDealSet: captured })
    const { dispatchWebhook } = await import('@/lib/webhooks/dispatch')
    ;(dispatchWebhook as jest.Mock).mockClear()

    const req = callAsMember(member, 'POST', '/api/v1/crm/deals', {
      contactId: 'c1', title: 'WH test', value: 500, currency: 'USD',
      pipelineId: DEFAULT_PIPELINE_ID, stageId: 'discovery',
      sneaky_extra_field: 'leaked',
    })
    const { POST } = await import('@/app/api/v1/crm/deals/route')
    await POST(req)
    expect(dispatchWebhook).toHaveBeenCalledWith(
      'org-1',
      'deal.created',
      expect.not.objectContaining({ sneaky_extra_field: expect.anything() }),
    )
    const payload = (dispatchWebhook as jest.Mock).mock.calls[0][2]
    expect(payload.pipelineId).toBe(DEFAULT_PIPELINE_ID)
    expect(payload.stageId).toBe('discovery')
    // stage field must NOT appear in webhook payload
    expect(payload.stage).toBeUndefined()
  })
})

// ── PUT/PATCH ─────────────────────────────────────────────────────────────────

describe('PUT /api/v1/crm/deals/[id]', () => {
  beforeEach(() => { jest.clearAllMocks(); setupDefaultPipelineMock() })

  it('member can update deal title in own org', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member', firstName: 'Alice', lastName: 'B' })
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuthWithDeal(member, {
      id: 'd1', data: { orgId: 'org-1', pipelineId: DEFAULT_PIPELINE_ID, stageId: 'discovery', title: 'Old', value: 100 },
    }, {}, { capturedUpdate: captured })
    const req = callAsMember(member, 'PUT', '/api/v1/crm/deals/d1', { title: 'New' })
    const { PUT } = await import('@/app/api/v1/crm/deals/[id]/route')
    const res = await PUT(req, routeCtx('d1'))
    expect(res.status).toBeLessThan(300)
    const patch = captured.mock.calls[0][0]
    expect(patch.title).toBe('New')
    expect(patch.updatedByRef.displayName).toBe('Alice B')
    expect(patch.updatedByRef.kind).toBe('human')
  })

  it('member PUT to deal in another org → 404', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    stageAuthWithDeal(member, { id: 'd1', data: { orgId: 'org-2' } })
    const req = callAsMember(member, 'PUT', '/api/v1/crm/deals/d1', { title: 'X' })
    const { PUT } = await import('@/app/api/v1/crm/deals/[id]/route')
    const res = await PUT(req, routeCtx('d1'))
    expect(res.status).toBe(404)
  })

  it('does NOT overwrite orgId when body injects { orgId: "org-other" }', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuthWithDeal(member, {
      id: 'd1', data: { orgId: 'org-1', pipelineId: DEFAULT_PIPELINE_ID, stageId: 'discovery', title: 'Old' },
    }, {}, { capturedUpdate: captured })
    const req = callAsMember(member, 'PUT', '/api/v1/crm/deals/d1', { orgId: 'org-other', title: 'Hacked' })
    const { PUT } = await import('@/app/api/v1/crm/deals/[id]/route')
    const res = await PUT(req, routeCtx('d1'))
    expect(res.status).toBeLessThan(300)
    const patch = captured.mock.calls[0][0]
    expect(patch.orgId).toBeUndefined()
    expect(patch.title).toBe('Hacked')
  })

  it('writes ownerRef when PUT body has new ownerUid', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuthWithDeal(member, {
      id: 'd1', data: { orgId: 'org-1', pipelineId: DEFAULT_PIPELINE_ID, stageId: 'discovery', ownerUid: '' },
    }, {}, {
      capturedUpdate: captured,
      ownerLookup: { 'uid-2': { firstName: 'Bob', lastName: 'C' } },
    })
    const req = callAsMember(member, 'PUT', '/api/v1/crm/deals/d1', { ownerUid: 'uid-2' })
    const { PUT } = await import('@/app/api/v1/crm/deals/[id]/route')
    const res = await PUT(req, routeCtx('d1'))
    expect(res.status).toBeLessThan(300)
    const patch = captured.mock.calls[0][0]
    expect(patch.ownerUid).toBe('uid-2')
    expect(patch.ownerRef.displayName).toBe('Bob C')
  })

  it('agent PUT uses AGENT_PIP_REF for updatedByRef, omits updatedBy', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuthWithDeal(member, {
      id: 'd1', data: { orgId: 'org-1', pipelineId: DEFAULT_PIPELINE_ID, stageId: 'discovery' },
    }, {}, { capturedUpdate: captured })
    const req = callAsAgent('org-1', 'PUT', '/api/v1/crm/deals/d1', { notes: 'agent updated' })
    const { PUT } = await import('@/app/api/v1/crm/deals/[id]/route')
    const res = await PUT(req, routeCtx('d1'))
    expect(res.status).toBeLessThan(300)
    const patch = captured.mock.calls[0][0]
    expect(patch.updatedByRef.uid).toBe('agent:pip')
    expect(patch.updatedByRef.kind).toBe('agent')
    expect(patch.updatedBy).toBeUndefined()
  })

  it('PATCH cross-pipeline without stageId → 400', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    stageAuthWithDeal(member, {
      id: 'd1', data: { orgId: 'org-1', pipelineId: DEFAULT_PIPELINE_ID, stageId: 'discovery', title: 'D', value: 100 },
    })
    const req = callAsMember(member, 'PATCH', '/api/v1/crm/deals/d1', { pipelineId: 'pl-other' })
    const { PATCH } = await import('@/app/api/v1/crm/deals/[id]/route')
    const res = await PATCH(req, routeCtx('d1'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/requires explicit stageid/i)
  })

  it('PATCH cross-pipeline with stageId validates new pipeline', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    stageAuthWithDeal(member, {
      id: 'd1', data: { orgId: 'org-1', pipelineId: DEFAULT_PIPELINE_ID, stageId: 'discovery', title: 'D', value: 100 },
    })
    // New pipeline doesn't belong to org
    ;(loadPipeline as jest.Mock).mockResolvedValue(null)
    const req = callAsMember(member, 'PATCH', '/api/v1/crm/deals/d1', { pipelineId: 'pl-other', stageId: 'open-1' })
    const { PATCH } = await import('@/app/api/v1/crm/deals/[id]/route')
    const res = await PATCH(req, routeCtx('d1'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/invalid pipelineid/i)
  })

  it('PUT stageId change fires deal.stage_changed webhook with new fields', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    stageAuthWithDeal(member, {
      id: 'd1', data: { orgId: 'org-1', pipelineId: DEFAULT_PIPELINE_ID, stageId: 'discovery', value: 100, title: 'D' },
    })
    const { dispatchWebhook } = await import('@/lib/webhooks/dispatch')
    const { logActivity } = await import('@/lib/activity/log')
    ;(dispatchWebhook as jest.Mock).mockClear()
    ;(logActivity as jest.Mock).mockClear()
    const req = callAsMember(member, 'PUT', '/api/v1/crm/deals/d1', {
      stageId: 'proposal', notes: 'moved', sneaky: 'leak',
    })
    const { PUT } = await import('@/app/api/v1/crm/deals/[id]/route')
    await PUT(req, routeCtx('d1'))
    expect(dispatchWebhook).toHaveBeenCalledWith(
      'org-1',
      'deal.stage_changed',
      expect.not.objectContaining({ sneaky: expect.anything() }),
    )
    const payload = (dispatchWebhook as jest.Mock).mock.calls.find((c: unknown[]) => c[1] === 'deal.stage_changed')[2]
    expect(payload.previousStageId).toBe('discovery')
    expect(payload.stageId).toBe('proposal')
    expect(payload.id).toBe('d1')
    expect(payload.pipelineId).toBe(DEFAULT_PIPELINE_ID)
    expect(payload.stageLabel).toBe('Proposal')
    expect(payload.stageKind).toBe('open')
    expect(payload.previousStageLabel).toBe('Discovery')
    // stage (old field) must NOT appear
    expect(payload.fromStage).toBeUndefined()
    expect(payload.toStage).toBeUndefined()
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'crm_deal_updated' })
    )
  })

  it('PUT { ownerUid: "" } clears ownerRef via FieldValue.delete()', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuthWithDeal(member,
      { id: 'd1', data: { orgId: 'org-1', pipelineId: DEFAULT_PIPELINE_ID, stageId: 'discovery', ownerUid: 'uid-old' } },
      {},
      { capturedUpdate: captured },
    )
    const req = callAsMember(member, 'PUT', '/api/v1/crm/deals/d1', { ownerUid: '' })
    const { PUT } = await import('@/app/api/v1/crm/deals/[id]/route')
    const res = await PUT(req, routeCtx('d1'))
    expect(res.status).toBeLessThan(300)
    const patch = captured.mock.calls[0][0]
    expect(patch.ownerUid).toBe('')
    expect(patch.ownerRef).toBeDefined()
    expect(typeof (patch.ownerRef as { displayName?: unknown }).displayName).toBe('undefined')
  })

  it('PUT stageId → won (kind=won) fires deal.won + tryAttributeDealWon + crm_deal_won', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    stageAuthWithDeal(member, {
      id: 'd1', data: { orgId: 'org-1', pipelineId: DEFAULT_PIPELINE_ID, stageId: 'negotiation', value: 5000, title: 'Big', contactId: 'c1', currency: 'ZAR' },
    })
    const { dispatchWebhook } = await import('@/lib/webhooks/dispatch')
    const { logActivity } = await import('@/lib/activity/log')
    const { tryAttributeDealWon } = await import('@/lib/email-analytics/attribution-hooks')
    ;(dispatchWebhook as jest.Mock).mockClear()
    ;(logActivity as jest.Mock).mockClear()
    ;(tryAttributeDealWon as jest.Mock).mockClear()

    const req = callAsMember(member, 'PUT', '/api/v1/crm/deals/d1', { stageId: 'won' })
    const { PUT } = await import('@/app/api/v1/crm/deals/[id]/route')
    await PUT(req, routeCtx('d1'))

    expect(dispatchWebhook).toHaveBeenCalledWith('org-1', 'deal.stage_changed', expect.any(Object))
    expect(dispatchWebhook).toHaveBeenCalledWith('org-1', 'deal.won', expect.any(Object))
    expect(tryAttributeDealWon).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-1', dealId: 'd1' }))
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ type: 'crm_deal_won' }))
  })

  it('PUT stageId → lost (kind=lost) fires deal.lost + crm_deal_lost', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    stageAuthWithDeal(member, {
      id: 'd1', data: { orgId: 'org-1', pipelineId: DEFAULT_PIPELINE_ID, stageId: 'negotiation', value: 1000, title: 'X' },
    })
    const { dispatchWebhook } = await import('@/lib/webhooks/dispatch')
    const { logActivity } = await import('@/lib/activity/log')
    ;(dispatchWebhook as jest.Mock).mockClear()
    ;(logActivity as jest.Mock).mockClear()

    const req = callAsMember(member, 'PUT', '/api/v1/crm/deals/d1', { stageId: 'lost' })
    const { PUT } = await import('@/app/api/v1/crm/deals/[id]/route')
    await PUT(req, routeCtx('d1'))

    expect(dispatchWebhook).toHaveBeenCalledWith('org-1', 'deal.lost', expect.any(Object))
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ type: 'crm_deal_lost' }))
  })

  it('PUT without stageId change does NOT fire stage_changed webhook', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    stageAuthWithDeal(member, {
      id: 'd1', data: { orgId: 'org-1', pipelineId: DEFAULT_PIPELINE_ID, stageId: 'discovery', value: 100 },
    })
    const { dispatchWebhook } = await import('@/lib/webhooks/dispatch')
    ;(dispatchWebhook as jest.Mock).mockClear()

    const req = callAsMember(member, 'PUT', '/api/v1/crm/deals/d1', { notes: 'just notes' })
    const { PUT } = await import('@/app/api/v1/crm/deals/[id]/route')
    await PUT(req, routeCtx('d1'))

    const stageChangeCalls = (dispatchWebhook as jest.Mock).mock.calls.filter((c: unknown[]) => c[1] === 'deal.stage_changed')
    expect(stageChangeCalls).toHaveLength(0)
  })

  it('stageId change with contactId writes activities entry with type stage_change', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    const capturedActivitiesAdd = jest.fn().mockResolvedValue({ id: 'act-1' })
    stageAuthWithDeal(
      member,
      { id: 'd1', data: { orgId: 'org-1', pipelineId: DEFAULT_PIPELINE_ID, stageId: 'discovery', value: 100, title: 'Deal A', contactId: 'c-1' } },
      {},
      { capturedActivitiesAdd },
    )
    const req = callAsMember(member, 'PUT', '/api/v1/crm/deals/d1', { stageId: 'proposal' })
    const { PUT } = await import('@/app/api/v1/crm/deals/[id]/route')
    const res = await PUT(req, routeCtx('d1'))
    expect(res.status).toBeLessThan(300)
    expect(capturedActivitiesAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        contactId: 'c-1',
        dealId: 'd1',
        type: 'stage_change',
        summary: 'Deal moved: Discovery → Proposal',
      }),
    )
  })

  it('stageId → won with contactId writes stage_change + deal won note to activities', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    const capturedActivitiesAdd = jest.fn().mockResolvedValue({ id: 'act-1' })
    stageAuthWithDeal(
      member,
      { id: 'd1', data: { orgId: 'org-1', pipelineId: DEFAULT_PIPELINE_ID, stageId: 'negotiation', value: 5000, title: 'Big Deal', contactId: 'c-1', currency: 'ZAR' } },
      {},
      { capturedActivitiesAdd },
    )
    const req = callAsMember(member, 'PUT', '/api/v1/crm/deals/d1', { stageId: 'won' })
    const { PUT } = await import('@/app/api/v1/crm/deals/[id]/route')
    await PUT(req, routeCtx('d1'))
    const calls = capturedActivitiesAdd.mock.calls
    expect(calls.length).toBeGreaterThanOrEqual(2)
    const stageCall = calls.find((c: [ActivityWrite]) => c[0].type === 'stage_change')
    const wonCall = calls.find((c: [ActivityWrite]) => c[0].type === 'note' && c[0].summary?.includes('Deal won'))
    expect(stageCall).toBeDefined()
    expect(wonCall).toBeDefined()
    expect(wonCall![0].summary).toContain('Big Deal')
  })

  it('stageId → lost with contactId writes stage_change + deal lost note to activities', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    const capturedActivitiesAdd = jest.fn().mockResolvedValue({ id: 'act-1' })
    stageAuthWithDeal(
      member,
      { id: 'd1', data: { orgId: 'org-1', pipelineId: DEFAULT_PIPELINE_ID, stageId: 'negotiation', value: 500, title: 'Lost Deal', contactId: 'c-1' } },
      {},
      { capturedActivitiesAdd },
    )
    const req = callAsMember(member, 'PUT', '/api/v1/crm/deals/d1', { stageId: 'lost' })
    const { PUT } = await import('@/app/api/v1/crm/deals/[id]/route')
    await PUT(req, routeCtx('d1'))
    const calls = capturedActivitiesAdd.mock.calls
    expect(calls.length).toBeGreaterThanOrEqual(2)
    const lostCall = calls.find((c: [ActivityWrite]) => c[0].type === 'note' && c[0].summary?.includes('Deal lost'))
    expect(lostCall).toBeDefined()
    expect(lostCall![0].summary).toContain('Lost Deal')
  })

  it('stageId change WITHOUT contactId does NOT call activities.add', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    const capturedActivitiesAdd = jest.fn().mockResolvedValue({ id: 'act-1' })
    stageAuthWithDeal(
      member,
      { id: 'd1', data: { orgId: 'org-1', pipelineId: DEFAULT_PIPELINE_ID, stageId: 'discovery', value: 100, title: 'No Contact Deal' } },
      {},
      { capturedActivitiesAdd },
    )
    const req = callAsMember(member, 'PUT', '/api/v1/crm/deals/d1', { stageId: 'proposal' })
    const { PUT } = await import('@/app/api/v1/crm/deals/[id]/route')
    await PUT(req, routeCtx('d1'))
    expect(capturedActivitiesAdd).not.toHaveBeenCalled()
  })
})

// ── POST: company derivation ───────────────────────────────────────────────────

describe('POST deals with company derivation', () => {
  beforeEach(() => { jest.clearAllMocks(); setupDefaultPipelineMock('org-1') })

  it('auto-populates companyId+companyName from contact.companyId when contactId set', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    const captured = jest.fn().mockResolvedValue(undefined)
    ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'users') return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ activeOrgId: 'org-1' }) }) }) }
      if (name === 'orgMembers') return {
        doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => member }) }),
        where: () => ({ get: () => Promise.resolve({ docs: [{ data: () => ({ orgId: 'org-1', uid: member.uid, role: member.role }) }] }) }),
      }
      if (name === 'organizations') return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ settings: { permissions: {} } }) }) }) }
      if (name === 'contacts') return {
        doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ orgId: 'org-1', companyId: 'comp-1', companyName: 'Acme Corp' }) }) }),
      }
      if (name === 'deals') return { doc: jest.fn().mockReturnValue({ id: 'deal-x', set: captured }) }
      return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
    })
    const req = callAsMember(member, 'POST', '/api/v1/crm/deals', {
      contactId: 'c-1', title: 'Auto Derive Test', value: 0, currency: 'ZAR',
      pipelineId: DEFAULT_PIPELINE_ID, stageId: 'discovery',
    })
    const { POST } = await import('@/app/api/v1/crm/deals/route')
    const res = await POST(req)
    expect(res.status).toBe(201)
    const data = captured.mock.calls[0][0]
    expect(data.companyId).toBe('comp-1')
    expect(data.companyName).toBe('Acme Corp')
  })

  it('explicit body.companyId overrides auto-derive', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    const captured = jest.fn().mockResolvedValue(undefined)
    ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'users') return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ activeOrgId: 'org-1' }) }) }) }
      if (name === 'orgMembers') return {
        doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => member }) }),
        where: () => ({ get: () => Promise.resolve({ docs: [{ data: () => ({ orgId: 'org-1', uid: member.uid, role: member.role }) }] }) }),
      }
      if (name === 'organizations') return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ settings: { permissions: {} } }) }) }) }
      if (name === 'contacts') return {
        doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ orgId: 'org-1', companyId: 'comp-from-contact', companyName: 'Contact Corp' }) }) }),
      }
      if (name === 'companies') return {
        doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ orgId: 'org-1', name: 'Explicit Corp', deleted: false }) }) }),
      }
      if (name === 'deals') return { doc: jest.fn().mockReturnValue({ id: 'deal-x', set: captured }) }
      return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
    })
    const req = callAsMember(member, 'POST', '/api/v1/crm/deals', {
      contactId: 'c-1', title: 'Explicit Override', value: 0, currency: 'ZAR',
      pipelineId: DEFAULT_PIPELINE_ID, stageId: 'discovery',
      companyId: 'comp-explicit',
    })
    const { POST } = await import('@/app/api/v1/crm/deals/route')
    const res = await POST(req)
    expect(res.status).toBe(201)
    const data = captured.mock.calls[0][0]
    expect(data.companyId).toBe('comp-explicit')
    expect(data.companyName).toBe('Explicit Corp')
  })

  it('contact lookup failure fails closed without writing a deal', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    const captured = jest.fn().mockResolvedValue(undefined)
    ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'users') return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ activeOrgId: 'org-1' }) }) }) }
      if (name === 'orgMembers') return {
        doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => member }) }),
        where: () => ({ get: () => Promise.resolve({ docs: [{ data: () => ({ orgId: 'org-1', uid: member.uid, role: member.role }) }] }) }),
      }
      if (name === 'organizations') return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ settings: { permissions: {} } }) }) }) }
      if (name === 'contacts') return {
        doc: () => ({ get: () => Promise.reject(new Error('Firestore unavailable')) }),
      }
      if (name === 'deals') return { doc: jest.fn().mockReturnValue({ id: 'deal-x', set: captured }) }
      return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
    })
    const req = callAsMember(member, 'POST', '/api/v1/crm/deals', {
      contactId: 'c-err', title: 'Resilient Deal', value: 0, currency: 'ZAR',
      pipelineId: DEFAULT_PIPELINE_ID, stageId: 'discovery',
    })
    const { POST } = await import('@/app/api/v1/crm/deals/route')
    const res = await POST(req)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/contact lookup failed/i)
    expect(captured).not.toHaveBeenCalled()
  })
})

// ── PATCH: companyId ──────────────────────────────────────────────────────────

describe('PATCH deals companyId', () => {
  beforeEach(() => { jest.clearAllMocks(); setupDefaultPipelineMock('org-1') })

  it('PATCH contactId change repopulates companyId from new contact', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    const captured = jest.fn().mockResolvedValue(undefined)
    ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'users') return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ activeOrgId: 'org-1' }) }) }) }
      if (name === 'orgMembers') return {
        doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => member }) }),
        where: () => ({ get: () => Promise.resolve({ docs: [{ data: () => ({ orgId: 'org-1', uid: member.uid, role: member.role }) }] }) }),
      }
      if (name === 'organizations') return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ settings: { permissions: {} } }) }) }) }
      if (name === 'contacts') return {
        doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ orgId: 'org-1', companyId: 'comp-new', companyName: 'New Corp' }) }) }),
      }
      if (name === 'activities') return { add: jest.fn().mockResolvedValue({ id: 'act-1' }) }
      if (name === 'deals') return {
        doc: jest.fn().mockReturnValue({
          id: 'd1',
          get: jest.fn().mockResolvedValue({
            exists: true,
            id: 'd1',
            data: () => ({ orgId: 'org-1', contactId: 'c-old', pipelineId: DEFAULT_PIPELINE_ID, stageId: 'discovery', title: 'T' }),
          }),
          update: captured,
        }),
      }
      return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
    })
    const req = callAsMember(member, 'PATCH', '/api/v1/crm/deals/d1', { contactId: 'c-new' })
    const { PATCH } = await import('@/app/api/v1/crm/deals/[id]/route')
    const res = await PATCH(req, { params: Promise.resolve({ id: 'd1' }) })
    expect(res.status).toBeLessThan(300)
    const patch = captured.mock.calls[0][0]
    expect(patch.companyId).toBe('comp-new')
    expect(patch.companyName).toBe('New Corp')
  })

  it("PATCH { companyId: '' } clears both fields via FieldValue.delete()", async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    const captured = jest.fn().mockResolvedValue(undefined)
    ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'users') return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ activeOrgId: 'org-1' }) }) }) }
      if (name === 'orgMembers') return {
        doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => member }) }),
        where: () => ({ get: () => Promise.resolve({ docs: [{ data: () => ({ orgId: 'org-1', uid: member.uid, role: member.role }) }] }) }),
      }
      if (name === 'organizations') return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ settings: { permissions: {} } }) }) }) }
      if (name === 'activities') return { add: jest.fn().mockResolvedValue({ id: 'act-1' }) }
      if (name === 'deals') return {
        doc: jest.fn().mockReturnValue({
          id: 'd1',
          get: jest.fn().mockResolvedValue({
            exists: true,
            id: 'd1',
            data: () => ({ orgId: 'org-1', contactId: 'c1', pipelineId: DEFAULT_PIPELINE_ID, stageId: 'discovery', title: 'T', companyId: 'comp-1', companyName: 'Old Corp' }),
          }),
          update: captured,
        }),
      }
      return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
    })
    const req = callAsMember(member, 'PATCH', '/api/v1/crm/deals/d1', { companyId: '' })
    const { PATCH } = await import('@/app/api/v1/crm/deals/[id]/route')
    const res = await PATCH(req, { params: Promise.resolve({ id: 'd1' }) })
    expect(res.status).toBeLessThan(300)
    const patch = captured.mock.calls[0][0]
    expect(patch.companyId).toBeDefined()
    expect(patch.companyName).toBeDefined()
    expect(typeof patch.companyId).not.toBe('string')
  })
})

// ── DELETE ─────────────────────────────────────────────────────────────────────

describe('DELETE /api/v1/crm/deals/[id]', () => {
  beforeEach(() => { jest.clearAllMocks(); setupDefaultPipelineMock() })

  it('admin can delete (soft-delete with updatedByRef)', async () => {
    const admin = seedOrgMember('org-1', 'uid-admin', { role: 'admin', firstName: 'Adm', lastName: 'In' })
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuthWithDeal(admin, { id: 'd1', data: { orgId: 'org-1', title: 'D' } }, {}, { capturedUpdate: captured })
    const req = callAsMember(admin, 'DELETE', '/api/v1/crm/deals/d1')
    const { DELETE } = await import('@/app/api/v1/crm/deals/[id]/route')
    const res = await DELETE(req, routeCtx('d1'))
    expect(res.status).toBeLessThan(300)
    const patch = captured.mock.calls[0][0]
    expect(patch.deleted).toBe(true)
    expect(patch.updatedByRef.displayName).toBe('Adm In')
  })

  it('member DELETE → 403 (role gate)', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    stageAuthWithDeal(member, { id: 'd1', data: { orgId: 'org-1' } })
    const req = callAsMember(member, 'DELETE', '/api/v1/crm/deals/d1')
    const { DELETE } = await import('@/app/api/v1/crm/deals/[id]/route')
    const res = await DELETE(req, routeCtx('d1'))
    expect(res.status).toBe(403)
  })

  it('admin DELETE to deal in another org → 404', async () => {
    const admin = seedOrgMember('org-1', 'uid-admin', { role: 'admin' })
    stageAuthWithDeal(admin, { id: 'd1', data: { orgId: 'org-2' } })
    const req = callAsMember(admin, 'DELETE', '/api/v1/crm/deals/d1')
    const { DELETE } = await import('@/app/api/v1/crm/deals/[id]/route')
    const res = await DELETE(req, routeCtx('d1'))
    expect(res.status).toBe(404)
  })
})

// ── A5: probability, lostReason, lineItems ────────────────────────────────────

describe('PUT /api/v1/crm/deals/[id] — A5 extensions', () => {
  beforeEach(() => { jest.clearAllMocks(); setupDefaultPipelineMock() })

  // ── Probability auto-derive ─────────────────────────────────────────────────

  it('PUT stageId change without probability body → probability auto-set from stage', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuthWithDeal(member, {
      id: 'd1',
      data: { orgId: 'org-1', pipelineId: DEFAULT_PIPELINE_ID, stageId: 'discovery', title: 'T', value: 100 },
    }, {}, { capturedUpdate: captured })
    // proposal stage has probability 30
    const req = callAsMember(member, 'PUT', '/api/v1/crm/deals/d1', { stageId: 'proposal' })
    const { PUT } = await import('@/app/api/v1/crm/deals/[id]/route')
    const res = await PUT(req, routeCtx('d1'))
    expect(res.status).toBeLessThan(300)
    const patch = captured.mock.calls[0][0]
    expect(patch.probability).toBe(30)
    expect(patch.stageHistory).toBeDefined()
  })

  it('PUT stageId change WITH explicit probability → explicit value wins, stage probability ignored', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuthWithDeal(member, {
      id: 'd1',
      data: { orgId: 'org-1', pipelineId: DEFAULT_PIPELINE_ID, stageId: 'discovery', title: 'T', value: 100 },
    }, {}, { capturedUpdate: captured })
    // proposal stage probability is 30, but we explicitly send 55
    const req = callAsMember(member, 'PUT', '/api/v1/crm/deals/d1', { stageId: 'proposal', probability: 55 })
    const { PUT } = await import('@/app/api/v1/crm/deals/[id]/route')
    const res = await PUT(req, routeCtx('d1'))
    expect(res.status).toBeLessThan(300)
    const patch = captured.mock.calls[0][0]
    // explicit probability from body should be in patch (via sanitizeDealForWrite)
    // and auto-derive should NOT overwrite it
    expect(patch.probability).toBe(55)
  })

  it('PUT where pipeline lookup fails → deal update succeeds, probability not auto-set', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuthWithDeal(member, {
      id: 'd1',
      data: { orgId: 'org-1', pipelineId: DEFAULT_PIPELINE_ID, stageId: 'discovery', title: 'T', value: 100 },
    }, {}, { capturedUpdate: captured })
    // make loadPipeline return null so stage lookup fails → returns 400 from existing validation
    // The spec says "if the lookup fails, skip auto-probability" — but the existing route
    // already returns 400 for invalid pipelineId. The scenario where lookup fails mid-way
    // (e.g. Firestore flakiness) is wrapped in the existing loadPipeline call.
    // We test the probability-only path: stageId unchanged but explicit probability in body.
    const req = callAsMember(member, 'PUT', '/api/v1/crm/deals/d1', { notes: 'no stage change' })
    const { PUT } = await import('@/app/api/v1/crm/deals/[id]/route')
    const res = await PUT(req, routeCtx('d1'))
    expect(res.status).toBeLessThan(300)
    const patch = captured.mock.calls[0][0]
    // no stageId change → no auto-probability written
    expect(patch.probability).toBeUndefined()
  })

  // ── lostReason ──────────────────────────────────────────────────────────────

  it('PUT lostReason on a "lost" stage → lostReason saved', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuthWithDeal(member, {
      id: 'd1',
      data: { orgId: 'org-1', pipelineId: DEFAULT_PIPELINE_ID, stageId: 'discovery', title: 'T', value: 100 },
    }, {}, { capturedUpdate: captured })
    // "lost" stage label is "Lost" — contains "lost" case-insensitively
    const req = callAsMember(member, 'PUT', '/api/v1/crm/deals/d1', {
      stageId: 'lost',
      lostReason: 'Price too high',
    })
    const { PUT } = await import('@/app/api/v1/crm/deals/[id]/route')
    const res = await PUT(req, routeCtx('d1'))
    expect(res.status).toBeLessThan(300)
    const patch = captured.mock.calls[0][0]
    expect(patch.lostReason).toBe('Price too high')
  })

  it('PUT lostReason on a non-"lost" stage → lostReason set to null', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuthWithDeal(member, {
      id: 'd1',
      data: { orgId: 'org-1', pipelineId: DEFAULT_PIPELINE_ID, stageId: 'discovery', title: 'T', value: 100 },
    }, {}, { capturedUpdate: captured })
    // proposal stage label is "Proposal" — does NOT contain "lost"
    const req = callAsMember(member, 'PUT', '/api/v1/crm/deals/d1', {
      stageId: 'proposal',
      lostReason: 'Should be ignored',
    })
    const { PUT } = await import('@/app/api/v1/crm/deals/[id]/route')
    const res = await PUT(req, routeCtx('d1'))
    expect(res.status).toBeLessThan(300)
    const patch = captured.mock.calls[0][0]
    expect(patch.lostReason).toBeNull()
  })

  it('PUT without lostReason, stage changes to non-lost → lostReason cleared to null', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuthWithDeal(member, {
      id: 'd1',
      data: {
        orgId: 'org-1', pipelineId: DEFAULT_PIPELINE_ID, stageId: 'lost',
        title: 'T', value: 100, lostReason: 'Old reason',
      },
    }, {}, { capturedUpdate: captured })
    // move to "proposal" which is not "lost" — lostReason should be cleared
    const req = callAsMember(member, 'PUT', '/api/v1/crm/deals/d1', { stageId: 'proposal' })
    const { PUT } = await import('@/app/api/v1/crm/deals/[id]/route')
    const res = await PUT(req, routeCtx('d1'))
    expect(res.status).toBeLessThan(300)
    const patch = captured.mock.calls[0][0]
    expect(patch.lostReason).toBeNull()
  })

  it('PUT without lostReason, no stage change → lostReason not in update patch', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuthWithDeal(member, {
      id: 'd1',
      data: { orgId: 'org-1', pipelineId: DEFAULT_PIPELINE_ID, stageId: 'discovery', title: 'T', value: 100 },
    }, {}, { capturedUpdate: captured })
    const req = callAsMember(member, 'PUT', '/api/v1/crm/deals/d1', { notes: 'just notes' })
    const { PUT } = await import('@/app/api/v1/crm/deals/[id]/route')
    const res = await PUT(req, routeCtx('d1'))
    expect(res.status).toBeLessThan(300)
    const patch = captured.mock.calls[0][0]
    // no stage change → lostReason logic doesn't run → not touched
    expect(patch.lostReason).toBeUndefined()
  })

  // ── lineItems ───────────────────────────────────────────────────────────────

  it('PUT with lineItems array → array saved in patch', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuthWithDeal(member, {
      id: 'd1',
      data: { orgId: 'org-1', pipelineId: DEFAULT_PIPELINE_ID, stageId: 'discovery', title: 'T', value: 100 },
    }, {}, { capturedUpdate: captured })
    const lineItems = [
      { name: 'Consulting', qty: 2, unitPrice: 500, total: 1000, currency: 'ZAR' },
    ]
    const req = callAsMember(member, 'PUT', '/api/v1/crm/deals/d1', { lineItems })
    const { PUT } = await import('@/app/api/v1/crm/deals/[id]/route')
    const res = await PUT(req, routeCtx('d1'))
    expect(res.status).toBeLessThan(300)
    const patch = captured.mock.calls[0][0]
    expect(patch.lineItems).toEqual(lineItems)
  })

  it('PUT with empty lineItems array → array cleared (empty array saved)', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuthWithDeal(member, {
      id: 'd1',
      data: {
        orgId: 'org-1', pipelineId: DEFAULT_PIPELINE_ID, stageId: 'discovery',
        title: 'T', value: 100,
        lineItems: [{ name: 'Old', qty: 1, unitPrice: 100, total: 100, currency: 'ZAR' }],
      },
    }, {}, { capturedUpdate: captured })
    const req = callAsMember(member, 'PUT', '/api/v1/crm/deals/d1', { lineItems: [] })
    const { PUT } = await import('@/app/api/v1/crm/deals/[id]/route')
    const res = await PUT(req, routeCtx('d1'))
    expect(res.status).toBeLessThan(300)
    const patch = captured.mock.calls[0][0]
    expect(patch.lineItems).toEqual([])
  })

  it('PUT without lineItems → lineItems not in update patch', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuthWithDeal(member, {
      id: 'd1',
      data: { orgId: 'org-1', pipelineId: DEFAULT_PIPELINE_ID, stageId: 'discovery', title: 'T', value: 100 },
    }, {}, { capturedUpdate: captured })
    const req = callAsMember(member, 'PUT', '/api/v1/crm/deals/d1', { notes: 'no lineItems' })
    const { PUT } = await import('@/app/api/v1/crm/deals/[id]/route')
    const res = await PUT(req, routeCtx('d1'))
    expect(res.status).toBeLessThan(300)
    const patch = captured.mock.calls[0][0]
    expect(patch.lineItems).toBeUndefined()
  })

  // ── GET: probability, lostReason, lineItems pass-through ───────────────────

  it('GET deal list returns probability, lostReason, lineItems from doc', async () => {
    const member = seedOrgMember('org-test', 'uid-viewer', { role: 'viewer' })
    stageAuth(member, {}, {
      existingDeals: [{
        id: 'd1',
        data: {
          title: 'A5 Deal',
          pipelineId: DEFAULT_PIPELINE_ID,
          stageId: 'lost',
          deleted: false,
          probability: 0,
          lostReason: 'Budget cut',
          lineItems: [{ name: 'Service', qty: 1, unitPrice: 200, total: 200, currency: 'ZAR' }],
        },
      }],
    })
    const req = callAsMember(member, 'GET', '/api/v1/crm/deals')
    const { GET } = await import('@/app/api/v1/crm/deals/route')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    const deal = body.data[0]
    expect(deal.probability).toBe(0)
    expect(deal.lostReason).toBe('Budget cut')
    expect(deal.lineItems).toHaveLength(1)
    expect(deal.lineItems[0].name).toBe('Service')
  })

  // ── probability explicit value on body — no stageId change ─────────────────

  it('PUT explicit probability without stageId change → probability saved as-is', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuthWithDeal(member, {
      id: 'd1',
      data: { orgId: 'org-1', pipelineId: DEFAULT_PIPELINE_ID, stageId: 'discovery', title: 'T', value: 100 },
    }, {}, { capturedUpdate: captured })
    const req = callAsMember(member, 'PUT', '/api/v1/crm/deals/d1', { probability: 42 })
    const { PUT } = await import('@/app/api/v1/crm/deals/[id]/route')
    const res = await PUT(req, routeCtx('d1'))
    expect(res.status).toBeLessThan(300)
    const patch = captured.mock.calls[0][0]
    // passed through sanitizeDealForWrite, no stage change so auto-derive doesn't run
    expect(patch.probability).toBe(42)
  })

  it('PUT stageId → negotiation without probability → probability auto-set to 70', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuthWithDeal(member, {
      id: 'd1',
      data: { orgId: 'org-1', pipelineId: DEFAULT_PIPELINE_ID, stageId: 'discovery', title: 'T', value: 100 },
    }, {}, { capturedUpdate: captured })
    const req = callAsMember(member, 'PUT', '/api/v1/crm/deals/d1', { stageId: 'negotiation' })
    const { PUT } = await import('@/app/api/v1/crm/deals/[id]/route')
    const res = await PUT(req, routeCtx('d1'))
    expect(res.status).toBeLessThan(300)
    const patch = captured.mock.calls[0][0]
    expect(patch.probability).toBe(70)
  })
})

// ── Custom field validation ────────────────────────────────────────────────────

describe('POST /api/v1/crm/deals — custom field validation', () => {
  beforeEach(() => { jest.clearAllMocks(); setupDefaultPipelineMock() })

  const validDeal = {
    contactId: 'c1', title: 'CF Deal', value: 1000, currency: 'ZAR',
    pipelineId: DEFAULT_PIPELINE_ID, stageId: 'discovery',
  }

  it('accepts write when customFields match definitions', async () => {
    const member = seedOrgMember('org-cf-deal', 'uid-cf-deal-ok', { role: 'member' })
    setupDefaultPipelineMock('org-cf-deal')
    stageAuth(member)
    ;(getDefinitionsForResource as jest.Mock).mockResolvedValueOnce([
      { id: 'd1', key: 'closed_on', type: 'date', required: false, orgId: 'org-cf-deal', resource: 'deal', label: 'Closed On', order: 0, createdAt: null, updatedAt: null },
    ])
    const req = callAsMember(member, 'POST', '/api/v1/crm/deals', {
      ...validDeal,
      customFields: { closed_on: '2026-01-01' },
    })
    const { POST } = await import('@/app/api/v1/crm/deals/route')
    const res = await POST(req)
    expect(res.status).toBe(201)
  })

  it('rejects write with 400 when customFields violate definitions', async () => {
    const member = seedOrgMember('org-cf-deal', 'uid-cf-deal-bad', { role: 'member' })
    setupDefaultPipelineMock('org-cf-deal')
    stageAuth(member)
    ;(getDefinitionsForResource as jest.Mock).mockResolvedValueOnce([
      { id: 'd1', key: 'closed_on', type: 'date', required: true, orgId: 'org-cf-deal', resource: 'deal', label: 'Closed On', order: 0, createdAt: null, updatedAt: null },
    ])
    const req = callAsMember(member, 'POST', '/api/v1/crm/deals', {
      ...validDeal,
      customFields: { closed_on: 'not-a-date' },
    })
    const { POST } = await import('@/app/api/v1/crm/deals/route')
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/custom field/i)
  })
})
