// __tests__/lib/briefing-org-scope.test.ts
//
// Regression tests for cross-tenant orgId injection through the briefing
// feed. userScopedOrgIds()/createBriefingSnapshot() previously only enforced
// canAccessOrg for role === 'admin', so a client could pass any orgId (via
// ?orgId= on GET /api/v1/briefings/feed or body.orgId on
// POST /api/v1/briefings/reports) and read a briefing snapshot of another
// tenant's CRM, invoices, projects, and documents. The org-scope guard runs
// before any Firestore access, so these tests need no database fixtures.
import { buildBriefingFeed, createBriefingSnapshot } from '@/lib/briefing/feed'
import type { ApiUser } from '@/lib/api/types'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: {},
  adminDb: { collection: jest.fn(() => { throw new Error('unexpected Firestore access') }) },
}))

const clientUser: ApiUser = {
  uid: 'client-1',
  role: 'client',
  authKind: 'firebase',
  orgId: 'org-own',
  orgIds: ['org-own'],
}

const restrictedAdmin: ApiUser = {
  uid: 'admin-1',
  role: 'admin',
  authKind: 'firebase',
  allowedOrgIds: ['org-a'],
}

describe('briefing feed — org scope enforcement', () => {
  it('rejects a client requesting a feed for a foreign org', async () => {
    await expect(buildBriefingFeed(clientUser, { orgId: 'org-victim' }))
      .rejects.toMatchObject({ status: 403 })
  })

  it('rejects a client creating a snapshot scoped to a foreign org', async () => {
    await expect(createBriefingSnapshot(clientUser, { orgId: 'org-victim' }))
      .rejects.toMatchObject({ status: 403 })
  })

  it('rejects a client with no org memberships requesting any org scope', async () => {
    const orphan: ApiUser = { uid: 'client-2', role: 'client', authKind: 'firebase' }
    await expect(buildBriefingFeed(orphan, { orgId: 'org-victim' }))
      .rejects.toMatchObject({ status: 403 })
  })

  it('still rejects a restricted admin outside allowedOrgIds', async () => {
    await expect(buildBriefingFeed(restrictedAdmin, { orgId: 'org-victim' }))
      .rejects.toMatchObject({ status: 403 })
  })
})
