const mockGetClientDocument = jest.fn()
const mockHasActiveOrgMembership = jest.fn()
const mockDecide = jest.fn()
const mockFindDocumentPartnerLinkId = jest.fn()

jest.mock('@/lib/client-documents/store', () => ({
  getClientDocument: (...args: unknown[]) => mockGetClientDocument(...args),
}))

jest.mock('@/lib/orgMembers/active-membership', () => ({
  hasActiveOrgMembership: (...args: unknown[]) => mockHasActiveOrgMembership(...args),
}))

jest.mock('@/lib/cross-org/policy-service', () => ({
  CrossOrgPolicyService: jest.fn().mockImplementation(() => ({
    decide: (...args: unknown[]) => mockDecide(...args),
  })),
  FirestoreCrossOrgPolicyStore: jest.fn(),
}))

jest.mock('@/lib/client-documents/canonical-grants', () => ({
  findDocumentPartnerLinkId: (...args: unknown[]) => mockFindDocumentPartnerLinkId(...args),
}))

import {
  getAccessibleClientDocument,
  isClientDocumentVisibleToUser,
  assertClientDocumentDataAccess,
  canManageClientDocument,
} from '@/lib/client-documents/access'

const ownerDoc = {
  id: 'doc-1',
  orgId: 'owner-org',
  status: 'client_review' as const,
  linked: { clientOrgId: 'client-org' },
  createdBy: 'owner-user',
  currentVersionId: 'ver-current',
  latestPublishedVersionId: 'ver-pub',
  userShares: [
    {
      userId: 'named-user',
      recipientOrgId: 'client-org',
      status: 'active' as const,
      grantedBy: 'owner-user',
      grantedAt: '2026-08-01T00:00:00.000Z',
      permissions: {
        canView: true,
        canComment: true,
        canSuggest: false,
        canViewVersions: true,
        canViewAttachments: false,
        canApprove: false,
      },
    },
  ],
}

const namedUser = {
  uid: 'named-user',
  role: 'client' as const,
  orgId: 'client-org',
  orgIds: ['client-org'],
}

describe('getAccessibleClientDocument canonical grants', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetClientDocument.mockResolvedValue(ownerDoc)
    mockHasActiveOrgMembership.mockImplementation(async (orgId: string, uid: string) => {
      return orgId === 'client-org' && uid === 'named-user'
    })
    mockFindDocumentPartnerLinkId.mockResolvedValue('link-1')
    mockDecide.mockResolvedValue({ allowed: true })
  })

  it('allows named external recipients only through CrossOrgPolicyService decisions', async () => {
    const access = await getAccessibleClientDocument('doc-1', namedUser, 'comment')
    expect(access.ok).toBe(true)
    expect(mockDecide).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: { userId: 'named-user', orgId: 'client-org' },
        resourceType: 'document',
        resourceId: 'doc-1',
        resourceOwnerOrgId: 'owner-org',
        action: 'document.comment',
        partnerLinkId: 'link-1',
        requiredCapability: 'documents',
        requireNamedUser: true,
        recordDecision: false,
      }),
    )
  })

  it('denies attachment downloads when the policy decision rejects document.download', async () => {
    mockDecide.mockResolvedValue({ allowed: false, reasonCode: 'ACTION_NOT_GRANTED' })
    const access = await getAccessibleClientDocument('doc-1', namedUser, 'attachments')
    expect(access.ok).toBe(false)
    if (!access.ok) {
      expect(access.response.status).toBe(403)
    }
    expect(mockDecide).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'document.download',
      }),
    )
  })

  it('keeps list visibility for active named shares without elevating them to document managers', () => {
    expect(isClientDocumentVisibleToUser(ownerDoc, namedUser)).toBe(true)
    expect(assertClientDocumentDataAccess(ownerDoc, namedUser).ok).toBe(true)
    expect(canManageClientDocument(ownerDoc, namedUser)).toBe(false)
  })

  it('passes version item ids into the policy decision for version reads', async () => {
    await getAccessibleClientDocument('doc-1', namedUser, 'versions', { item: 'ver-selected' })
    expect(mockDecide).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'document.version.read',
        item: 'ver-selected',
      }),
    )
  })
})
