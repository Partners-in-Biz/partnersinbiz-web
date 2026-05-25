jest.mock('@/lib/firebase/admin', () => ({ adminDb: {} }))
jest.mock('@/lib/client-documents/store', () => ({ CLIENT_DOCUMENTS_COLLECTION: 'client_documents' }))

import { buildOrgDashboardLinks, toIsoOrNull } from '@/lib/org-dashboard/aggregate'

describe('org dashboard aggregate helpers', () => {
  it('builds org-scoped deep links with slug preserved', () => {
    expect(buildOrgDashboardLinks('acme-law')).toEqual({
      dashboard: '/admin/org/acme-law/dashboard',
      projects: '/admin/org/acme-law/projects',
      social: '/admin/org/acme-law/social',
      socialQueue: '/admin/social/queue?org=acme-law',
      socialCalendar: '/admin/social/calendar?org=acme-law',
      tasks: '/admin/org/acme-law/projects',
      inbox: '/admin/org/acme-law/messages',
      approvals: '/admin/org/acme-law/social?status=pending_approval',
      documents: '/admin/org/acme-law/documents',
    })
  })

  it('normalises Firestore timestamp-like values to ISO strings', () => {
    expect(toIsoOrNull({ _seconds: 1_700_000_000 })).toBe('2023-11-14T22:13:20.000Z')
    expect(toIsoOrNull({ seconds: 1_700_000_001 })).toBe('2023-11-14T22:13:21.000Z')
    expect(toIsoOrNull({ toDate: () => new Date('2026-01-02T03:04:05Z') })).toBe('2026-01-02T03:04:05.000Z')
    expect(toIsoOrNull('not a date')).toBeNull()
  })
})
