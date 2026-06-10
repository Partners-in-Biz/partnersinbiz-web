/**
 * Tests for POST /api/v1/crm/companies/:id/upload-logo
 */
import { NextRequest } from 'next/server'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn(), batch: jest.fn() },
  getAdminApp: jest.fn().mockReturnValue({}),
}))

jest.mock('firebase-admin/firestore', () => {
  const serverTimestampSentinel = { _type: 'serverTimestamp' }
  return {
    FieldValue: {
      serverTimestamp: () => serverTimestampSentinel,
      delete: () => ({ _type: 'deleteField' }),
    },
    Timestamp: {
      now: () => ({ seconds: 4000, nanoseconds: 0, toDate: () => new Date() }),
    },
  }
})

jest.mock('firebase-admin/storage', () => ({
  getStorage: jest.fn(),
}))

jest.mock('@/lib/companies/store', () => ({
  loadCompany: jest.fn(),
  sanitizeCompanyForWrite: jest.fn((x: unknown) => x),
  validateParentChain: jest.fn().mockResolvedValue(true),
  validateAccountManager: jest.fn().mockResolvedValue(true),
  clearCompanyIdOnCollection: jest.fn().mockResolvedValue(0),
  loadMemberRef: jest.fn().mockResolvedValue({ uid: 'am-uid', displayName: 'AM User' }),
}))

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { getStorage } from 'firebase-admin/storage'
import * as companiesStore from '@/lib/companies/store'
import { seedOrgMember } from '../../../../helpers/crm'
import { installPortalAuthCollectionMock } from '../../../../helpers/firebase-admin'
import { buildCompany, uidFor } from './_fixtures'

const AI_API_KEY = 'test-ai-key-logo'
process.env.AI_API_KEY = AI_API_KEY
process.env.SESSION_COOKIE_NAME = '__session'

// ── helpers ──────────────────────────────────────────────────────────────────

function stageAuth(
  member: { uid: string; orgId: string; role: string; firstName?: string; lastName?: string },
) {
  ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })
  installPortalAuthCollectionMock(adminDb.collection as jest.Mock, member)
}

function makeBucket(overrides: Partial<{
  saveFn: jest.Mock
  name: string
}> = {}) {
  const saveFn = overrides.saveFn ?? jest.fn().mockResolvedValue(undefined)
  const name = overrides.name ?? 'test-bucket'
  return {
    name,
    file: jest.fn().mockReturnValue({
      save: saveFn,
    }),
  }
}

function routeCtx(id: string) {
  return { params: Promise.resolve({ id }) }
}

function makeUpdateFn() {
  return jest.fn().mockResolvedValue(undefined)
}

function makeFormDataRequest(
  member: { uid: string; orgId: string; role: string; firstName?: string; lastName?: string },
  fileName: string,
  fileType: string,
  fileContent: string,
  url: string,
) {
  const formData = new FormData()
  const blob = new Blob([fileContent], { type: fileType })
  formData.append('file', blob, fileName)
  return new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    headers: new Headers({
      cookie: `__session=test-session-${member.uid}`,
    }),
    body: formData,
  }) as NextRequest
}

// Import route once
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let uploadRoute: any
beforeAll(async () => {
  uploadRoute = await import('@/app/api/v1/crm/companies/[id]/upload-logo/route')
})

beforeEach(() => {
  jest.clearAllMocks()
})

// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/crm/companies/:id/upload-logo', () => {
  it('uploads logo and returns logoUrl (PNG)', async () => {
    const uid = uidFor('member')
    const member = seedOrgMember('org-a', uid, { role: 'member' })
    stageAuth(member)
    const updateFn = makeUpdateFn()
    const co = buildCompany({ id: 'co-logo', orgId: 'org-a' })
    ;(companiesStore.loadCompany as jest.Mock).mockResolvedValue({
      ref: { update: updateFn },
      data: co,
    })

    const bucket = makeBucket({ name: 'test-bucket.appspot.com' })
    ;(getStorage as jest.Mock).mockReturnValue({ bucket: jest.fn().mockReturnValue(bucket) })

    const req = makeFormDataRequest(
      member,
      'logo.png',
      'image/png',
      'fake-png-data',
      '/api/v1/crm/companies/co-logo/upload-logo',
    )
    const res = await uploadRoute.POST(req, routeCtx('co-logo'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.logoUrl).toContain('firebasestorage.googleapis.com')
    expect(body.data.logoUrl).toContain('logo.png')
    expect(updateFn).toHaveBeenCalledTimes(1)
    const written = updateFn.mock.calls[0][0]
    expect(written.logoUrl).toEqual(body.data.logoUrl)
  })

  it('returns 404 when company not found', async () => {
    const uid = uidFor('member2')
    const member = seedOrgMember('org-a', uid, { role: 'member' })
    stageAuth(member)
    ;(companiesStore.loadCompany as jest.Mock).mockResolvedValue(null)
    const req = makeFormDataRequest(member, 'logo.png', 'image/png', 'x', '/api/v1/crm/companies/ghost/upload-logo')
    const res = await uploadRoute.POST(req, routeCtx('ghost'))
    expect(res.status).toBe(404)
  })

  it('returns 400 for invalid file type', async () => {
    const uid = uidFor('member3')
    const member = seedOrgMember('org-a', uid, { role: 'member' })
    stageAuth(member)
    const co = buildCompany({ id: 'co-type', orgId: 'org-a' })
    ;(companiesStore.loadCompany as jest.Mock).mockResolvedValue({
      ref: { update: jest.fn() },
      data: co,
    })
    const req = makeFormDataRequest(member, 'doc.pdf', 'application/pdf', 'data', '/api/v1/crm/companies/co-type/upload-logo')
    const res = await uploadRoute.POST(req, routeCtx('co-type'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Invalid file type/i)
  })

  it('returns 413 for file over 5MB', async () => {
    const uid = uidFor('member4')
    const member = seedOrgMember('org-a', uid, { role: 'member' })
    stageAuth(member)
    const co = buildCompany({ id: 'co-size', orgId: 'org-a' })
    ;(companiesStore.loadCompany as jest.Mock).mockResolvedValue({
      ref: { update: jest.fn() },
      data: co,
    })

    // Create a file object that reports a large size
    const formData = new FormData()
    // Create a mock large file via Blob
    const largeContent = 'x'.repeat(5 * 1024 * 1024 + 1)
    const blob = new Blob([largeContent], { type: 'image/png' })
    formData.append('file', blob, 'big.png')

    const req = new NextRequest('http://localhost/api/v1/crm/companies/co-size/upload-logo', {
      method: 'POST',
      headers: new Headers({ cookie: `__session=test-session-${member.uid}` }),
      body: formData,
    })
    const res = await uploadRoute.POST(req, routeCtx('co-size'))
    expect(res.status).toBe(413)
    expect((await res.json()).error).toMatch(/5MB/i)
  })

  it('returns 403 for viewer', async () => {
    const uid = uidFor('viewer')
    const member = seedOrgMember('org-a', uid, { role: 'viewer' })
    stageAuth(member)
    const req = makeFormDataRequest(member, 'logo.png', 'image/png', 'x', '/api/v1/crm/companies/co-v/upload-logo')
    const res = await uploadRoute.POST(req, routeCtx('co-v'))
    expect(res.status).toBe(403)
  })

  it('returns 401 without auth', async () => {
    const req = new NextRequest('http://localhost/api/v1/crm/companies/co-x/upload-logo', {
      method: 'POST',
    })
    const res = await uploadRoute.POST(req, routeCtx('co-x'))
    expect(res.status).toBe(401)
  })

  it('accepts webp and svg types', async () => {
    for (const [type, ext] of [['image/webp', 'webp'], ['image/svg+xml', 'svg']] as const) {
      jest.clearAllMocks()
      const uid = uidFor(`member-${ext}`)
      const member = seedOrgMember('org-a', uid, { role: 'member' })
      stageAuth(member)
      const co = buildCompany({ id: `co-${ext}`, orgId: 'org-a' })
      ;(companiesStore.loadCompany as jest.Mock).mockResolvedValue({
        ref: { update: jest.fn().mockResolvedValue(undefined) },
        data: co,
      })
      const bucket = makeBucket({ name: 'bucket.appspot.com' })
      ;(getStorage as jest.Mock).mockReturnValue({ bucket: jest.fn().mockReturnValue(bucket) })
      const req = makeFormDataRequest(
        member,
        `logo.${ext}`,
        type,
        'data',
        `/api/v1/crm/companies/co-${ext}/upload-logo`,
      )
      const res = await uploadRoute.POST(req, routeCtx(`co-${ext}`))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.logoUrl).toContain(`logo.${ext}`)
    }
  })
})
