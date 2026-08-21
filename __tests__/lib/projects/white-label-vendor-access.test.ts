import { adminDb } from '@/lib/firebase/admin'
import {
  resolveProjectAccessForUser,
  projectMemberDocId,
  projectOrganizationDocId,
} from '@/lib/projects/collaboration'

const mockCollection = jest.fn()
const mockProjectMemberDoc = jest.fn()
const mockProjectMemberGet = jest.fn()
const mockProjectOrgDoc = jest.fn()
const mockProjectOrgGet = jest.fn()
const mockResolveProjectCrossOrgGrant = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/projects/cross-org-grant-access', () => ({
  resolveProjectCrossOrgGrant: (input: unknown) => mockResolveProjectCrossOrgGrant(input),
}))

jest.mock('@/lib/api/platformAdmin', () => ({
  isSuperAdmin: (user: { role: string }) => user.role === 'admin',
  canAccessOrg: (_user: { orgIds?: string[] }, orgId: string) => {
    return _user.orgIds?.includes(orgId) ?? false
  },
}))

jest.mock('@/lib/orgMembers/access-policy', () => ({
  canAccessModule: () => true,
  recordScopeFor: () => 'all',
}))

beforeEach(() => {
  jest.clearAllMocks()

  mockProjectMemberDoc.mockImplementation((id: string) => ({
    get: () => mockProjectMemberGet(id),
  }))
  mockProjectMemberGet.mockResolvedValue({ exists: false, data: () => undefined })

  mockProjectOrgDoc.mockImplementation((id: string) => ({
    get: () => mockProjectOrgGet(id),
  }))
  mockProjectOrgGet.mockResolvedValue({ exists: false, data: () => undefined })

  mockCollection.mockImplementation((name: string) => {
    if (name === 'projectMembers') return { doc: mockProjectMemberDoc }
    if (name === 'projectOrganizations') return { doc: mockProjectOrgDoc }
    throw new Error(`Unexpected collection ${name}`)
  })

  mockResolveProjectCrossOrgGrant.mockResolvedValue({
    allowed: true,
    grant: { grantId: 'grant-1', actions: ['project.read'], items: [] },
  })
})

describe('white-label vendor access resolution', () => {
  const projectData = {
    id: 'project-1',
    name: 'Shipping ABC Website',
    ownerOrgId: 'agency-abc',
    sourceOrgId: 'agency-abc',
    faceOrgId: 'agency-abc',
    vendorOrgIds: ['pib-platform-owner'],
  }

  it('resolves vendor access with white-label display org', async () => {
    mockProjectOrgGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        projectId: 'project-1',
        orgId: 'pib-platform-owner',
        ownerOrgId: 'agency-abc',
        role: 'contributor',
        status: 'active',
        organizationType: 'vendor',
        visibleToClient: false,
        partnerLinkId: 'link-abc-pib',
      }),
    })

    const access = await resolveProjectAccessForUser(
      'project-1',
      { uid: 'pib-user', role: 'client', orgIds: ['pib-platform-owner'] } as any,
      projectData,
      'pib-platform-owner',
    )

    expect(access).toMatchObject({
      role: 'contributor',
      source: 'project_organization',
      canViewInternal: false,
      scopedOrgId: 'pib-platform-owner',
      isVendor: true,
      displayOrgId: 'agency-abc',
    })
    expect(mockResolveProjectCrossOrgGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-1',
        ownerOrgId: 'agency-abc',
        partnerLinkId: 'link-abc-pib',
        actor: { uid: 'pib-user', orgId: 'pib-platform-owner' },
        projectRole: 'contributor',
      }),
    )
  })

  it('shows vendor org identity when visibleToClient is true', async () => {
    mockProjectOrgGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        projectId: 'project-1',
        orgId: 'pib-platform-owner',
        ownerOrgId: 'agency-abc',
        role: 'contributor',
        status: 'active',
        organizationType: 'vendor',
        visibleToClient: true,
        partnerLinkId: 'link-abc-pib',
      }),
    })

    const access = await resolveProjectAccessForUser(
      'project-1',
      { uid: 'pib-user', role: 'client', orgIds: ['pib-platform-owner'] } as any,
      projectData,
      'pib-platform-owner',
    )

    expect(access).toMatchObject({
      isVendor: true,
      displayOrgId: 'pib-platform-owner',
    })
  })

  it('resolves face org access without vendor flags', async () => {
    mockProjectOrgGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        projectId: 'project-1',
        orgId: 'agency-abc',
        ownerOrgId: 'agency-abc',
        role: 'manager',
        status: 'active',
      }),
    })

    const access = await resolveProjectAccessForUser(
      'project-1',
      { uid: 'abc-user', role: 'client', orgIds: ['agency-abc'] } as any,
      projectData,
      'agency-abc',
    )

    expect(access).toMatchObject({
      role: 'manager',
      source: 'project_organization',
      canViewInternal: false,
      scopedOrgId: 'agency-abc',
      isVendor: false,
      displayOrgId: 'agency-abc',
    })
  })

  it('resolves client access without vendor flags', async () => {
    mockProjectOrgGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        projectId: 'project-1',
        orgId: 'shipping-abc',
        ownerOrgId: 'agency-abc',
        role: 'reviewer',
        status: 'active',
        partnerLinkId: 'link-abc-shipping',
      }),
    })

    const access = await resolveProjectAccessForUser(
      'project-1',
      { uid: 'client-user', role: 'client', orgIds: ['shipping-abc'] } as any,
      projectData,
      'shipping-abc',
    )

    expect(access).toMatchObject({
      role: 'reviewer',
      source: 'project_organization',
      canViewInternal: false,
      scopedOrgId: 'shipping-abc',
      isVendor: false,
      displayOrgId: 'shipping-abc',
    })
    expect(mockResolveProjectCrossOrgGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        partnerLinkId: 'link-abc-shipping',
      }),
    )
  })

  it('denies access when project organization is revoked', async () => {
    mockProjectOrgGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        projectId: 'project-1',
        orgId: 'pib-platform-owner',
        status: 'revoked',
        organizationType: 'vendor',
      }),
    })

    const access = await resolveProjectAccessForUser(
      'project-1',
      { uid: 'pib-user', role: 'client', orgIds: ['pib-platform-owner'] } as any,
      projectData,
      'pib-platform-owner',
    )

    expect(access).toBeNull()
  })

  it('denies access when cross-org grant is missing', async () => {
    mockProjectOrgGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        projectId: 'project-1',
        orgId: 'pib-platform-owner',
        ownerOrgId: 'agency-abc',
        role: 'contributor',
        status: 'active',
        organizationType: 'vendor',
        visibleToClient: false,
        partnerLinkId: 'link-abc-pib',
      }),
    })
    mockResolveProjectCrossOrgGrant.mockResolvedValueOnce({
      allowed: false,
      reasonCode: 'NO_GRANT',
    })

    const access = await resolveProjectAccessForUser(
      'project-1',
      { uid: 'pib-user', role: 'client', orgIds: ['pib-platform-owner'] } as any,
      projectData,
      'pib-platform-owner',
    )

    expect(access).toBeNull()
  })
})
