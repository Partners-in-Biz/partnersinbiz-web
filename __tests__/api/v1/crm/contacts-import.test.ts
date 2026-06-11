import { NextRequest } from 'next/server'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn() },
  adminDb: {
    collection: jest.fn(),
    batch: jest.fn(),
  },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => '__SERVER_TIMESTAMP__',
    increment: (n: number) => ({ __increment: n }),
  },
}))

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { POST } from '@/app/api/v1/crm/contacts/import/route'
import { seedOrgMember, callAsMember } from '../../../helpers/crm'
import { makePortalAuthCollections } from '../../../helpers/firebase-admin'

const AI_API_KEY = 'test-ai-key-abc'
process.env.AI_API_KEY = AI_API_KEY
process.env.SESSION_COOKIE_NAME = '__session'

// ---------------------------------------------------------------------------
// stageAuthWithBatch — wires up withCrmAuth cookie path + adminDb.batch
// ---------------------------------------------------------------------------

function stageAuthWithBatch(
  member: { uid: string; orgId: string; role: string; firstName?: string; lastName?: string },
  opts?: {
    captureSourceId?: string
    existingContactsByEmail?: Record<string, { id: string; data: Record<string, unknown> }>
  },
) {
  const batchSetCalls: Array<{ ref: unknown; data: Record<string, unknown> }> = []
  const batchUpdateCalls: Array<{ ref: unknown; data: Record<string, unknown> }> = []
  const batchCommit = jest.fn().mockResolvedValue(undefined)

  ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })
  const authCollections = makePortalAuthCollections(member)

  // Override adminDb.batch for this call
  ;(adminDb.batch as jest.Mock).mockReturnValue({
    set: (ref: unknown, data: Record<string, unknown>) => batchSetCalls.push({ ref, data }),
    update: (ref: unknown, data: Record<string, unknown>) => batchUpdateCalls.push({ ref, data }),
    commit: batchCommit,
  })

  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    if (name in authCollections) return authCollections[name as keyof typeof authCollections]
    if (name === 'users') {
      return {
        doc: () => ({
          get: () =>
            Promise.resolve({
              exists: true,
              data: () => ({ activeOrgId: member.orgId }),
            }),
        }),
      }
    }
    if (name === 'orgMembers') {
      return {
        doc: () => ({
          get: () =>
            Promise.resolve({
              exists: true,
              data: () => member,
            }),
        }),
      }
    }
    if (name === 'organizations') {
      return {
        doc: () => ({
          get: () =>
            Promise.resolve({
              exists: true,
              data: () => ({ settings: { permissions: {} } }),
            }),
        }),
      }
    }
    if (name === 'contacts') {
      const byEmail = opts?.existingContactsByEmail ?? {}
      return {
        doc: jest.fn().mockImplementation((id?: string) => ({
          id: id ?? `contact-${Math.random().toString(36).slice(2, 8)}`,
        })),
        where: jest.fn().mockImplementation((_field: string, _op: string, _value: unknown) => ({
          where: jest.fn().mockImplementation((_field2: string, _op2: string, value2: unknown) => ({
            get: jest.fn().mockResolvedValue({
              docs: Array.isArray(value2)
                ? (value2 as string[])
                    .filter((e) => byEmail[e])
                    .map((e) => ({
                      id: byEmail[e].id,
                      data: () => byEmail[e].data,
                      ref: { id: byEmail[e].id },
                    }))
                : [],
            }),
          })),
        })),
      }
    }
    if (name === 'capture_sources') {
      return {
        doc: jest.fn().mockReturnValue({
          id: opts?.captureSourceId ?? 'src-1',
          get: () =>
            Promise.resolve({
              exists: opts?.captureSourceId != null,
              data: () => ({}),
            }),
        }),
      }
    }
    return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
  })

  return { batchSetCalls, batchUpdateCalls, batchCommit }
}

// ---------------------------------------------------------------------------
// Legacy state-based mock — for existing rich tests
// ---------------------------------------------------------------------------

interface MockBatch {
  set: jest.Mock
  update: jest.Mock
  commit: jest.Mock
}

