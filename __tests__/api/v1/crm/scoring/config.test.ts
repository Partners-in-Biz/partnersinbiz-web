/**
 * Tests for GET/PUT /api/v1/crm/scoring/config (A4 W2-D)
 *
 * ~8 tests:
 *  1  GET happy — bootstraps defaults if Firestore doc absent
 *  2  GET cross-tenant — store always returns ctx.orgId scoped config (no leak)
 *  3  PUT happy — sanitized body merged + returned
 *  4  PUT empty body → 400
 *  5  PUT 403 for viewer role
 *  6  PUT NEVER_FROM_BODY strips orgId override
 *  7  PUT first-write stamps createdAt
 *  8  PUT subsequent-write preserves existing createdAt (not re-stamped)
 */

import { NextRequest } from 'next/server'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn() },
}))

jest.mock('@/lib/scoring/store', () => ({
  getOrBootstrapConfig: jest.fn(),
  sanitizeConfigForWrite: jest.fn(),
}))

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { getOrBootstrapConfig, sanitizeConfigForWrite } from '@/lib/scoring/store'
import { seedOrgMember, callAsMember } from '../../../../helpers/crm'
import { buildConfig, uidFor } from './_fixtures'

process.env.AI_API_KEY = 'test-ai-key'
process.env.SESSION_COOKIE_NAME = '__session'

// ---------------------------------------------------------------------------
// stageAuth helper
// ---------------------------------------------------------------------------

function stageAuth(
  member: { uid: string; orgId: string; role: string; firstName?: string; lastName?: string },
  opts: {
    scoringConfigDoc?: { exists: boolean; data?: () => Record<string, unknown>; set?: jest.Mock }
  } = {},
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
    if (name === 'scoringConfig') {
      const setMock = opts.scoringConfigDoc?.set ?? jest.fn().mockResolvedValue(undefined)
      const existsVal = opts.scoringConfigDoc?.exists ?? false
      const dataVal = opts.scoringConfigDoc?.data ?? (() => ({}))
      return {
        doc: () => ({
          get: () => Promise.resolve({ exists: existsVal, data: dataVal }),
          set: setMock,
        }),
      }
    }
    return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
  })
}

// ---------------------------------------------------------------------------
// Route import (after mocks)
// ---------------------------------------------------------------------------

import { GET, PUT } from '@/app/api/v1/crm/scoring/config/route'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const adminUid = uidFor('admin')
const viewerUid = uidFor('viewer')
const adminA = seedOrgMember('org-a', adminUid, { role: 'admin', firstName: 'Admin', lastName: 'A' })
const viewerA = seedOrgMember('org-a', viewerUid, { role: 'viewer', firstName: 'Viewer', lastName: 'A' })

const defaultConfig = buildConfig({ orgId: 'org-a', createdAt: null, updatedAt: null })

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/v1/crm/scoring/config', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns bootstrapped defaults when Firestore doc is absent', async () => {
    stageAuth(adminA)
    ;(getOrBootstrapConfig as jest.Mock).mockResolvedValue(defaultConfig)

    const req = callAsMember(adminA, 'GET', '/api/v1/crm/scoring/config')
    const res = await GET(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.config.orgId).toBe('org-a')
    expect(body.data.config.aiEnabled).toBe(false)
  })

  it('is accessible by viewers (viewer role)', async () => {
    stageAuth(viewerA)
    ;(getOrBootstrapConfig as jest.Mock).mockResolvedValue(defaultConfig)

    const req = callAsMember(viewerA, 'GET', '/api/v1/crm/scoring/config')
    const res = await GET(req)

    expect(res.status).toBe(200)
  })

  it('returns config scoped to the callers orgId — store is called with orgId', async () => {
    stageAuth(adminA)
    ;(getOrBootstrapConfig as jest.Mock).mockResolvedValue(defaultConfig)

    const req = callAsMember(adminA, 'GET', '/api/v1/crm/scoring/config')
    await GET(req)

    expect(getOrBootstrapConfig).toHaveBeenCalledWith('org-a')
  })
})

