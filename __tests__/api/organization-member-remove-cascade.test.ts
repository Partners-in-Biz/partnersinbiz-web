/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server'
import type { ApiUser } from '@/lib/api/types'

const MOCK_USER = { uid: 'admin-1', role: 'admin', orgId: 'org-1' } as ApiUser

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: (req: NextRequest, user: ApiUser, ctx?: unknown) => Promise<Response>) =>
    (req: NextRequest, ctx?: unknown) => handler(req, MOCK_USER, ctx),
}))

jest.mock('@/lib/api/platformAdmin', () => ({
  canAccessOrg: () => true,
}))

const removeUserFromAllOrgTeams = jest.fn(async () => ['org-1_growth'])
jest.mock('@/lib/org-teams/store', () => ({
  removeUserFromAllOrgTeams: (...args: unknown[]) => removeUserFromAllOrgTeams(...args as []),
}))

const revokeMemberShareAccess = jest.fn(async () => ({ bindingIds: [] }))
jest.mock('@/lib/llm-providers/share-cascade', () => ({
  revokeMemberShareAccess: (...args: unknown[]) => revokeMemberShareAccess(...args as []),
}))

const orgDoc = {
  exists: true,
  data: () => ({ members: [{ userId: 'user-z', role: 'member' }] }),
}
const userDoc = {
  exists: true,
  data: () => ({ orgIds: ['org-1'], orgId: 'org-1' }),
}
const update = jest.fn()
const set = jest.fn()
const del = jest.fn(async () => undefined)
jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => ({
      doc: () => ({
        get: async () => (name === 'organizations' ? orgDoc : userDoc),
        update,
        set,
        delete: del,
      }),
    }),
  },
}))

jest.mock('@/lib/platform-owner/relationships', () => ({
  markPlatformContactFormerOrgMember: jest.fn(async () => undefined),
  syncPlatformContactForOrgMember: jest.fn(async () => undefined),
}))

jest.mock('@/lib/activity/log', () => ({
  logActivity: jest.fn(async () => undefined),
}))

import { DELETE } from '@/app/api/v1/organizations/[id]/members/[userId]/route'

describe('organisation member remove cascade', () => {
  it('strips the member from all teams before deleting the membership row', async () => {
    const res = await DELETE(
      new NextRequest('http://localhost/api/v1/organizations/org-1/members/user-z', { method: 'DELETE' }),
      { params: Promise.resolve({ id: 'org-1', userId: 'user-z' }) },
    )
    expect(res.status).toBe(200)
    expect(removeUserFromAllOrgTeams).toHaveBeenCalledWith({ orgId: 'org-1', userId: 'user-z' })
    expect(revokeMemberShareAccess).toHaveBeenCalledWith({
      orgId: 'org-1',
      userId: 'user-z',
      reason: 'member_removed',
    })
  })
})