interface MockState {
  batches: MockBatch[]
  captureSourceDoc?: {
    exists: boolean
    data?: Record<string, unknown>
  }
  captureSourceRefUpdate: jest.Mock
  existingByEmail: Map<string, { id: string; data: Record<string, unknown> }>
  contactDocRefs: Array<{ id: string }>
  contactDocCounter: number
}

let state: MockState

function setupLegacyMocks(orgId = 'org-1') {
  state = {
    batches: [],
    captureSourceDoc: { exists: false },
    captureSourceRefUpdate: jest.fn().mockResolvedValue(undefined),
    existingByEmail: new Map(),
    contactDocRefs: [],
    contactDocCounter: 0,
  }

  const member = seedOrgMember(orgId, 'uid-legacy', { role: 'member' })
  ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })
  const authCollections = makePortalAuthCollections(member)

  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    if (name in authCollections) return authCollections[name as keyof typeof authCollections]
    if (name === 'users') {
      return {
        doc: () => ({
          get: () =>
            Promise.resolve({
              exists: true,
              data: () => ({ activeOrgId: orgId }),
            }),
        }),
      }
    }
    if (name === 'orgMembers') {
      return {
        doc: () => ({
          get: () =>
            Promise.resolve({
              exists: true,
              data: () => member,
            }),
        }),
      }
    }
    if (name === 'organizations') {
      return {
        doc: () => ({
          get: () =>
            Promise.resolve({
              exists: true,
              data: () => ({ settings: { permissions: {} } }),
            }),
        }),
      }
    }
    if (name === 'capture_sources') {
      return {
        doc: jest.fn().mockImplementation(() => ({
          get: jest.fn().mockResolvedValue({
            exists: state.captureSourceDoc!.exists,
            data: () => state.captureSourceDoc!.data ?? {},
            ref: { update: state.captureSourceRefUpdate },
          }),
        })),
      }
    }
    if (name === 'contacts') {
      return {
        where: jest.fn().mockImplementation(function (_field: string, _op: string, _value: unknown) {
          return {
            where: jest.fn().mockImplementation((field2: string, op2: string, value2: unknown) => ({
              get: jest.fn().mockImplementation(async () => {
                if (field2 === 'email' && op2 === 'in' && Array.isArray(value2)) {
                  const docs = (value2 as string[])
                    .map((email) => state.existingByEmail.get(email))
                    .filter((v): v is { id: string; data: Record<string, unknown> } => !!v)
                    .map((entry) => ({
                      id: entry.id,
                      data: () => entry.data,
                      ref: { id: entry.id, __kind: 'existing-contact' },
                    }))
                  return { docs }
                }
                return { docs: [] }
              }),
            })),
          }
        }),
        doc: jest.fn().mockImplementation(() => {
          state.contactDocCounter += 1
          const ref = { id: `new-contact-${state.contactDocCounter}`, __kind: 'new-contact' }
          state.contactDocRefs.push(ref)
          return ref
        }),
      }
    }
    return {}
  })

  ;(adminDb.batch as jest.Mock).mockImplementation(() => {
    const b: MockBatch = {
      set: jest.fn(),
      update: jest.fn(),
      commit: jest.fn().mockResolvedValue(undefined),
    }
    state.batches.push(b)
    return b
  })
}

function totalBatchOps(): { sets: number; updates: number } {
  let sets = 0
  let updates = 0
  for (const b of state.batches) {
    sets += b.set.mock.calls.length
    updates += b.update.mock.calls.length
  }
  return { sets, updates }
}

