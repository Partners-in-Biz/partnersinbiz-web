// __tests__/api/v1/crm/automations/trigger-wiring.test.ts
// Smoke tests verifying that fireTrigger is called from CRM routes (A6).
// Mocks @/lib/automations/trigger at the top level so dynamic imports resolve to it.

// ─── Mocks (must be before all imports) ──────────────────────────────────────
jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn() },
}))

jest.mock('@/lib/activity/log', () => ({
  logActivity: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/lib/webhooks/dispatch', () => ({
  dispatchWebhook: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/lib/email-analytics/attribution-hooks', () => ({
  tryAttributeDealWon: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/lib/customFields/store', () => ({
  getDefinitionsForResource: jest.fn().mockResolvedValue([]),
}))
jest.mock('@/lib/pipelines/store', () => ({
  loadPipeline: jest.fn(),
  getDefaultPipelineForOrg: jest.fn(),
}))

// Key mock: static top-level mock so dynamic import('@/lib/automations/trigger') resolves here
jest.mock('@/lib/automations/trigger', () => ({
  fireTrigger: jest.fn().mockResolvedValue(undefined),
}))

// ─── Imports ──────────────────────────────────────────────────────────────────
import { NextRequest } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { loadPipeline, getDefaultPipelineForOrg } from '@/lib/pipelines/store'
import { fireTrigger } from '@/lib/automations/trigger'

const mockFireTrigger = fireTrigger as jest.Mock
const mockCollection = adminDb.collection as jest.Mock

// ─── Env ──────────────────────────────────────────────────────────────────────
const AI_API_KEY = 'test-ai-key-wiring'
process.env.AI_API_KEY = AI_API_KEY
process.env.SESSION_COOKIE_NAME = '__session'

// ─── Shared pipeline fixture ──────────────────────────────────────────────────
const PIPELINE_ID = 'pl-wiring'
const PIPELINE = {
  id: PIPELINE_ID,
  orgId: 'org-wiring',
  name: 'Wiring Pipeline',
  isDefault: true,
  archived: false,
  deleted: false,
  stages: [
    { id: 'open-1', label: 'Open',       kind: 'open', order: 0, probability: 10 },
    { id: 'open-2', label: 'Proposal',   kind: 'open', order: 1, probability: 50 },
    { id: 'won-1',  label: 'Closed Won', kind: 'won',  order: 2, probability: 100 },
    { id: 'lost-1', label: 'Closed Lost',kind: 'lost', order: 3, probability: 0 },
  ],
  createdAt: null,
  updatedAt: null,
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────
const MEMBER = {
  uid: 'uid-wiring',
  orgId: 'org-wiring',
  role: 'admin' as const,
  firstName: 'Test',
  lastName: 'User',
  displayName: 'Test User',
  kind: 'user' as const,
}

function makeCookieReq(method: string, url: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    headers: {
      'cookie': `__session=valid-session`,
      'content-type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
}

function setupOrgAuth(opts: {
  deal?: { id: string; data: Record<string, unknown> } | null
  contact?: { id: string; data: Record<string, unknown> } | null
  capturedDealUpdate?: jest.Mock
  capturedContactUpdate?: jest.Mock
  capturedDealSet?: jest.Mock
  capturedContactSet?: jest.Mock
} = {}) {
  ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: MEMBER.uid })
  ;(getDefaultPipelineForOrg as jest.Mock).mockResolvedValue(PIPELINE)
  ;(loadPipeline as jest.Mock).mockResolvedValue({ ref: {}, data: PIPELINE })

  mockCollection.mockImplementation((name: string) => {
    if (name === 'users') {
      return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ activeOrgId: MEMBER.orgId }) }) }) }
    }
    if (name === 'orgMembers') {
      return {
        doc: jest.fn().mockReturnValue({
          get: () => Promise.resolve({ exists: true, data: () => MEMBER }),
        }),
        where: jest.fn().mockReturnValue({
          get: () => Promise.resolve({
            docs: [
              {
                id: `${MEMBER.orgId}_${MEMBER.uid}`,
                data: () => MEMBER,
              },
            ],
          }),
        }),
      }
    }
    if (name === 'organizations') {
      return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ settings: { permissions: {} } }) }) }) }
    }
    if (name === 'deals') {
      const updateFn = opts.capturedDealUpdate ?? jest.fn().mockResolvedValue(undefined)
      const setFn = opts.capturedDealSet ?? jest.fn().mockResolvedValue(undefined)
      return {
        doc: jest.fn().mockReturnValue({
          id: opts.deal?.id ?? 'deal-wiring',
          get: jest.fn().mockResolvedValue({
            exists: opts.deal != null,
            id: opts.deal?.id ?? 'deal-wiring',
            data: () => opts.deal?.data ?? {},
          }),
          update: updateFn,
          set: setFn,
        }),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ docs: [] }),
      }
    }
    if (name === 'contacts') {
      const updateFn = opts.capturedContactUpdate ?? jest.fn().mockResolvedValue(undefined)
      const setFn = opts.capturedContactSet ?? jest.fn().mockResolvedValue(undefined)
      return {
        doc: jest.fn().mockReturnValue({
          id: opts.contact?.id ?? 'contact-wiring',
          get: jest.fn().mockResolvedValue({
            exists: opts.contact != null,
            id: opts.contact?.id ?? 'contact-wiring',
            data: () => opts.contact?.data ?? {},
          }),
          update: updateFn,
          set: setFn,
        }),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ docs: [] }),
      }
    }
    if (name === 'activities') {
      return { add: jest.fn().mockResolvedValue({ id: 'act-1' }) }
    }
    return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
  })
}

