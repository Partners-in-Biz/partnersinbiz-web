const mockDecide = jest.fn()
const mockMemberGet = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({ get: mockMemberGet })),
    })),
  },
}))

jest.mock('@/lib/cross-org/policy-service', () => ({
  CrossOrgPolicyService: jest.fn(() => ({ decide: mockDecide })),
  FirestoreCrossOrgPolicyStore: jest.fn(),
}))

import { resolveProjectCrossOrgGrant } from '@/lib/projects/cross-org-grant-access'

describe('canonical project cross-org grant access', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockMemberGet.mockResolvedValue({ exists: true, data: () => ({ status: 'active', teamIds: [] }) })
  })

  it('denies an active project-organisation convenience row when its canonical grant is revoked', async () => {
    mockDecide.mockResolvedValue({ allowed: false, reasonCode: 'GRANT_NOT_ACTIVE', chain: [] })
    await expect(resolveProjectCrossOrgGrant({
      projectId: 'project-1', ownerOrgId: 'org-a', partnerLinkId: 'link-1',
      actor: { uid: 'user-b', orgId: 'org-b' }, projectRole: 'reviewer', action: 'project.read',
    })).resolves.toEqual({ allowed: false, reasonCode: 'GRANT_NOT_ACTIVE' })
    expect(mockDecide).toHaveBeenCalledWith(expect.objectContaining({
      actor: { userId: 'user-b', orgId: 'org-b' }, resourceType: 'project', resourceId: 'project-1',
      partnerLinkId: 'link-1', requiredCapability: 'projects', actorRole: 'reviewer', action: 'project.read',
      resourceOwnerOrgId: 'org-a', roleRank: expect.any(Function),
    }))
  })

  it('uses active actor team membership when evaluating a named team grant', async () => {
    mockMemberGet.mockResolvedValue({ exists: true, data: () => ({ status: 'active', teamIds: ['team-b'] }) })
    mockDecide.mockResolvedValue({
      allowed: true, reasonCode: 'ALLOWED', resourceGrantId: 'grant-team',
      projection: { fields: null, items: null }, chain: [],
    })

    await expect(resolveProjectCrossOrgGrant({
      projectId: 'project-1', ownerOrgId: 'org-a', partnerLinkId: 'link-1',
      actor: { uid: 'user-b', orgId: 'org-b' }, projectRole: 'reviewer', action: 'project.read',
    })).resolves.toEqual({
      allowed: true,
      grant: { grantId: 'grant-team', actions: ['project.read'], items: [] },
    })
    expect(mockDecide).toHaveBeenCalledWith(expect.objectContaining({ actorTeamIds: ['team-b'] }))
  })

  it('does not trust team ids from an inactive membership row', async () => {
    mockMemberGet.mockResolvedValue({ exists: true, data: () => ({ status: 'revoked', teamIds: ['team-b'] }) })
    mockDecide.mockResolvedValue({ allowed: false, reasonCode: 'RESOURCE_GRANT_REQUIRED', chain: [] })

    await resolveProjectCrossOrgGrant({
      projectId: 'project-1', ownerOrgId: 'org-a', partnerLinkId: 'link-1',
      actor: { uid: 'user-b', orgId: 'org-b' }, projectRole: 'reviewer', action: 'project.read',
    })

    expect(mockDecide).toHaveBeenCalledWith(expect.objectContaining({ actorTeamIds: [] }))
  })

  it('returns only canonical grant projection details after an allowed policy decision', async () => {
    mockDecide.mockResolvedValue({
      allowed: true, reasonCode: 'ALLOWED', resourceGrantId: 'grant-1',
      projection: { fields: null, items: ['task-ok'] }, chain: [],
    })
    await expect(resolveProjectCrossOrgGrant({
      projectId: 'project-1', ownerOrgId: 'org-a', partnerLinkId: 'link-1',
      actor: { uid: 'user-b', orgId: 'org-b' }, projectRole: 'reviewer', action: 'project.read',
    })).resolves.toEqual({
      allowed: true,
      grant: { grantId: 'grant-1', actions: ['project.read'], items: ['task-ok'] },
    })
  })
})