// Build a member-cookie request for the legacy tests (orgId comes from member's activeOrgId, not body)
function makeReqAsMember(body: unknown, orgId = 'org-1') {
  const member = seedOrgMember(orgId, 'uid-legacy', { role: 'member' })
  return callAsMember(member, 'POST', '/api/v1/crm/contacts/import', body)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/v1/crm/contacts/import', () => {
  beforeEach(() => {
    setupLegacyMocks()
  })

  it('rejects empty rows', async () => {
    const req = makeReqAsMember({ rows: [] })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/empty|array/i)
  })

  it('rejects rows that are not an array', async () => {
    const req = makeReqAsMember({ rows: 'nope' })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('reports invalid rows with reasons but processes valid ones', async () => {
    const req = makeReqAsMember({
      rows: [
        { email: 'good@example.com', name: 'Good' },
        { email: 'not-an-email' },
        { email: '' },
        {},
      ],
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.created).toBe(1)
    expect(body.data.skipped).toBe(3)
    expect(body.data.invalidRows).toHaveLength(3)
    const reasons = body.data.invalidRows.map((r: { reason: string }) => r.reason)
    expect(reasons).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/invalid/i),
        expect.stringMatching(/required/i),
      ]),
    )
  })

  it('dryRun mode does not call batch set or update', async () => {
    const req = makeReqAsMember({
      dryRun: true,
      rows: [
        { email: 'a@example.com', name: 'A' },
        { email: 'b@example.com', name: 'B' },
      ],
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.created).toBe(2)
    expect(body.data.updated).toBe(0)
    expect(body.data.previewSample).toBeDefined()
    expect(body.data.previewSample.length).toBeGreaterThan(0)
    expect(state.batches.length).toBe(0)
  })

  it('creates new contacts with import metadata', async () => {
    const req = makeReqAsMember({
      rows: [{ email: 'new@example.com', name: 'New', company: 'Acme', phone: '555' }],
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.created).toBe(1)
    expect(body.data.updated).toBe(0)

    const sets = state.batches.flatMap((b) => b.set.mock.calls)
    expect(sets).toHaveLength(1)
    const [, payload] = sets[0]
    expect(payload).toMatchObject({
      orgId: 'org-1',
      email: 'new@example.com',
      name: 'New',
      company: 'Acme',
      phone: '555',
      source: 'import',
      type: 'lead',
      stage: 'new',
      capturedFromId: '',
    })
    expect(payload.subscribedAt).toBe('__SERVER_TIMESTAMP__')
    expect(payload.unsubscribedAt).toBeNull()
    expect(payload.deleted).toBe(false)
  })

  it('merges tags onto existing contacts instead of duplicating', async () => {
    state.existingByEmail.set('exists@example.com', {
      id: 'existing-1',
      data: {
        orgId: 'org-1',
        email: 'exists@example.com',
        name: 'Already Here',
        tags: ['old-tag'],
      },
    })

    const req = makeReqAsMember({
      rows: [
        { email: 'exists@example.com', name: 'IGNORED', tags: ['fresh'] },
        { email: 'brand-new@example.com', name: 'New' },
      ],
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.created).toBe(1)
    expect(body.data.updated).toBe(1)

    const ops = totalBatchOps()
    expect(ops.sets).toBe(1)
    expect(ops.updates).toBe(1)

    const updateCalls = state.batches.flatMap((b) => b.update.mock.calls)
    expect(updateCalls).toHaveLength(1)
    const [, updatePayload] = updateCalls[0]
    expect(updatePayload.tags).toEqual(expect.arrayContaining(['old-tag', 'fresh']))
    expect(updatePayload.tags).toHaveLength(2)
    expect(updatePayload).not.toHaveProperty('name')
    expect(updatePayload).not.toHaveProperty('company')
  })

  it('skips no-op tag merges (existing contact with all tags already present)', async () => {
    state.existingByEmail.set('exists@example.com', {
      id: 'existing-1',
      data: {
        orgId: 'org-1',
        email: 'exists@example.com',
        tags: ['already-here'],
      },
    })

    const req = makeReqAsMember({
      rows: [{ email: 'exists@example.com', tags: ['already-here'] }],
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.created).toBe(0)
    expect(body.data.updated).toBe(0)
    expect(state.batches.length).toBe(0)
  })

  it('applies capture source autoTags and bumps capturedCount by created count only', async () => {
    state.captureSourceDoc = {
      exists: true,
      data: { orgId: 'org-1', autoTags: ['auto-1', 'auto-2'] },
    }
    state.existingByEmail.set('exists@example.com', {
      id: 'existing-1',
      data: { orgId: 'org-1', email: 'exists@example.com', tags: [] },
    })

    const req = makeReqAsMember({
      capturedFromId: 'src-1',
      rows: [
        { email: 'exists@example.com' }, // update
        { email: 'new1@example.com' },   // create
        { email: 'new2@example.com' },   // create
      ],
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.created).toBe(2)
    expect(body.data.updated).toBe(1)

    // capturedCount should bump by 2 (created), not 3
    // The bump lands in a separate final batch
    const allUpdateCalls = state.batches.flatMap((b) => b.update.mock.calls)
    const captureUpdate = allUpdateCalls.find(
      ([, p]: [unknown, Record<string, unknown>]) => p.capturedCount !== undefined,
    )
    expect(captureUpdate).toBeDefined()
    const [, bumpPayload] = captureUpdate!
    expect(bumpPayload.capturedCount).toEqual({ __increment: 2 })

    // New contacts should have autoTags applied
    const sets = state.batches.flatMap((b) => b.set.mock.calls)
    expect(sets).toHaveLength(2)
    for (const [, payload] of sets) {
      expect(payload.tags).toEqual(expect.arrayContaining(['auto-1', 'auto-2']))
      expect(payload.capturedFromId).toBe('src-1')
    }
  })

  it('ignores capture source from a different org', async () => {
    state.captureSourceDoc = {
      exists: true,
      data: { orgId: 'org-OTHER', autoTags: ['auto-1'] },
    }

    const req = makeReqAsMember({ capturedFromId: 'src-1', rows: [{ email: 'a@example.com' }] })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.created).toBe(1)

    const sets = state.batches.flatMap((b) => b.set.mock.calls)
    const [, payload] = sets[0]
    expect(payload.capturedFromId).toBe('')
    expect(payload.tags).not.toContain('auto-1')
  })

  it('rejects more than 5000 rows', async () => {
    const rows = Array.from({ length: 5001 }, (_, i) => ({
      email: `r${i}@example.com`,
    }))
    const req = makeReqAsMember({ rows })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('treats duplicate emails inside the same payload as invalid', async () => {
    const req = makeReqAsMember({
      rows: [
        { email: 'dupe@example.com' },
        { email: 'dupe@example.com' },
      ],
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.created).toBe(1)
    expect(body.data.skipped).toBe(1)
    expect(body.data.invalidRows[0].reason).toMatch(/duplicate/i)
  })
})

// ---------------------------------------------------------------------------
// Attribution tests (new — Pattern E + stageAuthWithBatch)
// ---------------------------------------------------------------------------

describe('POST /api/v1/crm/contacts/import — attribution', () => {
  it('writes createdByRef on each imported contact', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member', firstName: 'Alice', lastName: 'B' })
    const { batchSetCalls } = stageAuthWithBatch(member)
    const req = callAsMember(member, 'POST', '/api/v1/crm/contacts/import', {
      contacts: [
        { name: 'A', email: 'a@y.com' },
        { name: 'B', email: 'b@y.com' },
      ],
    })
    const res = await POST(req)
    expect(res.status).toBeLessThan(300)
    const contactWrites = batchSetCalls.filter((c) => c.data?.email !== undefined)
    expect(contactWrites.length).toBeGreaterThanOrEqual(2)
    for (const write of contactWrites) {
      expect(write.data.createdByRef).toMatchObject({ displayName: 'Alice B', kind: 'human' })
      expect(write.data.updatedByRef).toMatchObject({ displayName: 'Alice B', kind: 'human' })
      expect(write.data.createdBy).toBe('uid-1')
    }
  })

  it('returns 401 without auth', async () => {
    const req = new NextRequest('http://localhost/api/v1/crm/contacts/import', {
      method: 'POST',
      body: JSON.stringify({ rows: [] }),
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('returns 403 when viewer tries to POST', async () => {
    const member = seedOrgMember('org-1', 'uid-viewer', { role: 'viewer' })
    stageAuthWithBatch(member)
    const req = callAsMember(member, 'POST', '/api/v1/crm/contacts/import', {
      rows: [{ email: 'a@example.com' }],
    })
    const res = await POST(req)
    expect(res.status).toBe(403)
  })
})
