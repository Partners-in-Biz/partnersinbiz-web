const mockCollection = jest.fn()
const mockDoc = jest.fn()
const mockWhere = jest.fn()
const mockLimit = jest.fn()
const mockGet = jest.fn()
const mockAdd = jest.fn()
const mockSet = jest.fn()
const mockUpdate = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
    arrayUnion: jest.fn((...items: unknown[]) => ({ op: 'arrayUnion', items })),
  },
}))

jest.mock('node:crypto', () => ({
  randomBytes: jest.fn(() => ({ toString: () => 'claim-token-1234567890abcdef' })),
}))

function collectionApi() {
  return {
    doc: mockDoc,
    where: mockWhere,
    limit: mockLimit,
    get: mockGet,
    add: mockAdd,
  }
}

beforeEach(() => {
  jest.resetModules()
  jest.clearAllMocks()

  mockCollection.mockReturnValue(collectionApi())
  mockDoc.mockReturnValue({ get: mockGet, set: mockSet, update: mockUpdate })
  mockWhere.mockReturnValue(collectionApi())
  mockLimit.mockReturnValue(collectionApi())
  mockAdd.mockResolvedValue({ id: 'relationship-1' })
  mockSet.mockResolvedValue(undefined)
  mockUpdate.mockResolvedValue(undefined)
  mockGet.mockResolvedValue({ empty: true, exists: false, docs: [] })
})

export {}

describe('ensureClaimableRelationship', () => {
  it('reuses an active relationship for the same source resource and recipient email', async () => {
    mockGet.mockResolvedValueOnce({
      empty: false,
      docs: [
        {
          id: 'existing-relationship',
          data: () => ({
            claimToken: 'existing-token',
            targetOrgId: 'recipient-org',
            status: 'pending',
          }),
        },
      ],
    })

    const { ensureClaimableRelationship } = await import('@/lib/claimable-relationships/store')
    const result = await ensureClaimableRelationship({
      sourceOrgId: 'sender-org',
      sourceCompanyId: 'company-1',
      sourceContactId: 'contact-1',
      recipientEmail: 'Buyer@Example.com',
      recipientName: 'Buyer One',
      resourceType: 'invoice',
      resourceId: 'invoice-1',
    })

    expect(result.id).toBe('existing-relationship')
    expect(result.claimToken).toBe('existing-token')
    expect(mockAdd).not.toHaveBeenCalled()
    expect(mockWhere).toHaveBeenCalledWith('sourceOrgId', '==', 'sender-org')
    expect(mockWhere).toHaveBeenCalledWith('resourceType', '==', 'invoice')
    expect(mockWhere).toHaveBeenCalledWith('resourceId', '==', 'invoice-1')
  })

  it('creates an already claimed relationship when CRM company/contact links exist', async () => {
    mockGet
      .mockResolvedValueOnce({ empty: true, docs: [] })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ orgId: 'sender-org', linkedOrgId: 'recipient-org' }),
      })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ orgId: 'sender-org', linkedUserId: 'recipient-user' }),
      })

    const { ensureClaimableRelationship } = await import('@/lib/claimable-relationships/store')
    const result = await ensureClaimableRelationship({
      sourceOrgId: 'sender-org',
      sourceCompanyId: 'company-1',
      sourceContactId: 'contact-1',
      recipientEmail: 'Buyer@Example.com',
      recipientName: 'Buyer One',
      recipientCompanyName: 'Buyer Co',
      resourceType: 'project',
      resourceId: 'project-1',
    })

    expect(result).toEqual({
      id: 'relationship-1',
      claimToken: 'claim-token-1234567890abcdef',
      targetOrgId: 'recipient-org',
      targetUserId: 'recipient-user',
      status: 'claimed',
    })
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      sourceOrgId: 'sender-org',
      sourceCompanyId: 'company-1',
      sourceContactId: 'contact-1',
      recipientEmail: 'buyer@example.com',
      recipientName: 'Buyer One',
      recipientCompanyName: 'Buyer Co',
      resourceType: 'project',
      resourceId: 'project-1',
      claimToken: 'claim-token-1234567890abcdef',
      targetOrgId: 'recipient-org',
      targetUserId: 'recipient-user',
      status: 'claimed',
      claimedAt: 'SERVER_TIMESTAMP',
    }))
  })
})

describe('applyClaimLinks', () => {
  it('links the sender CRM records and resource without granting org access', async () => {
    const { applyClaimLinks } = await import('@/lib/claimable-relationships/store')

    await applyClaimLinks({
      relationshipId: 'relationship-1',
      sourceOrgId: 'sender-org',
      sourceCompanyId: 'company-1',
      sourceContactId: 'contact-1',
      targetOrgId: 'recipient-org',
      targetUserId: 'recipient-user',
      resourceType: 'invoice',
      resourceId: 'invoice-1',
    })

    expect(mockCollection).toHaveBeenCalledWith('companies')
    expect(mockCollection).toHaveBeenCalledWith('contacts')
    expect(mockCollection).toHaveBeenCalledWith('invoices')
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      linkedOrgId: 'recipient-org',
      updatedAt: 'SERVER_TIMESTAMP',
    }))
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      linkedUserId: 'recipient-user',
      updatedAt: 'SERVER_TIMESTAMP',
    }))
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      targetOrgId: 'recipient-org',
      targetUserId: 'recipient-user',
      status: 'claimed',
    }))
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      recipientOrgId: 'recipient-org',
      recipientUserId: 'recipient-user',
      claimStatus: 'claimed',
    }))
  })

  it('activates project-scoped access when a project invite is claimed', async () => {
    const inviteRefSet = jest.fn(async () => undefined)
    mockGet.mockResolvedValueOnce({
      empty: false,
      docs: [{
        id: 'invite-1',
        ref: { set: inviteRefSet },
        data: () => ({
          projectId: 'project-1',
          companyId: 'company-1',
          contactId: 'contact-1',
          role: 'contributor',
          recipientEmail: 'buyer@example.com',
          recipientName: 'Buyer One',
          recipientCompanyName: 'Buyer Co',
          invitedBy: 'owner-1',
        }),
      }],
    })

    const { applyClaimLinks } = await import('@/lib/claimable-relationships/store')

    await applyClaimLinks({
      relationshipId: 'relationship-1',
      sourceOrgId: 'sender-org',
      sourceCompanyId: 'company-1',
      sourceContactId: 'contact-1',
      targetOrgId: 'recipient-org',
      targetUserId: 'recipient-user',
      resourceType: 'project',
      resourceId: 'project-1',
    })

    expect(mockCollection).toHaveBeenCalledWith('projectInvites')
    expect(mockCollection).toHaveBeenCalledWith('projectOrganizations')
    expect(mockCollection).toHaveBeenCalledWith('projectMembers')
    expect(mockDoc).toHaveBeenCalledWith('project-1_recipient-org')
    expect(mockDoc).toHaveBeenCalledWith('project-1_recipient-user')
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      orgId: 'recipient-org',
      companyId: 'company-1',
      contactId: 'contact-1',
      role: 'contributor',
      status: 'active',
      recipientEmail: 'buyer@example.com',
    }), { merge: true })
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      uid: 'recipient-user',
      orgId: 'recipient-org',
      role: 'contributor',
      status: 'active',
      memberType: 'external',
    }), { merge: true })
    expect(inviteRefSet).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'recipient-org',
      uid: 'recipient-user',
      status: 'claimed',
    }), { merge: true })
  })
})
