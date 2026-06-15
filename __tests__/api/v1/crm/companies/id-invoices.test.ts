/**
 * Tests for GET /api/v1/crm/companies/:id/invoices
 */
import { NextRequest } from 'next/server'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn() },
}))

jest.mock('firebase-admin/firestore', () => {
  return {
    FieldValue: {
      serverTimestamp: () => ({ _type: 'serverTimestamp' }),
      delete: () => ({ _type: 'deleteField' }),
    },
    Timestamp: {
      now: () => ({ seconds: 2000, nanoseconds: 0, toDate: () => new Date() }),
    },
  }
})

jest.mock('@/lib/companies/store', () => ({
  loadCompany: jest.fn(),
}))

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import * as companiesStore from '@/lib/companies/store'
import { seedOrgMember, callAsMember } from '../../../../helpers/crm'
import { installPortalAuthCollectionMock, makeFirestoreDoc, makeFirestoreQuery } from '../../../../helpers/firebase-admin'
import { buildCompany, uidFor } from './_fixtures'

const AI_API_KEY = 'test-ai-key-id-invoices'
process.env.AI_API_KEY = AI_API_KEY
process.env.SESSION_COOKIE_NAME = '__session'

function stageAuth(
  member: { uid: string; orgId: string; role: string; firstName?: string; lastName?: string },
  invoices: Array<{ id: string; data: Record<string, unknown> }> = [],
) {
  ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })
  installPortalAuthCollectionMock(adminDb.collection as jest.Mock, member, {
    collections: {
      invoices: makeFirestoreQuery(invoices.map((invoice) => makeFirestoreDoc(invoice.id, invoice.data))),
      contacts: makeFirestoreQuery([]),
    },
  })
}

const routeCtx = (id: string) => ({ params: Promise.resolve({ id }) })

describe('GET /api/v1/crm/companies/:id/invoices', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns invoices linked by company id and recipient org fallback', async () => {
    const member = seedOrgMember('pib-platform-owner', uidFor('viewer'), { role: 'owner' })
    const company = {
      ...buildCompany({ id: 'co-1', orgId: 'pib-platform-owner' }),
      linkedOrgId: 'client-org',
    }
    ;(companiesStore.loadCompany as jest.Mock).mockResolvedValue({ ref: {}, data: company })
    stageAuth(member, [
      { id: 'inv-1', data: { orgId: 'pib-platform-owner', companyId: 'co-1', invoiceNumber: 'INV-001' } },
      { id: 'inv-2', data: { orgId: 'pib-platform-owner', recipientOrgId: 'client-org', invoiceNumber: 'INV-002' } },
      { id: 'inv-other', data: { orgId: 'pib-platform-owner', recipientOrgId: 'other-org', invoiceNumber: 'INV-003' } },
    ])

    const req = callAsMember(member, 'GET', '/api/v1/crm/companies/co-1/invoices')
    const { GET } = await import('@/app/api/v1/crm/companies/[id]/invoices/route')
    const res = await GET(req as NextRequest, routeCtx('co-1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.invoices.map((invoice: { id: string }) => invoice.id)).toEqual(['inv-1', 'inv-2'])
  })

  it('returns 404 when company is not in the caller workspace', async () => {
    const member = seedOrgMember('org-a', uidFor('viewer'), { role: 'viewer' })
    ;(companiesStore.loadCompany as jest.Mock).mockResolvedValue(null)
    stageAuth(member, [])

    const req = callAsMember(member, 'GET', '/api/v1/crm/companies/co-other/invoices')
    const { GET } = await import('@/app/api/v1/crm/companies/[id]/invoices/route')
    const res = await GET(req as NextRequest, routeCtx('co-other'))
    expect(res.status).toBe(404)
  })
})