beforeEach(() => {
  jest.clearAllMocks()
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Trigger wiring — deal stage-change', () => {
  it('fires deal.stage_changed when stage changes on PUT /deals/:id', async () => {
    setupOrgAuth({
      deal: {
        id: 'deal-1',
        data: {
          orgId: 'org-wiring',
          pipelineId: PIPELINE_ID,
          stageId: 'open-1',
          contactId: 'contact-1',
          title: 'Wiring Deal',
          value: 1000,
        },
      },
    })

    const { PUT } = await import('@/app/api/v1/crm/deals/[id]/route')
    const req = makeCookieReq('PUT', 'http://localhost/api/v1/crm/deals/deal-1', {
      stageId: 'open-2',
    })
    const res = await PUT(req, { params: Promise.resolve({ id: 'deal-1' }) })

    expect(res.status).toBe(200)
    expect(mockFireTrigger).toHaveBeenCalledWith('deal.stage_changed', expect.objectContaining({
      orgId: 'org-wiring',
      dealId: 'deal-1',
      toStageId: 'open-2',
    }))
  })

  it('fires deal.won when stage kind is won', async () => {
    setupOrgAuth({
      deal: {
        id: 'deal-won',
        data: {
          orgId: 'org-wiring',
          pipelineId: PIPELINE_ID,
          stageId: 'open-1',
          contactId: 'contact-1',
          title: 'Winning Deal',
          value: 5000,
        },
      },
    })

    const { PUT } = await import('@/app/api/v1/crm/deals/[id]/route')
    const req = makeCookieReq('PUT', 'http://localhost/api/v1/crm/deals/deal-won', {
      stageId: 'won-1',
    })
    const res = await PUT(req, { params: Promise.resolve({ id: 'deal-won' }) })

    expect(res.status).toBe(200)
    expect(mockFireTrigger).toHaveBeenCalledWith('deal.won', expect.objectContaining({
      orgId: 'org-wiring',
    }))
  })

  it('fires deal.lost when stage kind is lost', async () => {
    setupOrgAuth({
      deal: {
        id: 'deal-lost',
        data: {
          orgId: 'org-wiring',
          pipelineId: PIPELINE_ID,
          stageId: 'open-1',
          contactId: 'contact-1',
          title: 'Lost Deal',
          value: 2000,
        },
      },
    })

    const { PUT } = await import('@/app/api/v1/crm/deals/[id]/route')
    const req = makeCookieReq('PUT', 'http://localhost/api/v1/crm/deals/deal-lost', {
      stageId: 'lost-1',
    })
    const res = await PUT(req, { params: Promise.resolve({ id: 'deal-lost' }) })

    expect(res.status).toBe(200)
    expect(mockFireTrigger).toHaveBeenCalledWith('deal.lost', expect.objectContaining({
      orgId: 'org-wiring',
    }))
  })

  it('does NOT fire trigger when stage is unchanged', async () => {
    setupOrgAuth({
      deal: {
        id: 'deal-same',
        data: {
          orgId: 'org-wiring',
          pipelineId: PIPELINE_ID,
          stageId: 'open-1',
          contactId: 'contact-1',
          title: 'Same Stage Deal',
          value: 999,
        },
      },
    })

    const { PUT } = await import('@/app/api/v1/crm/deals/[id]/route')
    const req = makeCookieReq('PUT', 'http://localhost/api/v1/crm/deals/deal-same', {
      title: 'Updated title only',
    })
    const res = await PUT(req, { params: Promise.resolve({ id: 'deal-same' }) })

    expect(res.status).toBe(200)
    const stageTriggerCalls = mockFireTrigger.mock.calls.filter(
      (c) => c[0] === 'deal.stage_changed'
    )
    expect(stageTriggerCalls).toHaveLength(0)
  })

  it('returns 200 even when fireTrigger throws', async () => {
    setupOrgAuth({
      deal: {
        id: 'deal-trigger-err',
        data: {
          orgId: 'org-wiring',
          pipelineId: PIPELINE_ID,
          stageId: 'open-1',
          contactId: 'contact-1',
          title: 'Error Deal',
          value: 100,
        },
      },
    })
    mockFireTrigger.mockRejectedValue(new Error('trigger exploded'))

    const { PUT } = await import('@/app/api/v1/crm/deals/[id]/route')
    const req = makeCookieReq('PUT', 'http://localhost/api/v1/crm/deals/deal-trigger-err', {
      stageId: 'open-2',
    })
    const res = await PUT(req, { params: Promise.resolve({ id: 'deal-trigger-err' }) })

    expect(res.status).toBe(200) // trigger failure is transparent
  })
})

