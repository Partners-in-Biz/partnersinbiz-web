import { NextRequest } from 'next/server'
import { createHash } from 'node:crypto'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: {
    verifySessionCookie: jest.fn(),
  },
  adminDb: {
    collection: jest.fn(),
  },
}))

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { withCrmAuth } from '@/lib/auth/crm-middleware'

const AI_API_KEY = 'test-ai-key-abc'
process.env.AI_API_KEY = AI_API_KEY
process.env.SESSION_COOKIE_NAME = '__session'

const ORG_ID = 'org-test'
const UID = 'uid-real'
const mockApiKeyUpdate = jest.fn()
let mockApiKeyDocs: Array<{ id: string; data: () => Record<string, unknown>; ref: { update: jest.Mock } }> = []

function makeReq(headers: Record<string, string> = {}, method = 'GET') {
  return new NextRequest('http://localhost/api/v1/crm/contacts', {
    method,
    headers: new Headers(headers),
  })
}

function setupCollections({
  user,
  member,
  org,
  memberOrgIds,
}: {
  user: Record<string, unknown> | null
  member: Record<string, unknown> | null
  org: Record<string, unknown> | null
  memberOrgIds?: string[]
}) {
  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    if (name === 'users') {
      return {
        doc: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue({ exists: user !== null, data: () => user ?? undefined }),
        }),
      }
    }
    if (name === 'orgMembers') {
      return {
        where: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue({
            docs: (memberOrgIds ?? []).map((orgId) => ({
              id: `${orgId}_${UID}`,
              data: () => ({ orgId, uid: UID }),
            })),
          }),
        }),
        doc: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue({ exists: member !== null, data: () => member ?? undefined }),
        }),
      }
    }
    if (name === 'organizations') {
      return {
        doc: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue({ exists: org !== null, data: () => org ?? undefined }),
        }),
      }
    }
    if (name === 'api_keys') {
      return {
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            get: jest.fn().mockResolvedValue({
              empty: mockApiKeyDocs.length === 0,
              docs: mockApiKeyDocs,
            }),
          }),
        }),
      }
    }
    throw new Error(`Unexpected collection: ${name}`)
  })
}

function apiKeyDoc(rawKey: string, data: Record<string, unknown>) {
  return {
    id: 'crm-api-key-1',
    data: () => ({
      keyHash: createHash('sha256').update(rawKey).digest('hex'),
      role: 'ai',
      permissions: [{ resource: 'email-outreach', actions: ['read', 'write'] }],
      agentId: 'pip',
      orgId: ORG_ID,
      ...data,
    }),
    ref: { update: mockApiKeyUpdate },
  }
}

