/**
 * Tests for GET /api/v1/crm/custom-fields and POST /api/v1/crm/custom-fields
 */
import { NextRequest } from 'next/server'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn(), batch: jest.fn() },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => ({ _type: 'serverTimestamp' }),
    delete: () => ({ _type: 'deleteField' }),
    arrayUnion: (...vals: unknown[]) => ({ _type: 'arrayUnion', vals }),
    arrayRemove: (...vals: unknown[]) => ({ _type: 'arrayRemove', vals }),
  },
  Timestamp: {
    now: () => ({ seconds: 1000, nanoseconds: 0, toDate: () => new Date() }),
  },
}))

jest.mock('@/lib/customFields/store', () => ({
  getDefinitionsForResource: jest.fn(),
  assertKeyUnique: jest.fn(),
  sanitizeDefinitionForWrite: jest.fn(),
  CustomFieldKeyError: class CustomFieldKeyError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'CustomFieldKeyError'
    }
  },
}))

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import * as cfStore from '@/lib/customFields/store'
import { seedOrgMember, callAsMember } from '../../../../helpers/crm'
import { buildDefinition, uidFor } from './_fixtures'

const AI_API_KEY = 'test-ai-key-cf-root'
process.env.AI_API_KEY = AI_API_KEY
process.env.SESSION_COOKIE_NAME = '__session'

// ── stageAuth ────────────────────────────────────────────────────────────────

function stageAuth(
  member: { uid: string; orgId: string; role: string; firstName?: string; lastName?: string },
  opts: { capturedDocSet?: jest.Mock } = {},
) {
  ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })
  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    if (name === 'users') {
      return {
        doc: () => ({
          get: () => Promise.resolve({ exists: true, data: () => ({ activeOrgId: member.orgId }) }),
        }),
      }
    }
    if (name === 'orgMembers') {
      return {
        doc: () => ({
          get: () => Promise.resolve({ exists: true, data: () => member }),
        }),
      }
    }
    if (name === 'organizations') {
      return {
        doc: () => ({
          get: () => Promise.resolve({ exists: true, data: () => ({ settings: { permissions: {} } }) }),
        }),
      }
    }
    if (name === 'customFieldDefinitions') {
      const setFn = opts.capturedDocSet ?? jest.fn().mockResolvedValue(undefined)
      return {
        doc: jest.fn().mockReturnValue({
          id: 'auto-def-id',
          set: setFn,
        }),
      }
    }
    return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  // Default store mocks
  ;(cfStore.getDefinitionsForResource as jest.Mock).mockResolvedValue([])
  ;(cfStore.assertKeyUnique as jest.Mock).mockResolvedValue(true)
  ;(cfStore.sanitizeDefinitionForWrite as jest.Mock).mockImplementation(
    (input: Record<string, unknown>) => {
      const { id, orgId, createdBy, createdByRef, createdAt, updatedBy, updatedByRef, updatedAt, deleted, ...rest } = input as Record<string, unknown>
      void id; void orgId; void createdBy; void createdByRef; void createdAt
      void updatedBy; void updatedByRef; void updatedAt; void deleted
      if (typeof rest.key === 'string') {
        rest.key = rest.key.toLowerCase().trim()
      }
      return rest
    },
  )
})

// Import route lazily (after mocks are set up)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let routeModule: any
beforeAll(async () => {
  routeModule = await import('@/app/api/v1/crm/custom-fields/route')
})

// ── GET ───────────────────────────────────────────────────────────────────────

