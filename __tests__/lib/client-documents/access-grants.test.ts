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

  it('allows named external recipients through action access without requiring a partner grant', async () => {
    mockFindDocumentPartnerLinkId.mockResolvedValue(null)
    const access = await getAccessibleClientDocument('doc-1', namedUser, 'comment')
    expect(access.ok).toBe(true)
    expect(mockDecide).not.toHaveBeenCalled()
  })

  it('falls through to partner grant when named-share permission denies the action', async () => {
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

  it('passes version item ids into the partner-grant fallback when named-share version permission is denied', async () => {
    mockGetClientDocument.mockResolvedValue({
      ...ownerDoc,
      userShares: [
        {
          ...ownerDoc.userShares[0],
          permissions: {
            ...ownerDoc.userShares[0].permissions,
            canViewVersions: false,
          },
        },
      ],
    })
    await getAccessibleClientDocument('doc-1', namedUser, 'versions', { item: 'ver-selected' })
    expect(mockDecide).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'document.version.read',
        item: 'ver-selected',
      }),
    )
  })

  it('lets a client-role creator open a platform-held document without a partner grant', async () => {
    mockGetClientDocument.mockResolvedValue({
      id: 'doc-1',
      orgId: 'pib-platform-owner',
      status: 'client_review',
      linked: { clientOrgId: 'client-org' },
      createdBy: 'stean',
      currentVersionId: 'ver-current',
      latestPublishedVersionId: 'ver-pub',
    })
    mockFindDocumentPartnerLinkId.mockResolvedValue(null)
    const stean = {
      uid: 'stean',
      role: 'client' as const,
      orgId: 'pib-platform-owner',
      orgIds: ['pib-platform-owner'],
    }

    const access = await getAccessibleClientDocument('doc-1', stean, 'read')

    expect(access.ok).toBe(true)
    expect(mockDecide).not.toHaveBeenCalled()
  })

  it('lets a linked client-org member open a published document when no partner grant exists', async () => {
    mockGetClientDocument.mockResolvedValue({
      id: 'doc-1',
      orgId: 'pib-platform-owner',
      status: 'client_review',
      linked: { clientOrgId: 'client-org' },
      createdBy: 'stean',
      currentVersionId: 'ver-current',
      latestPublishedVersionId: 'ver-pub',
    })
    mockFindDocumentPartnerLinkId.mockResolvedValue(null)
    mockHasActiveOrgMembership.mockImplementation(async (orgId: string, uid: string) => {
      return orgId === 'client-org' && uid === 'hendrik'
    })
    const hendrik = {
      uid: 'hendrik',
      role: 'client' as const,
      orgId: 'client-org',
      orgIds: ['client-org'],
    }

    const access = await getAccessibleClientDocument('doc-1', hendrik, 'read')

    expect(access.ok).toBe(true)
  })

  it('does not let a client-role platform member open someone else’s platform document', async () => {
    mockGetClientDocument.mockResolvedValue({
      id: 'doc-1',
      orgId: 'pib-platform-owner',
      status: 'internal_draft',
      linked: { clientOrgId: 'other-client' },
      createdBy: 'someone-else',
    })
    mockFindDocumentPartnerLinkId.mockResolvedValue(null)
    const stean = {
      uid: 'stean',
      role: 'client' as const,
      orgId: 'pib-platform-owner',
      orgIds: ['pib-platform-owner'],
    }

    const access = await getAccessibleClientDocument('doc-1', stean, 'read')

    expect(access.ok).toBe(false)
    if (!access.ok) {
      expect(access.response.status).toBe(403)
    }
  })

  it('does not fall back to share visibility after a canonical grant denies the action', async () => {
    mockDecide.mockResolvedValue({ allowed: false, reasonCode: 'ACTION_NOT_GRANTED' })
    const access = await getAccessibleClientDocument('doc-1', namedUser, 'comment')
    expect(access.ok).toBe(false)
    if (!access.ok) {
      expect(access.response.status).toBe(403)
    }
  })
})

const platformLinkedDoc = {
  id: 'doc-pib-linked',
  orgId: 'pib-platform-owner',
  status: 'client_review' as const,
  linked: { clientOrgId: 'client-org' },
  createdBy: 'pib-author',
  currentVersionId: 'ver-current',
  latestPublishedVersionId: 'ver-pub',
}