describe('withCrmAuth — cookie path', () => {
  beforeEach(() => jest.clearAllMocks())

  it('200s for a member with sufficient role', async () => {
    ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: UID })
    setupCollections({
      user: { activeOrgId: ORG_ID },
      member: { orgId: ORG_ID, uid: UID, role: 'member', firstName: 'A', lastName: 'B' },
      org: { settings: { permissions: { membersCanDeleteContacts: true } } },
    })
    const handler = jest.fn().mockResolvedValue(new Response('ok', { status: 200 }))
    const route = withCrmAuth('member', handler)
    const req = makeReq({ cookie: '__session=valid' })
    const res = await route(req)
    expect(res.status).toBe(200)
    expect(handler).toHaveBeenCalledTimes(1)
    const ctx = handler.mock.calls[0][1]
    expect(ctx.orgId).toBe(ORG_ID)
    expect(ctx.role).toBe('member')
    expect(ctx.isAgent).toBe(false)
    expect(ctx.actor.uid).toBe(UID)
    expect(ctx.actor.kind).toBe('human')
    expect(ctx.permissions.membersCanDeleteContacts).toBe(true)
    expect(ctx.uid).toBe(UID)
    expect(ctx.accessPolicy.modules.crm).toBe(true)
    expect(ctx.accessPolicy.recordScopes.crm).toBe('all')
  })

  it('derives member CRM policy from legacy accessScope', async () => {
    ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: UID })
    setupCollections({
      user: { activeOrgId: ORG_ID },
      member: { orgId: ORG_ID, uid: UID, role: 'member', accessScope: 'crm' },
      org: { settings: { permissions: {} } },
    })
    const handler = jest.fn().mockResolvedValue(new Response('ok', { status: 200 }))
    const route = withCrmAuth('member', handler)
    const res = await route(makeReq({ cookie: '__session=valid' }))

    expect(res.status).toBe(200)
    const ctx = handler.mock.calls[0][1]
    expect(ctx.accessPolicy.preset).toBe('crm_sales')
    expect(ctx.accessPolicy.modules.crm).toBe(true)
    expect(ctx.accessPolicy.modules.projects).toBe(false)
    expect(ctx.accessPolicy.recordScopes.crm).toBe('owned_or_linked')
  })

  it('403s before the handler when the CRM module is disabled', async () => {
    ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: UID })
    setupCollections({
      user: { activeOrgId: ORG_ID },
      member: {
        orgId: ORG_ID,
        uid: UID,
        role: 'member',
        accessPolicy: {
          preset: 'custom',
          modules: { crm: false, projects: true },
          recordScopes: { crm: 'owned_or_linked', projects: 'owned_or_linked' },
        },
      },
      org: { settings: { permissions: {} } },
    })
    const handler = jest.fn()
    const route = withCrmAuth('viewer', handler)
    const res = await route(makeReq({ cookie: '__session=valid' }))

    expect(res.status).toBe(403)
    expect(handler).not.toHaveBeenCalled()
    expect((await res.json()).error).toMatch(/CRM/i)
  })

  it('honors owner-narrowed admin CRM policies', async () => {
    ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: UID })
    setupCollections({
      user: { activeOrgId: ORG_ID },
      member: {
        orgId: ORG_ID,
        uid: UID,
        role: 'admin',
        accessPolicy: {
          preset: 'custom',
          modules: { crm: true, projects: false },
          recordScopes: { crm: 'owned_or_linked', projects: 'owned_or_linked' },
        },
      },
      org: { settings: { permissions: {} } },
    })
    const handler = jest.fn().mockResolvedValue(new Response('ok', { status: 200 }))
    const route = withCrmAuth('member', handler)
    const res = await route(makeReq({ cookie: '__session=valid' }))

    expect(res.status).toBe(200)
    const ctx = handler.mock.calls[0][1]
    expect(ctx.role).toBe('admin')
    expect(ctx.accessPolicy.modules.projects).toBe(false)
    expect(ctx.accessPolicy.recordScopes.crm).toBe('owned_or_linked')
  })

  it('allows a platform admin to use client CRM only through explicit org membership', async () => {
    ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: UID })
    setupCollections({
      user: {
        role: 'admin',
        orgId: 'pib-platform-owner',
        activeOrgId: ORG_ID,
        allowedOrgIds: [],
      },
      member: { orgId: ORG_ID, uid: UID, role: 'admin', firstName: 'Staff', lastName: 'User' },
      memberOrgIds: [ORG_ID],
      org: { settings: { permissions: {} }, members: [] },
    })
    const handler = jest.fn().mockResolvedValue(new Response('ok', { status: 200 }))
    const route = withCrmAuth('admin', handler)
    const req = makeReq({ cookie: '__session=valid' })
    const res = await route(req)

    expect(res.status).toBe(200)
    const ctx = handler.mock.calls[0][1]
    expect(ctx.orgId).toBe(ORG_ID)
    expect(ctx.role).toBe('admin')
    expect(ctx.user.role).toBe('admin')
  })

  it('403s when member role is below minRole', async () => {
    ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: UID })
    setupCollections({
      user: { activeOrgId: ORG_ID },
      member: { orgId: ORG_ID, uid: UID, role: 'viewer', firstName: 'A', lastName: 'B' },
      org: { settings: { permissions: {} } },
    })
    const handler = jest.fn()
    const route = withCrmAuth('admin', handler)
    const res = await route(makeReq({ cookie: '__session=valid' }))
    expect(res.status).toBe(403)
    expect(handler).not.toHaveBeenCalled()
  })

  it('falls back to organizations.members[] when orgMembers doc is missing', async () => {
    ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: UID })
    setupCollections({
      user: { activeOrgId: ORG_ID },
      member: null,
      org: {
        settings: { permissions: {} },
        members: [{ userId: UID, role: 'admin' }],
      },
    })
    const handler = jest.fn().mockResolvedValue(new Response('ok', { status: 200 }))
    const route = withCrmAuth('member', handler)
    const res = await route(makeReq({ cookie: '__session=valid' }))
    expect(res.status).toBe(200)
    const ctx = handler.mock.calls[0][1]
    expect(ctx.role).toBe('admin')
    expect(ctx.actor.uid).toBe(UID)
  })

  it('403s when user has no membership in active org', async () => {
    ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: UID })
    setupCollections({
      user: { activeOrgId: ORG_ID },
      member: null,
      org: { settings: { permissions: {} }, members: [] },
    })
    const handler = jest.fn()
    const route = withCrmAuth('viewer', handler)
    const res = await route(makeReq({ cookie: '__session=valid' }))
    expect(res.status).toBe(403)
  })

  it('400s when user has no activeOrgId or orgId', async () => {
    ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: UID })
    setupCollections({ user: {}, member: null, org: null })
    const route = withCrmAuth('viewer', jest.fn())
    const res = await route(makeReq({ cookie: '__session=valid' }))
    expect(res.status).toBe(400)
  })

  it('401s when session cookie verification fails', async () => {
    ;(adminAuth.verifySessionCookie as jest.Mock).mockRejectedValue(new Error('invalid'))
    const route = withCrmAuth('viewer', jest.fn())
    const res = await route(makeReq({ cookie: '__session=bad' }))
    expect(res.status).toBe(401)
  })
})

