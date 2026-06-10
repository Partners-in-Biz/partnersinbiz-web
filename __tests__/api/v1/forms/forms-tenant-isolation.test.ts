/**
 * Consolidated cross-tenant isolation suite for forms routes.
 *
 * Mirrors the same where-respecting mock pattern from
 * capture-sources-integrations-tenant-isolation.test.ts (PR 5 / commit a735178).
 *
 * Distinct uids avoid substring collisions (PR 3 lesson):
 *   uid-amem  → member in org-a
 *   uid-aadm  → admin  in org-a
 *   uid-bmem  → member in org-b
 *
 * Fixtures:
 *   formA    (org-a, id=f-a, slug=formA-slug)
 *   formB    (org-b, id=f-b, slug=formB-slug)
 *   subA     (org-a, formId=f-a)
 *   subB     (org-b, formId=f-b)
 */
import { NextRequest } from 'next/server'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn() },
}))

jest.mock('@/lib/webhooks/dispatch', () => ({ dispatchWebhook: jest.fn().mockResolvedValue(undefined) }))
jest.mock('@/lib/activity/log', () => ({ logActivity: jest.fn().mockResolvedValue(undefined) }))

jest.mock('@/lib/forms/ratelimit', () => ({
  checkFormRateLimit: jest.fn().mockResolvedValue(true),
}))

jest.mock('@/lib/forms/turnstile', () => ({
  verifyTurnstileToken: jest.fn().mockResolvedValue({ success: true }),
}))

jest.mock('@/lib/email/resend', () => ({
  getResendClient: jest.fn().mockReturnValue({
    emails: { send: jest.fn().mockResolvedValue({}) },
  }),
  FROM_ADDRESS: 'noreply@partnersinbiz.online',
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '__serverTimestamp__' },
  Timestamp: { fromDate: (d: Date) => d.toISOString() },
}))

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { seedOrgMember, callAsMember, callAsAgent } from '../../../helpers/crm'
import { makePortalAuthCollectionsForMembers } from '../../../helpers/firebase-admin'

const AI_API_KEY = 'test-ai-key'
process.env.AI_API_KEY = AI_API_KEY
process.env.SESSION_COOKIE_NAME = '__session'

// ── Actors ──────────────────────────────────────────────────────────────────

const memberA = seedOrgMember('org-a', 'uid-amem', { role: 'member', firstName: 'A', lastName: 'M' })
const adminA  = seedOrgMember('org-a', 'uid-aadm', { role: 'admin',  firstName: 'A', lastName: 'A' })
const memberB = seedOrgMember('org-b', 'uid-bmem', { role: 'member', firstName: 'B', lastName: 'M' })

// ── Fixtures ─────────────────────────────────────────────────────────────────

const FIELDS = [{ id: 'email', type: 'email', label: 'Email', required: true }]

const formA = {
  id:            'f-a',
  orgId:         'org-a',
  name:          'Form A',
  slug:          'formA-slug',
  title:         'Form A',
  description:   '',
  fields:        FIELDS,
  active:        true,
  deleted:       false,
  createContact: true,
  rateLimitPerMinute: 10,
  turnstileEnabled: false,
  notifyEmails:  [],
  thankYouMessage: 'Thanks!',
  redirectUrl:   null,
}

const formB = {
  id:            'f-b',
  orgId:         'org-b',
  name:          'Form B',
  slug:          'formB-slug',
  title:         'Form B',
  description:   '',
  fields:        FIELDS,
  active:        true,
  deleted:       false,
  createContact: false,
  rateLimitPerMinute: 10,
  turnstileEnabled: false,
  notifyEmails:  [],
  thankYouMessage: 'Thanks!',
  redirectUrl:   null,
}

const subA = {
  id:          'sub-a',
  orgId:       'org-a',
  formId:      'f-a',
  data:        { email: 'a@example.com' },
  status:      'new' as const,
  submittedAt: '__serverTimestamp__',
  contactId:   null,
  source:      'form',
  ipAddress:   'unknown',
  userAgent:   'unknown',
}

const subB = {
  id:          'sub-b',
  orgId:       'org-b',
  formId:      'f-b',
  data:        { email: 'b@example.com' },
  status:      'new' as const,
  submittedAt: '__serverTimestamp__',
  contactId:   null,
  source:      'form',
  ipAddress:   'unknown',
  userAgent:   'unknown',
}

// ── Route context helper ─────────────────────────────────────────────────────

const routeCtx = (id: string) => ({ params: Promise.resolve({ id }) })
const subRouteCtx = (id: string, subId: string) => ({ params: Promise.resolve({ id, subId }) })

// ── Core isolation fixture setup ─────────────────────────────────────────────

