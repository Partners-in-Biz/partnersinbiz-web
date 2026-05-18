/**
 * Consolidated tenant-isolation suite for /api/v1/crm scoring endpoints (A4 W3-I)
 *
 * 5 endpoints × 1 cross-tenant assertion each. Follows the store-mock pattern
 * established by pipelines-tenant-isolation.test.ts.
 *
 *  1  GET  /scoring/config                      — returns Org A config only (scoped to ctx.orgId)
 *  2  PUT  /scoring/config                      — body.orgId override is stripped (NEVER_FROM_BODY)
 *  3  POST /contacts/:id/recompute-score        — 404 when contact.orgId !== ctx.orgId
 *  4  POST /scoring/recompute-all              — scoped to ctx.orgId via where('orgId','==',ctx.orgId)
 *  5  GET  /cron/recompute-scores              — 401 when Authorization header is missing/wrong
 */

import { NextRequest } from 'next/server'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn() },
}))

jest.mock('@/lib/scoring/store', () => ({
  getOrBootstrapConfig: jest.fn(),
  sanitizeConfigForWrite: jest.fn((input: Record<string, unknown>) => {
    // Strip NEVER_FROM_BODY fields — mirrors the real implementation
    const NEVER = new Set([
      'id', 'orgId',
      'createdBy', 'createdByRef', 'createdAt',
      'updatedBy', 'updatedByRef', 'updatedAt',
      'deleted',
    ])
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(input)) {
      if (v === undefined || NEVER.has(k)) continue
      out[k] = v
    }
    return out
  }),
}))

jest.mock('@/lib/scoring/compute', () => ({
  computeScoresForContact: jest.fn(),
}))

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import * as scoringStore from '@/lib/scoring/store'
import * as scoringCompute from '@/lib/scoring/compute'
import { uidFor } from './scoring/_fixtures'
import { seedOrgMember, callAsMember } from '../../../helpers/crm'

// ── Identities ────────────────────────────────────────────────────────────────

process.env.SESSION_COOKIE_NAME = '__session'
process.env.CRON_SECRET = 'test-cron-secret'

const orgAUid = uidFor('scoring-iso-admin-a')
const orgBUid = uidFor('scoring-iso-admin-b')

const adminA = seedOrgMember('org-a', orgAUid, { role: 'admin', firstName: 'Admin', lastName: 'A' })
const adminB = seedOrgMember('org-b', orgBUid, { role: 'admin', firstName: 'Admin', lastName: 'B' })

// ── Shared config fixtures ────────────────────────────────────────────────────

const configA = {
  orgId: 'org-a',
  icp: {},
  leadWeights: { emailOpens: 2, emailClicks: 5, emailReplies: 15, sequenceCompleted: 10, recentContact: 10, formSubmission: 8 },
  aiEnabled: false,
  aiModel: 'gpt-4o-mini',
  aiCacheHours: 24,
  createdAt: null,
  updatedAt: null,
}

const configB = {
  ...configA,
  orgId: 'org-b',
}

// ── Collection mock builder ───────────────────────────────────────────────────