describe('withCrmAuth — Bearer path', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockApiKeyDocs = []
    mockApiKeyUpdate.mockResolvedValue(undefined)
  })

  it('200s with system role for valid AI_API_KEY + X-Org-Id', async () => {
    setupCollections({
      user: null,
      member: null,
      org: { settings: { permissions: { membersCanDeleteContacts: false } } },
    })
    const handler = jest.fn().mockResolvedValue(new Response('ok', { status: 200 }))
    const route = withCrmAuth('admin', handler)
    const res = await route(
      makeReq({ authorization: `Bearer ${AI_API_KEY}`, 'x-org-id': ORG_ID }),
    )
    expect(res.status).toBe(200)
    const ctx = handler.mock.calls[0][1]
    expect(ctx.role).toBe('system')
    expect(ctx.isAgent).toBe(true)
    expect(ctx.orgId).toBe(ORG_ID)
    expect(ctx.actor.uid).toBe('agent:pip')
    expect(ctx.actor.kind).toBe('agent')
    expect(ctx.permissions.membersCanDeleteContacts).toBe(false)
    expect(ctx.accessPolicy.modules.crm).toBe(true)
    expect(ctx.accessPolicy.recordScopes.crm).toBe('all')
  })

  it('bypasses every minRole including owner', async () => {
    setupCollections({ user: null, member: null, org: { settings: { permissions: {} } } })
    const handler = jest.fn().mockResolvedValue(new Response('ok', { status: 200 }))
    const route = withCrmAuth('owner', handler)
    const res = await route(
      makeReq({ authorization: `Bearer ${AI_API_KEY}`, 'x-org-id': ORG_ID }),
    )
    expect(res.status).toBe(200)
  })

  it('400s on Bearer call missing X-Org-Id header', async () => {
    const route = withCrmAuth('viewer', jest.fn())
    const res = await route(makeReq({ authorization: `Bearer ${AI_API_KEY}` }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/X-Org-Id/i)
  })

  it('401s on Bearer call with wrong key', async () => {
    const route = withCrmAuth('viewer', jest.fn())
    const res = await route(
      makeReq({ authorization: 'Bearer wrong-key', 'x-org-id': ORG_ID }),
    )
    expect(res.status).toBe(401)
  })

  it('404s when Bearer call targets a non-existent org', async () => {
    setupCollections({ user: null, member: null, org: null })
    const route = withCrmAuth('viewer', jest.fn())
    const res = await route(
      makeReq({ authorization: `Bearer ${AI_API_KEY}`, 'x-org-id': 'ghost-org' }),
    )
    expect(res.status).toBe(404)
  })

  it('200s with system role for a scoped per-agent API key', async () => {
    const rawKey = 'pib_ag_crm_marketing_valid'
    mockApiKeyDocs = [apiKeyDoc(rawKey, { agentId: 'marketing', orgId: ORG_ID })]
    setupCollections({
      user: null,
      member: null,
      org: { settings: { permissions: { membersCanExportContacts: true } } },
    })
    const handler = jest.fn().mockResolvedValue(new Response('ok', { status: 200 }))
    const route = withCrmAuth('admin', handler)

    const res = await route(makeReq({ authorization: `Bearer ${rawKey}`, 'x-org-id': ORG_ID }))

    expect(res.status).toBe(200)
    const ctx = handler.mock.calls[0][1]
    expect(ctx.role).toBe('system')
    expect(ctx.isAgent).toBe(true)
    expect(ctx.orgId).toBe(ORG_ID)
    expect(ctx.actor.uid).toBe('agent:marketing')
    expect(ctx.actor.kind).toBe('agent')
    expect(ctx.user.authKind).toBe('agent_api_key')
    expect(mockApiKeyUpdate).toHaveBeenCalled()
  })

  it('derives org scope from a scoped per-agent API key when X-Org-Id is omitted', async () => {
    const rawKey = 'pib_ag_crm_marketing_scoped'
    mockApiKeyDocs = [apiKeyDoc(rawKey, { agentId: 'marketing', orgId: ORG_ID })]
    setupCollections({
      user: null,
      member: null,
      org: { settings: { permissions: {} } },
    })
    const handler = jest.fn().mockResolvedValue(new Response('ok', { status: 200 }))
    const route = withCrmAuth('admin', handler)

    const res = await route(makeReq({ authorization: `Bearer ${rawKey}` }))

    expect(res.status).toBe(200)
    expect(handler.mock.calls[0][1].orgId).toBe(ORG_ID)
  })

  it('403s when a scoped per-agent API key targets a different org', async () => {
    const rawKey = 'pib_ag_crm_marketing_wrong_org'
    mockApiKeyDocs = [apiKeyDoc(rawKey, { agentId: 'marketing', orgId: 'org-other' })]
    const route = withCrmAuth('viewer', jest.fn())

    const res = await route(makeReq({ authorization: `Bearer ${rawKey}`, 'x-org-id': ORG_ID }))

    expect(res.status).toBe(403)
  })
})

describe('withCrmAuth — no auth at all', () => {
  it('401s when neither cookie nor Bearer is present', async () => {
    const route = withCrmAuth('viewer', jest.fn())
    const res = await route(makeReq({}))
    expect(res.status).toBe(401)
  })
})

describe('withCrmAuth — route context forwarding', () => {
  beforeEach(() => jest.clearAllMocks())

  it('forwards Next.js App Router route context as 3rd handler arg', async () => {
    setupCollections({
      user: null,
      member: null,
      org: { settings: { permissions: {} } },
    })
    const handler = jest.fn().mockResolvedValue(new Response('ok', { status: 200 }))
    const route = withCrmAuth<{ params: Promise<{ id: string }> }>('viewer', handler)
    const fakeRouteCtx = { params: Promise.resolve({ id: 'contact-123' }) }
    await route(
      makeReq({ authorization: `Bearer ${AI_API_KEY}`, 'x-org-id': ORG_ID }),
      fakeRouteCtx,
    )
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0][2]).toBe(fakeRouteCtx)
  })
})