describe('PUT /api/v1/crm/scoring/config', () => {
  beforeEach(() => jest.clearAllMocks())

  it('403 for viewer role', async () => {
    stageAuth(viewerA)

    const req = callAsMember(viewerA, 'PUT', '/api/v1/crm/scoring/config', { aiEnabled: true })
    const res = await PUT(req)

    expect(res.status).toBe(403)
  })

  it('400 for empty body', async () => {
    stageAuth(adminA)

    const { NextRequest } = require('next/server')
    const req = new NextRequest('http://localhost/api/v1/crm/scoring/config', {
      method: 'PUT',
      headers: new Headers({ cookie: `__session=test-session-${adminA.uid}`, 'content-type': 'application/json' }),
      body: '',
    })
    const res = await PUT(req)

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.success).toBe(false)
  })

  it('400 for body that is empty object', async () => {
    stageAuth(adminA)

    const req = callAsMember(adminA, 'PUT', '/api/v1/crm/scoring/config', {})
    const res = await PUT(req)

    expect(res.status).toBe(400)
  })

  it('happy path — returns merged config', async () => {
    const setCaptured: jest.Mock = jest.fn().mockResolvedValue(undefined)
    stageAuth(adminA, {
      scoringConfigDoc: { exists: true, data: () => ({ aiEnabled: false }), set: setCaptured },
    })
    ;(sanitizeConfigForWrite as jest.Mock).mockReturnValue({ aiEnabled: true })
    const updatedConfig = buildConfig({ aiEnabled: true })
    ;(getOrBootstrapConfig as jest.Mock).mockResolvedValue(updatedConfig)

    const req = callAsMember(adminA, 'PUT', '/api/v1/crm/scoring/config', { aiEnabled: true })
    const res = await PUT(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.config.aiEnabled).toBe(true)
    expect(setCaptured).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-a', aiEnabled: true }),
      { merge: true },
    )
  })

  it('NEVER_FROM_BODY strips orgId override — sanitizeConfigForWrite is called', async () => {
    const setCaptured: jest.Mock = jest.fn().mockResolvedValue(undefined)
    stageAuth(adminA, {
      scoringConfigDoc: { exists: true, data: () => ({}), set: setCaptured },
    })
    // sanitize strips orgId from attacker payload
    ;(sanitizeConfigForWrite as jest.Mock).mockReturnValue({ aiEnabled: true })
    ;(getOrBootstrapConfig as jest.Mock).mockResolvedValue(buildConfig())

    const req = callAsMember(adminA, 'PUT', '/api/v1/crm/scoring/config', {
      orgId: 'org-evil',
      aiEnabled: true,
    })
    await PUT(req)

    expect(sanitizeConfigForWrite).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-evil' }),
    )
    // The write payload always uses ctx.orgId, not what the body said
    const writeArg = setCaptured.mock.calls[0][0]
    expect(writeArg.orgId).toBe('org-a')
  })

  it('first write stamps createdAt', async () => {
    const setCaptured: jest.Mock = jest.fn().mockResolvedValue(undefined)
    stageAuth(adminA, {
      scoringConfigDoc: { exists: false, set: setCaptured },
    })
    ;(sanitizeConfigForWrite as jest.Mock).mockReturnValue({ aiEnabled: false })
    ;(getOrBootstrapConfig as jest.Mock).mockResolvedValue(buildConfig())

    const req = callAsMember(adminA, 'PUT', '/api/v1/crm/scoring/config', { aiEnabled: false })
    await PUT(req)

    expect(setCaptured).toHaveBeenCalledWith(
      expect.objectContaining({ createdAt: expect.anything(), createdBy: adminA.uid }),
      { merge: true },
    )
  })

  it('subsequent write does NOT re-stamp createdAt', async () => {
    const setCaptured: jest.Mock = jest.fn().mockResolvedValue(undefined)
    stageAuth(adminA, {
      scoringConfigDoc: { exists: true, data: () => ({ aiEnabled: false }), set: setCaptured },
    })
    ;(sanitizeConfigForWrite as jest.Mock).mockReturnValue({ aiEnabled: true })
    ;(getOrBootstrapConfig as jest.Mock).mockResolvedValue(buildConfig())

    const req = callAsMember(adminA, 'PUT', '/api/v1/crm/scoring/config', { aiEnabled: true })
    await PUT(req)

    const writeArg = setCaptured.mock.calls[0][0]
    expect(writeArg.createdAt).toBeUndefined()
  })
})