const clientMember = {
  uid: 'client-member',
  role: 'client' as const,
  orgId: 'client-org',
  orgIds: ['client-org'],
}

const otherClientMember = {
  uid: 'other-client',
  role: 'client' as const,
  orgId: 'other-org',
  orgIds: ['other-org'],
}

const ownerStaff = {
  uid: 'pib-staff',
  role: 'admin' as const,
  orgId: 'pib-platform-owner',
  orgIds: ['pib-platform-owner'],
}

describe('getAccessibleClientDocument list-equivalent client visibility', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFindDocumentPartnerLinkId.mockResolvedValue(null)
    mockDecide.mockResolvedValue({ allowed: false })
    mockHasActiveOrgMembership.mockImplementation(async (orgId: string, uid: string) => {
      if (orgId === 'client-org' && uid === 'client-member') return true
      if (orgId === 'other-org' && uid === 'other-client') return true
      if (orgId === 'pib-platform-owner' && uid === 'pib-staff') return true
      return false
    })
  })

  it('allows a client member to GET a pib-platform-owner doc linked to their org in client_review without a partner grant', async () => {
    mockGetClientDocument.mockResolvedValue(platformLinkedDoc)

    const access = await getAccessibleClientDocument('doc-pib-linked', clientMember)
    expect(access.ok).toBe(true)
    if (access.ok) {
      expect(access.document.id).toBe('doc-pib-linked')
      expect(access.document.orgId).toBe('pib-platform-owner')
    }
  })

  it('denies the same member GET when the linked doc is still internal_draft', async () => {
    mockGetClientDocument.mockResolvedValue({
      ...platformLinkedDoc,
      status: 'internal_draft' as const,
    })

    const access = await getAccessibleClientDocument('doc-pib-linked', clientMember)
    expect(access.ok).toBe(false)
    if (!access.ok) {
      expect(access.response.status).toBe(403)
    }
  })

  it('denies a member of a different client org even when the doc is client_review', async () => {
    mockGetClientDocument.mockResolvedValue(platformLinkedDoc)

    const access = await getAccessibleClientDocument('doc-pib-linked', otherClientMember)
    expect(access.ok).toBe(false)
    if (!access.ok) {
      expect(access.response.status).toBe(403)
    }
  })

  it('keeps owner-org GET access for pib-platform-owner staff', async () => {
    mockGetClientDocument.mockResolvedValue({
      ...platformLinkedDoc,
      status: 'internal_draft' as const,
    })

    const access = await getAccessibleClientDocument('doc-pib-linked', ownerStaff)
    expect(access.ok).toBe(true)
  })

  it('does not grant authenticated GET via a public share token', async () => {
    mockGetClientDocument.mockResolvedValue({
      ...platformLinkedDoc,
      shareToken: 'public-share-token',
      shareEnabled: true,
      linked: { clientOrgId: 'other-org' },
    })

    const access = await getAccessibleClientDocument('doc-pib-linked', clientMember)
    expect(access.ok).toBe(false)
    if (!access.ok) {
      expect(access.response.status).toBe(403)
    }
  })

  it('keeps list visibility and GET-by-id consistent for linked client-facing docs', async () => {
    const fixtures = [
      { document: platformLinkedDoc, user: clientMember, visible: true },
      {
        document: { ...platformLinkedDoc, status: 'internal_draft' as const },
        user: clientMember,
        visible: false,
      },
      {
        document: { ...platformLinkedDoc, status: 'internal_review' as const },
        user: clientMember,
        visible: false,
      },
      {
        document: { ...platformLinkedDoc, linked: { clientOrgIds: ['client-org'] } },
        user: clientMember,
        visible: true,
      },
      {
        document: { ...platformLinkedDoc, linked: { clientOrgId: 'other-org' } },
        user: clientMember,
        visible: false,
      },
      { document: platformLinkedDoc, user: otherClientMember, visible: false },
      { document: platformLinkedDoc, user: ownerStaff, visible: true },
    ]

    for (const fixture of fixtures) {
      mockGetClientDocument.mockResolvedValue(fixture.document)
      expect(isClientDocumentVisibleToUser(fixture.document, fixture.user)).toBe(fixture.visible)
      const access = await getAccessibleClientDocument(fixture.document.id, fixture.user)
      expect(access.ok).toBe(fixture.visible)
    }
  })
})
