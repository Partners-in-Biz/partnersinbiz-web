/**
 * Tests for the AgentOrgNode org-chart admin API:
 *   GET/POST  /api/v1/admin/agent-org
 *   POST      /api/v1/admin/agent-org/seed
 *   PATCH/DELETE /api/v1/admin/agent-org/:nodeId
 *
 * Harness follows __tests__/api/v1/crm/products/[id].route.test.ts:
 * real withAuth + resolveOrgScope, mocked firebase admin, mocked store/seed
 * modules, real pure tree logic (buildOrgTree / validateReparent).
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
  },
  Timestamp: {
    now: () => ({ seconds: 2000, nanoseconds: 0, toDate: () => new Date() }),
  },
}))

jest.mock('@/lib/agent-org/store', () => ({
  listOrgNodes: jest.fn(),
  getOrgNode: jest.fn(),
  createOrgNode: jest.fn(),
  updateOrgNode: jest.fn(),
  deleteOrgNode: jest.fn(),
  persistChains: jest.fn(),
}))

jest.mock('@/lib/agent-org/seed', () => ({
  seedOrgChart: jest.fn(),
}))

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import * as store from '@/lib/agent-org/store'
import * as seed from '@/lib/agent-org/seed'
import { DEFAULT_ORG_NODE_DELEGATION, type AgentOrgNode } from '@/lib/agent-org/types'

process.env.AI_API_KEY = 'test-ai-key-agent-org'
process.env.SESSION_COOKIE_NAME = '__session'

const ORG_ID = 'org-1'
const ADMIN_UID = 'uid-admin-org'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let orgRoute: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let nodeRoute: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let seedRoute: any

beforeAll(async () => {
  orgRoute = await import('@/app/api/v1/admin/agent-org/route')
  nodeRoute = await import('@/app/api/v1/admin/agent-org/[nodeId]/route')
  seedRoute = await import('@/app/api/v1/admin/agent-org/seed/route')
})

beforeEach(() => {
  jest.clearAllMocks()
  ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: ADMIN_UID })
  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    if (name === 'users') {
      return {
        doc: () => ({
          get: () =>
            Promise.resolve({
              exists: true,
              data: () => ({ role: 'admin', orgId: ORG_ID, activeOrgId: ORG_ID }),
            }),
        }),
      }
    }
    // orgMembers (member access policy) — not applicable to admins.
    return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
  })
  ;(adminDb.batch as jest.Mock).mockReturnValue({
    update: jest.fn(),
    commit: jest.fn().mockResolvedValue(undefined),
  })
})

// ── helpers ────────────────────────────────────────────────────────────────

function makeNode(overrides: Partial<AgentOrgNode> = {}): AgentOrgNode {
  return {
    id: 'node-1',
    orgId: ORG_ID,
    agentId: null,
    name: 'Node 1',
    title: 'Role',
    reportsTo: null,
    chainOfCommand: [],
    capabilities: [],
    defaultModel: null,
    defaultEffort: null,
    delegation: { ...DEFAULT_ORG_NODE_DELEGATION },
    status: 'active',
    iconKey: 'smart_toy',
    colorKey: 'sky',
    createdAt: { seconds: 1000, nanoseconds: 0 },
    updatedAt: { seconds: 1000, nanoseconds: 0 },
    ...overrides,
  }
}

function req(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, body?: unknown): NextRequest {
  const headers: Record<string, string> = {
    cookie: `__session=test-session-${ADMIN_UID}`,
  }
  if (body !== undefined) headers['content-type'] = 'application/json'
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: new Headers(headers),
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function makeCtx(nodeId: string) {
  return { params: Promise.resolve({ nodeId }) }
}

async function bodyOf(res: Response): Promise<Record<string, any>> {
  return res.json() as Promise<Record<string, any>>
}

// ── GET ─────────────────────────────────────────────────────────────────────

describe('GET /api/v1/admin/agent-org', () => {
  it('returns nodes and derived tree for the resolved org', async () => {
    const nodes = [
      makeNode({ id: 'a', name: 'Alpha', reportsTo: null }),
      makeNode({ id: 'b', name: 'Beta', reportsTo: 'a' }),
    ]
    ;(store.listOrgNodes as jest.Mock).mockResolvedValue(nodes)

    const res = await orgRoute.GET(req('GET', `/api/v1/admin/agent-org?orgId=${ORG_ID}`))
    expect(res.status).toBe(200)
    const body = await bodyOf(res)
    expect(body.success).toBe(true)
    expect(body.data.nodes).toHaveLength(2)
    expect(body.data.tree).toHaveLength(1)
    expect(body.data.tree[0].id).toBe('a')
    expect(body.data.tree[0].children[0].id).toBe('b')
    expect(body.data.tree[0].children[0].chainOfCommand).toEqual(['a'])
    expect(store.listOrgNodes).toHaveBeenCalledWith(ORG_ID)
  })

  it('requires an orgId for admin callers', async () => {
    const res = await orgRoute.GET(req('GET', '/api/v1/admin/agent-org'))
    expect(res.status).toBe(400)
    expect((await bodyOf(res)).error).toMatch(/orgId is required/i)
  })

  it('returns 409 when the stored nodes contain a cycle', async () => {
    const nodes = [makeNode({ id: 'a', reportsTo: 'b' }), makeNode({ id: 'b', reportsTo: 'a' })]
    ;(store.listOrgNodes as jest.Mock).mockResolvedValue(nodes)

    const res = await orgRoute.GET(req('GET', `/api/v1/admin/agent-org?orgId=${ORG_ID}`))
    expect(res.status).toBe(409)
  })

  it('forbids non-admin roles', async () => {
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'users') {
        return {
          doc: () => ({
            get: () =>
              Promise.resolve({
                exists: true,
                data: () => ({ role: 'client', orgId: ORG_ID, activeOrgId: ORG_ID }),
              }),
          }),
        }
      }
      return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
    })

    const res = await orgRoute.GET(req('GET', `/api/v1/admin/agent-org?orgId=${ORG_ID}`))
    expect(res.status).toBe(403)
  })
})

// ── POST ────────────────────────────────────────────────────────────────────

describe('POST /api/v1/admin/agent-org', () => {
  it('creates a node and returns 201 with defaulted fields', async () => {
    ;(store.listOrgNodes as jest.Mock).mockResolvedValue([])
    const created = makeNode({ id: 'alice', name: 'Alice', title: 'Coordinator', reportsTo: null })
    ;(store.createOrgNode as jest.Mock).mockResolvedValue({ ok: true, node: created })

    const res = await orgRoute.POST(
      req('POST', '/api/v1/admin/agent-org', { orgId: ORG_ID, name: 'Alice', title: 'Coordinator' }),
    )
    expect(res.status).toBe(201)
    const body = await bodyOf(res)
    expect(body.success).toBe(true)
    expect(body.data.node.id).toBe('alice')
    expect(store.createOrgNode).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: ORG_ID,
        id: 'alice',
        name: 'Alice',
        title: 'Coordinator',
        reportsTo: null,
        agentId: null,
        capabilities: [],
        defaultModel: null,
        defaultEffort: null,
        status: 'active',
        iconKey: 'smart_toy',
        colorKey: 'sky',
      }),
    )
    expect(store.persistChains).toHaveBeenCalledWith(ORG_ID, expect.any(Array))
  })

  it('rejects a self-report (cycle) before creating', async () => {
    ;(store.listOrgNodes as jest.Mock).mockResolvedValue([])

    const res = await orgRoute.POST(
      req('POST', '/api/v1/admin/agent-org', { orgId: ORG_ID, id: 'x', name: 'X', title: 'X', reportsTo: 'x' }),
    )
    expect(res.status).toBe(400)
    expect((await bodyOf(res)).error).toMatch(/report to itself/i)
    expect(store.createOrgNode).not.toHaveBeenCalled()
  })

  it('rejects a reportsTo referencing a missing parent', async () => {
    ;(store.listOrgNodes as jest.Mock).mockResolvedValue([makeNode({ id: 'a', reportsTo: null })])

    const res = await orgRoute.POST(
      req('POST', '/api/v1/admin/agent-org', { orgId: ORG_ID, id: 'x', name: 'X', title: 'X', reportsTo: 'ghost' }),
    )
    expect(res.status).toBe(400)
    expect((await bodyOf(res)).error).toMatch(/not found/i)
    expect(store.createOrgNode).not.toHaveBeenCalled()
  })

  it('normalises invalid defaultModel / defaultEffort to null and caps capabilities', async () => {
    ;(store.listOrgNodes as jest.Mock).mockResolvedValue([])
    ;(store.createOrgNode as jest.Mock).mockResolvedValue({
      ok: true,
      node: makeNode({ id: 'bob', name: 'Bob', title: 'Dev' }),
    })

    const res = await orgRoute.POST(
      req('POST', '/api/v1/admin/agent-org', {
        orgId: ORG_ID,
        id: 'bob',
        name: 'Bob',
        title: 'Dev',
        defaultModel: 'not-a-real-model',
        defaultEffort: 'ludicrous',
        capabilities: ['one', 'two', 'three', 'one'],
      }),
    )
    expect(res.status).toBe(201)
    expect(store.createOrgNode).toHaveBeenCalledWith(
      expect.objectContaining({ defaultModel: null, defaultEffort: null, capabilities: ['one', 'two', 'three'] }),
    )
  })

  it('requires name and title', async () => {
    const res = await orgRoute.POST(req('POST', '/api/v1/admin/agent-org', { orgId: ORG_ID, name: 'Only Name' }))
    expect(res.status).toBe(400)
    expect((await bodyOf(res)).error).toMatch(/title is required/i)
  })

  it('requires an orgId', async () => {
    const res = await orgRoute.POST(
      req('POST', '/api/v1/admin/agent-org', { name: 'Alice', title: 'Coordinator' }),
    )
    expect(res.status).toBe(400)
    expect((await bodyOf(res)).error).toMatch(/orgId is required/i)
  })
})

// ── PATCH ───────────────────────────────────────────────────────────────────

describe('PATCH /api/v1/admin/agent-org/:nodeId', () => {
  const nodes = [
    makeNode({ id: 'a', name: 'Alpha', reportsTo: null }),
    makeNode({ id: 'b', name: 'Beta', reportsTo: 'a' }),
    makeNode({ id: 'c', name: 'Gamma', reportsTo: null }),
  ]

  it('rejects a reparent under the node\'s own descendant', async () => {
    ;(store.listOrgNodes as jest.Mock).mockResolvedValue(nodes)

    const res = await nodeRoute.PATCH(
      req('PATCH', '/api/v1/admin/agent-org/a', { orgId: ORG_ID, reportsTo: 'b' }),
      makeCtx('a'),
    )
    expect(res.status).toBe(400)
    expect((await bodyOf(res)).error).toMatch(/descendant/i)
    expect(store.updateOrgNode).not.toHaveBeenCalled()
  })

  it('rejects a self-report patch', async () => {
    ;(store.listOrgNodes as jest.Mock).mockResolvedValue(nodes)

    const res = await nodeRoute.PATCH(
      req('PATCH', '/api/v1/admin/agent-org/b', { orgId: ORG_ID, reportsTo: 'b' }),
      makeCtx('b'),
    )
    expect(res.status).toBe(400)
    expect((await bodyOf(res)).error).toMatch(/report to itself/i)
    expect(store.updateOrgNode).not.toHaveBeenCalled()
  })

  it('accepts a valid reparent and refreshes chains', async () => {
    ;(store.listOrgNodes as jest.Mock).mockResolvedValue(nodes)
    const updated = makeNode({ id: 'b', name: 'Beta', reportsTo: 'c' })
    ;(store.updateOrgNode as jest.Mock).mockResolvedValue({ ok: true, node: updated })

    const res = await nodeRoute.PATCH(
      req('PATCH', '/api/v1/admin/agent-org/b', { orgId: ORG_ID, reportsTo: 'c' }),
      makeCtx('b'),
    )
    expect(res.status).toBe(200)
    const body = await bodyOf(res)
    expect(body.data.node.reportsTo).toBe('c')
    expect(store.updateOrgNode).toHaveBeenCalledWith(ORG_ID, 'b', { reportsTo: 'c' })
    expect(store.persistChains).toHaveBeenCalledWith(ORG_ID, expect.any(Array))
    expect(body.data.tree).toHaveLength(2)
  })

  it('applies a partial update with only provided fields', async () => {
    ;(store.listOrgNodes as jest.Mock).mockResolvedValue(nodes)
    ;(store.updateOrgNode as jest.Mock).mockResolvedValue({
      ok: true,
      node: makeNode({ id: 'b', name: 'Beta Two', title: 'Lead' }),
    })

    const res = await nodeRoute.PATCH(
      req('PATCH', '/api/v1/admin/agent-org/b', { orgId: ORG_ID, name: 'Beta Two', title: 'Lead' }),
      makeCtx('b'),
    )
    expect(res.status).toBe(200)
    expect(store.updateOrgNode).toHaveBeenCalledWith(ORG_ID, 'b', { name: 'Beta Two', title: 'Lead' })
  })

  it('returns 404 for an unknown node', async () => {
    ;(store.listOrgNodes as jest.Mock).mockResolvedValue(nodes)

    const res = await nodeRoute.PATCH(
      req('PATCH', '/api/v1/admin/agent-org/ghost', { orgId: ORG_ID, name: 'Ghost' }),
      makeCtx('ghost'),
    )
    expect(res.status).toBe(404)
  })

  it('rejects empty name / title patches', async () => {
    ;(store.listOrgNodes as jest.Mock).mockResolvedValue(nodes)

    const res = await nodeRoute.PATCH(
      req('PATCH', '/api/v1/admin/agent-org/b', { orgId: ORG_ID, name: '   ' }),
      makeCtx('b'),
    )
    expect(res.status).toBe(400)
    expect((await bodyOf(res)).error).toMatch(/name cannot be empty/i)
  })
})

// ── DELETE ──────────────────────────────────────────────────────────────────

describe('DELETE /api/v1/admin/agent-org/:nodeId', () => {
  const nodes = [
    makeNode({ id: 'a', name: 'Alpha', reportsTo: null }),
    makeNode({ id: 'b', name: 'Beta', reportsTo: 'a' }),
    makeNode({ id: 'c', name: 'Gamma', reportsTo: 'b' }),
  ]

  beforeEach(() => {
    ;(store.listOrgNodes as jest.Mock).mockResolvedValue(nodes)
    ;(store.deleteOrgNode as jest.Mock).mockResolvedValue({ ok: true })
    ;(store.updateOrgNode as jest.Mock).mockResolvedValue({
      ok: true,
      node: makeNode({ id: 'c', reportsTo: 'a' }),
    })
  })

  it('blocks deleting a node that still has reports', async () => {
    const res = await nodeRoute.DELETE(req('DELETE', `/api/v1/admin/agent-org/b?orgId=${ORG_ID}`), makeCtx('b'))
    expect(res.status).toBe(409)
    expect((await bodyOf(res)).error).toMatch(/still has reports/i)
    expect(store.deleteOrgNode).not.toHaveBeenCalled()
  })

  it('force-deletes and reparents children to the deleted node\'s parent', async () => {
    const res = await nodeRoute.DELETE(
      req('DELETE', `/api/v1/admin/agent-org/b?orgId=${ORG_ID}&force=true`),
      makeCtx('b'),
    )
    expect(res.status).toBe(200)
    expect((await bodyOf(res)).data).toEqual({ deleted: true })
    expect(store.updateOrgNode).toHaveBeenCalledWith(ORG_ID, 'c', { reportsTo: 'a' })
    expect(store.deleteOrgNode).toHaveBeenCalledWith(ORG_ID, 'b')
  })

  it('deletes a leaf node without force', async () => {
    const res = await nodeRoute.DELETE(req('DELETE', `/api/v1/admin/agent-org/c?orgId=${ORG_ID}`), makeCtx('c'))
    expect(res.status).toBe(200)
    expect((await bodyOf(res)).data).toEqual({ deleted: true })
    expect(store.deleteOrgNode).toHaveBeenCalledWith(ORG_ID, 'c')
    expect(store.updateOrgNode).not.toHaveBeenCalled()
  })

  it('returns 404 for an unknown node', async () => {
    const res = await nodeRoute.DELETE(
      req('DELETE', `/api/v1/admin/agent-org/ghost?orgId=${ORG_ID}`),
      makeCtx('ghost'),
    )
    expect(res.status).toBe(404)
  })
})

// ── SEED ────────────────────────────────────────────────────────────────────

describe('POST /api/v1/admin/agent-org/seed', () => {
  it('seeds and reports created count', async () => {
    ;(seed.seedOrgChart as jest.Mock).mockResolvedValue({ ok: true, created: 14, skipped: false })

    const res = await seedRoute.POST(req('POST', '/api/v1/admin/agent-org/seed', { orgId: ORG_ID }))
    expect(res.status).toBe(200)
    expect((await bodyOf(res)).data).toEqual({ created: 14, skipped: false, template: null })
    expect(seed.seedOrgChart).toHaveBeenCalledWith(ORG_ID, { template: undefined })
  })

  it('is idempotent — a second seed is skipped', async () => {
    ;(seed.seedOrgChart as jest.Mock)
      .mockResolvedValueOnce({ ok: true, created: 14, skipped: false })
      .mockResolvedValueOnce({ ok: true, created: 0, skipped: true })

    await seedRoute.POST(req('POST', '/api/v1/admin/agent-org/seed', { orgId: ORG_ID }))
    const res = await seedRoute.POST(req('POST', '/api/v1/admin/agent-org/seed', { orgId: ORG_ID }))
    expect(res.status).toBe(200)
    expect((await bodyOf(res)).data).toEqual({ created: 0, skipped: true, template: null })
    expect(seed.seedOrgChart).toHaveBeenCalledTimes(2)
  })

  it('requires an orgId', async () => {
    const res = await seedRoute.POST(req('POST', '/api/v1/admin/agent-org/seed', {}))
    expect(res.status).toBe(400)
    expect((await bodyOf(res)).error).toMatch(/orgId is required/i)
  })
})