/**
 * where-respecting mock pattern (PR 3 lesson):
 * Captures the orgId filter set by .where('orgId', '==', value) and returns
 * only matching docs from get(). A route that forgets to call .where('orgId')
 * would return docs for both orgs, causing isolation tests to fail.
 */
function setupIsolationFixtures() {
  const authCollections = makePortalAuthCollectionsForMembers([memberA, adminA, memberB])
  const captured = {
    formAdds:       [] as Array<Record<string, unknown>>,
    formUpdates:    [] as Array<Record<string, unknown>>,
    subAdds:        [] as Array<Record<string, unknown>>,
    subUpdates:     [] as Array<Record<string, unknown>>,
    contactAdds:    [] as Array<Record<string, unknown>>,
    activityAdds:   [] as Array<Record<string, unknown>>,
  }

  ;(adminAuth.verifySessionCookie as jest.Mock).mockImplementation((cookie: string) => {
    if (cookie.endsWith(memberA.uid)) return Promise.resolve({ uid: memberA.uid })
    if (cookie.endsWith(adminA.uid))  return Promise.resolve({ uid: adminA.uid })
    if (cookie.endsWith(memberB.uid)) return Promise.resolve({ uid: memberB.uid })
    return Promise.reject(new Error('invalid'))
  })

  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {

    if (name in authCollections) return authCollections[name as keyof typeof authCollections]

    // ── forms ──────────────────────────────────────────────────────────────
    if (name === 'forms') {
      let whereOrgFilter: string | undefined
      let whereSlugFilter: string | undefined
      let whereActiveFilter: boolean | undefined
      const query: any = {
        where: jest.fn((field: string, op: string, value: any) => {
          if (field === 'orgId' && op === '==') whereOrgFilter = value
          if (field === 'slug' && op === '==')  whereSlugFilter = value
          if (field === 'active' && op === '==') whereActiveFilter = value
          return query
        }),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        get: () => Promise.resolve({
          docs: [
            { id: 'f-a', data: () => formA },
            { id: 'f-b', data: () => formB },
          ].filter(d => {
            const data = d.data() as any
            if (whereOrgFilter !== undefined && data.orgId !== whereOrgFilter) return false
            if (whereSlugFilter !== undefined && data.slug !== whereSlugFilter) return false
            if (whereActiveFilter !== undefined && data.active !== whereActiveFilter) return false
            return true
          }),
          empty: (() => {
            // compute once lazily via getter — approximated; actual value resolved in filter above
            return false
          })(),
        }),
      }
      // Override empty based on docs
      const originalGet = query.get
      query.get = () => originalGet().then((snap: any) => ({
        ...snap,
        empty: snap.docs.length === 0,
        docs: snap.docs,
      }))
      return {
        add: jest.fn((data: Record<string, unknown>) => {
          captured.formAdds.push(data)
          const fakeRef = {
            id: 'auto-form',
            get: () => Promise.resolve({
              exists: true,
              data: () => ({ ...data, id: 'auto-form' }),
            }),
          }
          return Promise.resolve(fakeRef)
        }),
        doc: jest.fn().mockImplementation((id?: string) => ({
          id: id ?? 'auto-form',
          get: () => Promise.resolve({
            exists: id === 'f-a' || id === 'f-b',
            id: id ?? 'auto-form',
            data: () => (
              id === 'f-a' ? formA :
              id === 'f-b' ? formB :
              undefined
            ),
          }),
          update: jest.fn((data: Record<string, unknown>) => {
            captured.formUpdates.push(data)
            return Promise.resolve()
          }),
          delete: jest.fn().mockResolvedValue(undefined),
        })),
        ...query,
      }
    }

    // ── form_submissions ───────────────────────────────────────────────────
    if (name === 'form_submissions') {
      let whereFormFilter: string | undefined
      let whereOrgFilter: string | undefined
      const query: any = {
        where: jest.fn((field: string, op: string, value: any) => {
          if (field === 'formId' && op === '==') whereFormFilter = value
          if (field === 'orgId' && op === '==')  whereOrgFilter = value
          return query
        }),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        get: () => Promise.resolve({
          docs: [
            { id: 'sub-a', data: () => subA },
            { id: 'sub-b', data: () => subB },
          ].filter(d => {
            const data = d.data() as any
            if (whereFormFilter !== undefined && data.formId !== whereFormFilter) return false
            if (whereOrgFilter !== undefined && data.orgId !== whereOrgFilter)   return false
            return true
          }),
        }),
      }
      return {
        add: jest.fn((data: Record<string, unknown>) => {
          captured.subAdds.push(data)
          const fakeRef = {
            id: 'auto-sub',
            update: jest.fn((u: Record<string, unknown>) => {
              captured.subUpdates.push(u)
              return Promise.resolve()
            }),
          }
          return Promise.resolve(fakeRef)
        }),
        doc: jest.fn().mockImplementation((id?: string) => ({
          id: id ?? 'auto-sub',
          get: () => Promise.resolve({
            exists: id === 'sub-a' || id === 'sub-b',
            id: id ?? 'auto-sub',
            data: () => (
              id === 'sub-a' ? subA :
              id === 'sub-b' ? subB :
              undefined
            ),
          }),
          update: jest.fn((data: Record<string, unknown>) => {
            captured.subUpdates.push(data)
            return Promise.resolve()
          }),
        })),
        ...query,
      }
    }

    // ── contacts ───────────────────────────────────────────────────────────
    if (name === 'contacts') {
      const contactQuery: any = {
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
      }
      return {
        add: jest.fn((data: Record<string, unknown>) => {
          captured.contactAdds.push(data)
          return Promise.resolve({ id: 'auto-contact' })
        }),
        where: contactQuery.where,
        ...contactQuery,
      }
    }

    // ── activities ─────────────────────────────────────────────────────────
    if (name === 'activities') {
      return {
        add: jest.fn((data: Record<string, unknown>) => {
          captured.activityAdds.push(data)
          return Promise.resolve({ id: 'auto-act' })
        }),
      }
    }

    return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
  })

  return captured
}