describe('Trigger wiring — deal created', () => {
  it('fires deal.created after successful POST /deals', async () => {
    setupOrgAuth()

    const { POST } = await import('@/app/api/v1/crm/deals/route')
    const req = makeCookieReq('POST', 'http://localhost/api/v1/crm/deals', {
      title: 'New Deal',
      contactId: 'contact-1',
      value: 1500,
    })
    const res = await POST(req)

    expect(res.status).toBe(201)
    expect(mockFireTrigger).toHaveBeenCalledWith('deal.created', expect.objectContaining({
      orgId: 'org-wiring',
    }))
  })
})

describe('Trigger wiring — contact created', () => {
  it('fires contact.created after successful POST /contacts', async () => {
    setupOrgAuth({
      contact: { id: 'new-contact', data: {} },
    })

    const { POST } = await import('@/app/api/v1/crm/contacts/route')
    const req = makeCookieReq('POST', 'http://localhost/api/v1/crm/contacts', {
      name: 'Alice Wiring',
      email: 'alice@wiring.test',
    })
    const res = await POST(req)

    expect(res.status).toBe(201)
    expect(mockFireTrigger).toHaveBeenCalledWith('contact.created', expect.objectContaining({
      orgId: 'org-wiring',
      contactEmail: 'alice@wiring.test',
    }))
  })
})

describe('Trigger wiring — contact lifecycle changed', () => {
  it('fires contact.lifecycle_changed when type field changes on PUT /contacts/:id', async () => {
    setupOrgAuth({
      contact: {
        id: 'contact-lifecycle',
        data: {
          orgId: 'org-wiring',
          name: 'Bob Lifecycle',
          email: 'bob@lifecycle.test',
          type: 'lead',
        },
      },
    })

    const { PUT } = await import('@/app/api/v1/crm/contacts/[id]/route')
    const req = makeCookieReq('PUT', 'http://localhost/api/v1/crm/contacts/contact-lifecycle', {
      type: 'client',
    })
    const res = await PUT(req, { params: Promise.resolve({ id: 'contact-lifecycle' }) })

    expect(res.status).toBe(200)
    expect(mockFireTrigger).toHaveBeenCalledWith('contact.lifecycle_changed', expect.objectContaining({
      orgId: 'org-wiring',
      contactId: 'contact-lifecycle',
    }))
  })

  it('does NOT fire lifecycle trigger when type is unchanged', async () => {
    setupOrgAuth({
      contact: {
        id: 'contact-same-type',
        data: {
          orgId: 'org-wiring',
          name: 'Carol Same',
          email: 'carol@same.test',
          type: 'prospect',
        },
      },
    })

    const { PUT } = await import('@/app/api/v1/crm/contacts/[id]/route')
    const req = makeCookieReq('PUT', 'http://localhost/api/v1/crm/contacts/contact-same-type', {
      name: 'Carol Updated',
      // type not changed
    })
    const res = await PUT(req, { params: Promise.resolve({ id: 'contact-same-type' }) })

    expect(res.status).toBe(200)
    const lifecycleCalls = mockFireTrigger.mock.calls.filter(
      (c) => c[0] === 'contact.lifecycle_changed'
    )
    expect(lifecycleCalls).toHaveLength(0)
  })
})
