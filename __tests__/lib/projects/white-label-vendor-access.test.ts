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

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
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

  it('grants vendor access with internal visibility and white-label display org (no partnerLinkId required)', async () => {
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
      canViewInternal: true,
      scopedOrgId: 'pib-platform-owner',
      isVendor: true,
      displayOrgId: 'agency-abc',
    })
    expect(access?.crossOrgGrant).toBeUndefined()
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
      }),
    })

    const access = await resolveProjectAccessForUser(
      'project-1',
      { uid: 'pib-user', role: 'client', orgIds: ['pib-platform-owner'] } as any,
      projectData,
      'pib-platform-owner',
    )

    expect(access).toMatchObject({
      canViewInternal: true,
      isVendor: true,
      displayOrgId: 'pib-platform-owner',
    })
  })

  it('grants owner/face org access with internal visibility', async () => {
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
      canViewInternal: true,
      scopedOrgId: 'agency-abc',
      isVendor: false,
      displayOrgId: 'agency-abc',
    })
  })

  it('denies client access without partnerLinkId (clients require partner grants)', async () => {
    mockProjectOrgGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        projectId: 'project-1',
        orgId: 'shipping-abc',
        ownerOrgId: 'agency-abc',
        role: 'reviewer',
        status: 'active',
      }),
    })

    const access = await resolveProjectAccessForUser(
      'project-1',
      { uid: 'client-user', role: 'client', orgIds: ['shipping-abc'] } as any,
      projectData,
      'shipping-abc',
    )

    expect(access).toBeNull()
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

  it('vendor org flagged via vendorOrgIds array gets vendor access even without organizationType field', async () => {
    mockProjectOrgGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        projectId: 'project-1',
        orgId: 'pib-platform-owner',
        ownerOrgId: 'agency-abc',
        role: 'contributor',
        status: 'active',
        visibleToClient: false,
      }),
    })

    const access = await resolveProjectAccessForUser(
      'project-1',
      { uid: 'pib-user', role: 'client', orgIds: ['pib-platform-owner'] } as any,
      projectData,
      'pib-platform-owner',
    )

    expect(access).toMatchObject({
      canViewInternal: true,
      isVendor: true,
      displayOrgId: 'agency-abc',
    })
  })
})