beforeEach(() => { jest.clearAllMocks() })

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('cross-tenant isolation: forms routes', () => {

  // ── POST /api/v1/forms ────────────────────────────────────────────────────

  it('admin POST form is scoped to org-a with createdByRef.displayName = "A A"', async () => {
    const captured = setupIsolationFixtures()
    const req = callAsMember(adminA, 'POST', '/api/v1/forms', {
      name: 'Test Form',
      slug: 'test-form',
      fields: [{ id: 'email', type: 'email', label: 'Email', required: true }],
    })
    const { POST } = await import('@/app/api/v1/forms/route')
    const res = await POST(req)
    expect(res.status).toBeLessThan(300)
    const written = captured.formAdds.at(-1)
    expect(written?.orgId).toBe('org-a')
    expect((written?.createdByRef as any)?.displayName).toBe('A A')
  })

  it('agent (Bearer) POST form uses AGENT_PIP_REF (uid=agent:pip)', async () => {
    const captured = setupIsolationFixtures()
    const req = callAsAgent('org-a', 'POST', '/api/v1/forms', {
      name: 'Agent Form',
      slug: 'agent-form',
      fields: [{ id: 'email', type: 'email', label: 'Email', required: true }],
    })
    const { POST } = await import('@/app/api/v1/forms/route')
    const res = await POST(req)
    expect(res.status).toBeLessThan(300)
    const written = captured.formAdds.at(-1)
    expect((written?.createdByRef as any)?.uid).toBe('agent:pip')
    expect(written?.orgId).toBe('org-a')
  })

  it('member POST form → 403 (admin required)', async () => {
    setupIsolationFixtures()
    const req = callAsMember(memberA, 'POST', '/api/v1/forms', {
      name: 'Test Form',
      slug: 'test-form',
      fields: [{ id: 'email', type: 'email', label: 'Email', required: true }],
    })
    const { POST } = await import('@/app/api/v1/forms/route')
    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  // ── GET /api/v1/forms ─────────────────────────────────────────────────────

  it('viewer GET list returns ONLY org-a forms (catches missing where("orgId"))', async () => {
    setupIsolationFixtures()
    const req = callAsMember(memberA, 'GET', '/api/v1/forms')
    const { GET } = await import('@/app/api/v1/forms/route')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    const arr = (body.data ?? []) as Array<{ id: string }>
    expect(arr.map(f => f.id)).not.toContain('f-b')
    // f-a should be present
    expect(arr.map(f => f.id)).toContain('f-a')
  })

  // ── PUT /api/v1/forms/:id ─────────────────────────────────────────────────

  it('admin cannot PUT cross-org form → 404', async () => {
    setupIsolationFixtures()
    const req = callAsMember(adminA, 'PUT', '/api/v1/forms/f-b', { name: 'Hacked' })
    const { PUT } = await import('@/app/api/v1/forms/[id]/route')
    const res = await PUT(req, routeCtx('f-b'))
    expect(res.status).toBe(404)
  })

  // ── DELETE /api/v1/forms/:id ──────────────────────────────────────────────

  it('admin cannot DELETE cross-org form → 404', async () => {
    setupIsolationFixtures()
    const req = callAsMember(adminA, 'DELETE', '/api/v1/forms/f-b')
    const { DELETE } = await import('@/app/api/v1/forms/[id]/route')
    const res = await DELETE(req, routeCtx('f-b'))
    expect(res.status).toBe(404)
  })

  // ── GET /api/v1/forms/:id/submissions ─────────────────────────────────────

  it('viewer GET cross-org form submissions → 404 (form preflight rejects)', async () => {
    setupIsolationFixtures()
    const req = callAsMember(memberA, 'GET', '/api/v1/forms/f-b/submissions')
    const { GET } = await import('@/app/api/v1/forms/[id]/submissions/route')
    const res = await GET(req, routeCtx('f-b'))
    expect(res.status).toBe(404)
  })

  // ── PATCH /api/v1/forms/:id/submissions/:subId ────────────────────────────

  it('admin PATCH cross-org submission → 404', async () => {
    setupIsolationFixtures()
    const req = callAsMember(adminA, 'PATCH', '/api/v1/forms/f-b/submissions/sub-b', {
      status: 'read',
    })
    const { PATCH } = await import('@/app/api/v1/forms/[id]/submissions/[subId]/route')
    const res = await PATCH(req, subRouteCtx('f-b', 'sub-b'))
    expect(res.status).toBe(404)
  })

  // ── Public POST /api/v1/forms/:slug/submit ────────────────────────────────

  it('public submit writes FormSubmission with formSubmissionRef uid and kind=system, scoped to org-a', async () => {
    const captured = setupIsolationFixtures()

    // The submit route uses the [id] slug segment + ?orgId= query param
    const { NextRequest: NR } = require('next/server')
    const req = new NR(
      `http://localhost/api/v1/forms/formA-slug/submit?orgId=org-a`,
      {
        method: 'POST',
        headers: new Headers({ 'content-type': 'application/json' }),
        body: JSON.stringify({ email: 'submitter@example.com' }),
      },
    )
    const { POST } = await import('@/app/api/v1/forms/[id]/submit/route')
    const res = await POST(req, { params: Promise.resolve({ id: 'formA-slug' }) })

    expect(res.status).toBe(200)
    const written = captured.subAdds.at(-1)
    expect(written?.orgId).toBe('org-a')
    // formSubmissionRef pattern: uid = system:form-submission:{formId}
    expect((written?.createdByRef as any)?.uid).toBe('system:form-submission:f-a')
    expect((written?.createdByRef as any)?.kind).toBe('system')
  })

  it('public submit auto-creates Contact with formSubmissionRef attribution', async () => {
    const captured = setupIsolationFixtures()

    const { NextRequest: NR } = require('next/server')
    const req = new NR(
      `http://localhost/api/v1/forms/formA-slug/submit?orgId=org-a`,
      {
        method: 'POST',
        headers: new Headers({ 'content-type': 'application/json' }),
        body: JSON.stringify({ email: 'newcontact@example.com' }),
      },
    )
    const { POST } = await import('@/app/api/v1/forms/[id]/submit/route')
    await POST(req, { params: Promise.resolve({ id: 'formA-slug' }) })

    // Contact should be created (createContact=true on formA)
    expect(captured.contactAdds.length).toBeGreaterThan(0)
    const contact = captured.contactAdds.at(-1)
    expect(contact?.orgId).toBe('org-a')
    expect((contact?.createdByRef as any)?.uid).toBe('system:form-submission:f-a')
    expect((contact?.createdByRef as any)?.kind).toBe('system')
  })

  it('public submit writes Activity with formSubmissionRef attribution', async () => {
    const captured = setupIsolationFixtures()

    const { NextRequest: NR } = require('next/server')
    const req = new NR(
      `http://localhost/api/v1/forms/formA-slug/submit?orgId=org-a`,
      {
        method: 'POST',
        headers: new Headers({ 'content-type': 'application/json' }),
        body: JSON.stringify({ email: 'actuser@example.com' }),
      },
    )
    const { POST } = await import('@/app/api/v1/forms/[id]/submit/route')
    await POST(req, { params: Promise.resolve({ id: 'formA-slug' }) })

    expect(captured.activityAdds.length).toBeGreaterThan(0)
    const act = captured.activityAdds.at(-1)
    expect(act?.orgId).toBe('org-a')
    expect((act?.createdByRef as any)?.uid).toBe('system:form-submission:f-a')
    expect((act?.createdByRef as any)?.kind).toBe('system')
    expect(act?.type).toBe('note')
  })

  it('public submit with org-b orgId + org-a form slug returns 404', async () => {
    setupIsolationFixtures()
    // formA has slug 'formA-slug' in org-a; resolving by org-b + that slug should 404
    const { NextRequest: NR } = require('next/server')
    const req = new NR(
      `http://localhost/api/v1/forms/formA-slug/submit?orgId=org-b`,
      {
        method: 'POST',
        headers: new Headers({ 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' }),
        body: JSON.stringify({ name: 'Test', email: 'test@example.com' }),
      },
    )
    const { POST } = await import('@/app/api/v1/forms/[id]/submit/route')
    const res = await POST(req, { params: Promise.resolve({ id: 'formA-slug' }) })
    expect(res.status).toBe(404)
  })
})