describe('GET /api/v1/crm/custom-fields', () => {
  it('returns definitions for a given resource', async () => {
    const uid = uidFor('viewer')
    const member = seedOrgMember('org-a', uid, { role: 'viewer' })
    const def = buildDefinition({ orgId: 'org-a', resource: 'contact' })
    stageAuth(member)
    ;(cfStore.getDefinitionsForResource as jest.Mock).mockResolvedValue([def])

    const req = new NextRequest('http://localhost/api/v1/crm/custom-fields?resource=contact', {
      headers: { cookie: `__session=test-session-${uid}` },
    })
    const res = await routeModule.GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.definitions).toHaveLength(1)
    expect(body.data.definitions[0].key).toBe(def.key)
  })

  it('returns 400 when resource query param is missing', async () => {
    const uid = uidFor('viewer2')
    const member = seedOrgMember('org-a', uid, { role: 'viewer' })
    stageAuth(member)

    const req = new NextRequest('http://localhost/api/v1/crm/custom-fields', {
      headers: { cookie: `__session=test-session-${uid}` },
    })
    const res = await routeModule.GET(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/resource/i)
  })

  it('returns 400 for invalid resource param', async () => {
    const uid = uidFor('viewer3')
    const member = seedOrgMember('org-a', uid, { role: 'viewer' })
    stageAuth(member)

    const req = new NextRequest('http://localhost/api/v1/crm/custom-fields?resource=invoice', {
      headers: { cookie: `__session=test-session-${uid}` },
    })
    const res = await routeModule.GET(req)
    expect(res.status).toBe(400)
  })

  it('enforces cross-tenant isolation — only returns defs for ctx.orgId', async () => {
    const uid = uidFor('viewer4')
    const member = seedOrgMember('org-a', uid, { role: 'viewer' })
    stageAuth(member)

    const orgADef = buildDefinition({ orgId: 'org-a', resource: 'deal' })
    ;(cfStore.getDefinitionsForResource as jest.Mock).mockResolvedValue([orgADef])

    const req = new NextRequest('http://localhost/api/v1/crm/custom-fields?resource=deal', {
      headers: { cookie: `__session=test-session-${uid}` },
    })
    const res = await routeModule.GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    // getDefinitionsForResource called with ctx.orgId ('org-a'), not a different org
    expect(cfStore.getDefinitionsForResource).toHaveBeenCalledWith('org-a', 'deal')
    expect(body.data.definitions[0].orgId).toBe('org-a')
  })
})

// ── POST ──────────────────────────────────────────────────────────────────────