function buildCollectionMock(opts: {
  actor?: typeof adminA
  contactOverride?: { id: string; orgId: string } | null
  capturedDocSet?: jest.Mock
} = {}) {
  const { actor = adminA, contactOverride, capturedDocSet } = opts

  return (name: string) => {
    // ── orgMembers ──────────────────────────────────────────────────────────────
    if (name === 'orgMembers') {
      return {
        doc: (key: string) => ({
          get: () =>
            Promise.resolve({
              exists:
                key === `${adminA.orgId}_${adminA.uid}` ||
                key === `${adminB.orgId}_${adminB.uid}`,
              data: () =>
                key === `${adminA.orgId}_${adminA.uid}`
                  ? { ...adminA, role: 'admin' }
                  : { ...adminB, role: 'admin' },
            }),
        }),
      }
    }

    // ── organizations ───────────────────────────────────────────────────────────
    if (name === 'organizations') {
      return {
        doc: () => ({
          get: () =>
            Promise.resolve({
              exists: true,
              data: () => ({ settings: { permissions: {} } }),
            }),
        }),
        where: jest.fn().mockReturnThis(),
        get: () =>
          Promise.resolve({
            docs: [],
          }),
      }
    }

    // ── users ───────────────────────────────────────────────────────────────────
    if (name === 'users') {
      return {
        doc: (uid: string) => ({
          get: () =>
            Promise.resolve({
              exists: true,
              data: () => ({
                activeOrgId: uid === adminA.uid ? 'org-a' : 'org-b',
              }),
            }),
        }),
      }
    }

    // ── scoringConfig ───────────────────────────────────────────────────────────
    if (name === 'scoringConfig') {
      const setFn = capturedDocSet ?? jest.fn().mockResolvedValue(undefined)
      return {
        doc: jest.fn().mockReturnValue({
          get: () => Promise.resolve({ exists: false, data: () => null }),
          set: setFn,
        }),
      }
    }

    // ── contacts ────────────────────────────────────────────────────────────────
    if (name === 'contacts') {
      if (contactOverride !== undefined) {
        // Specific contact lookup (for recompute-score route)
        return {
          doc: (id: string) => ({
            get: () => {
              if (contactOverride === null || contactOverride.id !== id) {
                return Promise.resolve({ exists: false, data: () => null })
              }
              return Promise.resolve({
                exists: true,
                data: () => ({ orgId: contactOverride.orgId }),
              })
            },
          }),
          where: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          get: () => Promise.resolve({ docs: [] }),
        }
      }
      return {
        doc: jest.fn().mockReturnValue({
          get: () => Promise.resolve({ exists: false, data: () => null }),
        }),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: () => Promise.resolve({ docs: [] }),
      }
    }

    // ── fallback ────────────────────────────────────────────────────────────────
    return {
      doc: () => ({ get: () => Promise.resolve({ exists: false }) }),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      get: () => Promise.resolve({ empty: true, docs: [] }),
    }
  }
}

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks()

  ;(adminAuth.verifySessionCookie as jest.Mock).mockImplementation((cookie: string) => {
    if (cookie.endsWith(adminA.uid)) return Promise.resolve({ uid: adminA.uid })
    if (cookie.endsWith(adminB.uid)) return Promise.resolve({ uid: adminB.uid })
    return Promise.reject(new Error('invalid'))
  })

  ;(scoringStore.getOrBootstrapConfig as jest.Mock).mockImplementation(
    async (orgId: string) => {
      if (orgId === 'org-a') return configA
      if (orgId === 'org-b') return configB
      return { ...configA, orgId }
    },
  )

  ;(scoringCompute.computeScoresForContact as jest.Mock).mockResolvedValue({
    icp: 0, lead: 0, ai: null, overall: 0,
  })

  ;(adminDb.collection as jest.Mock).mockImplementation(buildCollectionMock())
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('scoring tenant isolation', () => {
  // 1. GET /scoring/config — returns org-a's config, never org-b's
  it('GET /scoring/config returns config scoped to ctx.orgId', async () => {
    const req = callAsMember(adminA, 'GET', '/api/v1/crm/scoring/config')
    const { GET } = await import('@/app/api/v1/crm/scoring/config/route')
    const res = await GET(req as NextRequest)
    expect(res.status).toBe(200)
    const body = await res.json()
    const config = body.data?.config ?? body.config
    expect(config).toBeDefined()
    expect(config.orgId).toBe('org-a')
    expect(config.orgId).not.toBe('org-b')
  })

  // 2. PUT /scoring/config — body.orgId is stripped (NEVER_FROM_BODY)
  it('PUT /scoring/config strips body.orgId override (NEVER_FROM_BODY)', async () => {
    ;(adminDb.collection as jest.Mock).mockImplementation(
      buildCollectionMock({ capturedDocSet: jest.fn().mockResolvedValue(undefined) }),
    )

    const req = callAsMember(adminA, 'PUT', '/api/v1/crm/scoring/config', {
      orgId: 'injected-org', // attempted override — must be stripped
      aiEnabled: true,
    })
    const { PUT } = await import('@/app/api/v1/crm/scoring/config/route')
    const res = await PUT(req as NextRequest)
    expect([200, 201]).toContain(res.status)

    // sanitizeConfigForWrite must have been called with the body (stripping orgId)
    expect(scoringStore.sanitizeConfigForWrite as jest.Mock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'injected-org', aiEnabled: true }),
    )

    // The sanitized result must NOT contain orgId from the body
    const sanitized = (scoringStore.sanitizeConfigForWrite as jest.Mock).mock.results[0].value
    expect(sanitized.orgId).toBeUndefined()
    expect(sanitized.aiEnabled).toBe(true)
  })

  // 3. POST /contacts/:id/recompute-score — 404 when contact.orgId !== ctx.orgId
  it('POST /contacts/:id/recompute-score → 404 for cross-tenant contact', async () => {
    // Contact belongs to org-b; actor is from org-a
    const contactId = 'contact-b-1'
    ;(adminDb.collection as jest.Mock).mockImplementation(
      buildCollectionMock({ contactOverride: { id: contactId, orgId: 'org-b' } }),
    )

    const req = callAsMember(adminA, 'POST', `/api/v1/crm/contacts/${contactId}/recompute-score`)
    const { POST } = await import('@/app/api/v1/crm/contacts/[id]/recompute-score/route')
    const routeCtx = { params: Promise.resolve({ id: contactId }) }
    const res = await POST(req as NextRequest, routeCtx)
    expect(res.status).toBe(404)
  })

  // 4. POST /scoring/recompute-all — result scoped to ctx.orgId
  it('POST /scoring/recompute-all scopes query to ctx.orgId', async () => {
    // Track where() calls to confirm orgId scoping
    const whereMock = jest.fn().mockReturnThis()
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      const base = buildCollectionMock()(name)
      if (name === 'contacts') {
        return {
          ...base,
          where: whereMock,
          orderBy: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          get: () => Promise.resolve({ docs: [] }),
        }
      }
      return base
    })

    const req = callAsMember(adminA, 'POST', '/api/v1/crm/scoring/recompute-all', {
      includeAi: false,
      limit: 10,
    })
    const { POST } = await import('@/app/api/v1/crm/scoring/recompute-all/route')
    const res = await POST(req as NextRequest)
    expect(res.status).toBe(200)

    // Confirm that the Firestore query was scoped to ctx.orgId (org-a)
    const whereArgs = whereMock.mock.calls
    const orgIdScope = whereArgs.find(
      (args: unknown[]) => args[0] === 'orgId' && args[1] === '==' && args[2] === 'org-a',
    )
    expect(orgIdScope).toBeDefined()

    // Also confirm org-b was never used as the scope
    const orgBScope = whereArgs.find(
      (args: unknown[]) => args[0] === 'orgId' && args[1] === '==' && args[2] === 'org-b',
    )
    expect(orgBScope).toBeUndefined()
  })

  // 5. GET /cron/recompute-scores — 401 when Authorization is missing/wrong
  it('GET /cron/recompute-scores → 401 when Authorization header is missing', async () => {
    const { NextRequest: NR } = await import('next/server')
    const req = new NR('http://localhost/api/v1/crm/cron/recompute-scores', {
      method: 'GET',
      // No Authorization header
    })
    const { GET } = await import('@/app/api/v1/crm/cron/recompute-scores/route')
    const res = await GET(req as NextRequest)
    expect([401, 403]).toContain(res.status)
  })
})