describe('POST /api/v1/crm/custom-fields', () => {
  it('creates a text field and returns 201', async () => {
    const uid = uidFor('admin')
    const member = seedOrgMember('org-b', uid, { role: 'admin', firstName: 'Alice', lastName: 'A' })
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuth(member, { capturedDocSet: captured })

    const req = callAsMember(member, 'POST', '/api/v1/crm/custom-fields', {
      resource: 'contact',
      label: 'Industry',
      type: 'text',
      key: 'industry_custom',
    })
    const res = await routeModule.POST(req)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.definition.id).toBe('auto-def-id')
  })

  it('creates a dropdown field with options', async () => {
    const uid = uidFor('admin2')
    const member = seedOrgMember('org-b', uid, { role: 'admin' })
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuth(member, { capturedDocSet: captured })

    const req = callAsMember(member, 'POST', '/api/v1/crm/custom-fields', {
      resource: 'contact',
      label: 'Priority',
      type: 'dropdown',
      key: 'priority',
      options: [
        { value: 'high', label: 'High' },
        { value: 'low', label: 'Low' },
      ],
    })
    const res = await routeModule.POST(req)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  it('returns 400 when resource is missing', async () => {
    const uid = uidFor('admin3')
    const member = seedOrgMember('org-b', uid, { role: 'admin' })
    stageAuth(member)

    const req = callAsMember(member, 'POST', '/api/v1/crm/custom-fields', {
      label: 'Field',
      type: 'text',
      key: 'my_field',
    })
    const res = await routeModule.POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/resource/i)
  })

  it('returns 400 when label is missing', async () => {
    const uid = uidFor('admin4')
    const member = seedOrgMember('org-b', uid, { role: 'admin' })
    stageAuth(member)

    const req = callAsMember(member, 'POST', '/api/v1/crm/custom-fields', {
      resource: 'contact',
      type: 'text',
      key: 'my_field',
    })
    const res = await routeModule.POST(req)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/label/i)
  })

  it('returns 400 when type is missing or invalid', async () => {
    const uid = uidFor('admin5')
    const member = seedOrgMember('org-b', uid, { role: 'admin' })
    stageAuth(member)

    const req = callAsMember(member, 'POST', '/api/v1/crm/custom-fields', {
      resource: 'contact',
      label: 'Field',
      type: 'badtype',
      key: 'my_field',
    })
    const res = await routeModule.POST(req)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/type/i)
  })

  it('returns 400 when key is missing', async () => {
    const uid = uidFor('admin6')
    const member = seedOrgMember('org-b', uid, { role: 'admin' })
    stageAuth(member)

    const req = callAsMember(member, 'POST', '/api/v1/crm/custom-fields', {
      resource: 'contact',
      label: 'Field',
      type: 'text',
    })
    const res = await routeModule.POST(req)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/key/i)
  })

  it('returns 400 when sanitizeDefinitionForWrite throws CustomFieldKeyError', async () => {
    const uid = uidFor('admin7')
    const member = seedOrgMember('org-b', uid, { role: 'admin' })
    stageAuth(member)

    const { CustomFieldKeyError } = await import('@/lib/customFields/store')
    ;(cfStore.sanitizeDefinitionForWrite as jest.Mock).mockImplementationOnce(() => {
      throw new CustomFieldKeyError('key "1bad" must match regex')
    })

    const req = callAsMember(member, 'POST', '/api/v1/crm/custom-fields', {
      resource: 'contact',
      label: 'Bad Key',
      type: 'text',
      key: '1bad',
    })
    const res = await routeModule.POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Invalid key/i)
  })

  it('returns 400 when key is duplicate in same org+resource', async () => {
    const uid = uidFor('admin8')
    const member = seedOrgMember('org-b', uid, { role: 'admin' })
    stageAuth(member)
    ;(cfStore.assertKeyUnique as jest.Mock).mockResolvedValueOnce(false)

    const req = callAsMember(member, 'POST', '/api/v1/crm/custom-fields', {
      resource: 'contact',
      label: 'Dupe',
      type: 'text',
      key: 'existing_key',
    })
    const res = await routeModule.POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/already exists/i)
  })

  it('returns 400 for dropdown without options', async () => {
    const uid = uidFor('admin9')
    const member = seedOrgMember('org-b', uid, { role: 'admin' })
    stageAuth(member)

    const req = callAsMember(member, 'POST', '/api/v1/crm/custom-fields', {
      resource: 'contact',
      label: 'Status',
      type: 'dropdown',
      key: 'status',
    })
    const res = await routeModule.POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/options/i)
  })

  it('returns 403 when non-admin (viewer) tries to POST', async () => {
    const uid = uidFor('viewer5')
    const member = seedOrgMember('org-b', uid, { role: 'viewer' })
    stageAuth(member)

    const req = callAsMember(member, 'POST', '/api/v1/crm/custom-fields', {
      resource: 'contact',
      label: 'Field',
      type: 'text',
      key: 'my_field',
    })
    const res = await routeModule.POST(req)
    expect(res.status).toBe(403)
  })

  it('blocks orgId injection via body (sanitizeDefinitionForWrite strips it)', async () => {
    const uid = uidFor('admin10')
    const member = seedOrgMember('org-b', uid, { role: 'admin', firstName: 'Bob', lastName: 'B' })
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuth(member, { capturedDocSet: captured })

    const req = callAsMember(member, 'POST', '/api/v1/crm/custom-fields', {
      resource: 'contact',
      label: 'Injection',
      type: 'text',
      key: 'my_field',
      orgId: 'evil-org',
    })
    const res = await routeModule.POST(req)
    expect(res.status).toBe(201)
    // orgId in written doc must come from ctx, not body
    const written = captured.mock.calls[0][0]
    expect(written.orgId).toBe('org-b')
  })

  it('writes attribution (createdByRef) on POST', async () => {
    const uid = uidFor('admin11')
    const member = seedOrgMember('org-c', uid, { role: 'admin', firstName: 'Carol', lastName: 'C' })
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuth(member, { capturedDocSet: captured })

    const req = callAsMember(member, 'POST', '/api/v1/crm/custom-fields', {
      resource: 'deal',
      label: 'Budget Range',
      type: 'text',
      key: 'budget_range',
    })
    const res = await routeModule.POST(req)
    expect(res.status).toBe(201)
    const written = captured.mock.calls[0][0]
    expect(written.createdByRef).toBeDefined()
    expect(written.createdByRef.uid).toBe(uid)
    expect(written.orgId).toBe('org-c')
    expect(written.deleted).toBe(false)
  })
})
