import {
  extractLegacyPointers,
  promoteActiveRelationshipPair,
  promoteShareToResourceGrant,
  seedIdentityLinksFromPointers,
} from '@/lib/cross-org/migration'

describe('extractLegacyPointers', () => {
  it('normalises legacy convenience pointers', () => {
    const result = extractLegacyPointers({
      linkedOrgId: 'org-client',
      linkedUserId: 'user-1',
      allowedOrgIds: ['org-a', ' org-b '],
      allowedUserIds: ['user-1', ''],
    })
    expect(result.linkedOrgId).toBe('org-client')
    expect(result.linkedUserId).toBe('user-1')
    expect(result.allowedOrgIds).toEqual(['org-a', 'org-b'])
    expect(result.allowedUserIds).toEqual(['user-1'])
    expect(result.hasAny).toBe(true)
  })

  it('reports no pointers when the row has none', () => {
    const result = extractLegacyPointers({})
    expect(result.hasAny).toBe(false)
    expect(result.linkedOrgId).toBe('')
  })
})

describe('promoteActiveRelationshipPair', () => {
  it('promotes an active mirrored pair sharing partnerLinkId', () => {
    const a = {
      id: 'rel-a',
      sourceOrgId: 'org-a',
      targetOrgId: 'org-b',
      partnerLinkId: 'link-1',
      status: 'active',
      sharedCapabilities: ['documents', 'projects'],
    }
    const b = {
      id: 'rel-b',
      sourceOrgId: 'org-b',
      targetOrgId: 'org-a',
      partnerLinkId: 'link-1',
      status: 'active',
      sharedCapabilities: ['documents'],
    }
    const candidate = promoteActiveRelationshipPair(a, b)
    expect(candidate).not.toBeNull()
    expect(candidate?.orgA).toBe('org-a')
    expect(candidate?.orgB).toBe('org-b')
    expect(candidate?.relationshipIdA).toBe('rel-a')
    expect(candidate?.relationshipIdB).toBe('rel-b')
    expect(candidate?.negotiableCapabilities).toEqual(expect.arrayContaining(['documents', 'projects']))
  })

  it('refuses when partnerLinkId does not match', () => {
    const a = { id: 'rel-a', sourceOrgId: 'org-a', targetOrgId: 'org-b', partnerLinkId: 'link-1', status: 'active' }
    const b = { id: 'rel-b', sourceOrgId: 'org-b', targetOrgId: 'org-a', partnerLinkId: 'link-2', status: 'active' }
    expect(promoteActiveRelationshipPair(a, b)).toBeNull()
  })

  it('refuses when either row is not active or deleted', () => {
    const a = { id: 'rel-a', sourceOrgId: 'org-a', targetOrgId: 'org-b', partnerLinkId: 'link-1', status: 'active' }
    const b = { id: 'rel-b', sourceOrgId: 'org-b', targetOrgId: 'org-a', partnerLinkId: 'link-1', status: 'revoked' }
    expect(promoteActiveRelationshipPair(a, b)).toBeNull()
    expect(promoteActiveRelationshipPair({ ...a, deleted: true }, { ...b, status: 'active' })).toBeNull()
  })

  it('refuses when the mirror contract is broken (targets mismatch)', () => {
    const a = { id: 'rel-a', sourceOrgId: 'org-a', targetOrgId: 'org-b', partnerLinkId: 'link-1', status: 'active' }
    const b = { id: 'rel-b', sourceOrgId: 'org-b', targetOrgId: 'org-c', partnerLinkId: 'link-1', status: 'active' }
    expect(promoteActiveRelationshipPair(a, b)).toBeNull()
  })

  it('never fabricates a link from a single row', () => {
    const a = { id: 'rel-a', sourceOrgId: 'org-a', targetOrgId: 'org-b', partnerLinkId: 'link-1', status: 'active' }
    expect(promoteActiveRelationshipPair(a, a)).toBeNull()
  })
})

describe('promoteShareToResourceGrant', () => {
  it('promotes an active partner share to a resource grant with provenance', () => {
    const grant = promoteShareToResourceGrant({
      id: 'share-1',
      partnerLinkId: 'link-1',
      resourceType: 'project',
      resourceId: 'proj-1',
      partnerOrgId: 'org-b',
      ownerOrgId: 'org-a',
      permission: 'comment',
      status: 'active',
    })
    expect(grant).not.toBeNull()
    expect(grant?.partnerLinkId).toBe('link-1')
    expect(grant?.resourceType).toBe('project')
    expect(grant?.grantee.orgIds).toEqual(['org-b'])
    expect(grant?.actions).toEqual(['view', 'comment'])
    expect(grant?.provenance.sourceShareId).toBe('share-1')
    expect(grant?.approvalBasis).toEqual({ type: 'partner_link', refId: 'link-1' })
  })

  it('maps client_document shares to document grants', () => {
    const grant = promoteShareToResourceGrant({
      id: 'share-2',
      partnerLinkId: 'link-1',
      resourceType: 'client_document',
      resourceId: 'doc-1',
      partnerOrgId: 'org-b',
      ownerOrgId: 'org-a',
      status: 'active',
    })
    expect(grant?.resourceType).toBe('document')
  })

  it('refuses revoked or incomplete shares', () => {
    const base = {
      id: 'share-3',
      partnerLinkId: 'link-1',
      resourceType: 'project',
      resourceId: 'proj-1',
      partnerOrgId: 'org-b',
      ownerOrgId: 'org-a',
      status: 'revoked',
    }
    expect(promoteShareToResourceGrant(base)).toBeNull()
    expect(promoteShareToResourceGrant({ ...base, status: 'active', partnerLinkId: undefined })).toBeNull()
  })
})

describe('seedIdentityLinksFromPointers', () => {
  it('seeds company_org, contact_user and contact_org links as unverified', () => {
    const seeds = seedIdentityLinksFromPointers({
      companyId: 'company-1',
      contactId: 'contact-1',
      pointers: { linkedOrgId: 'org-client', linkedUserId: 'user-1' },
      sourceInviteId: 'invite-1',
    })
    expect(seeds).toHaveLength(3)
    expect(seeds.map((s) => s.linkType).sort()).toEqual(['company_org', 'contact_org', 'contact_user'])
    expect(seeds.every((s) => s.status === 'unverified')).toBe(true)
    expect(seeds.every((s) => s.provenance.sourceInviteId === 'invite-1')).toBe(true)
  })

  it('does not seed when no pointers exist', () => {
    const seeds = seedIdentityLinksFromPointers({
      companyId: 'company-1',
      contactId: 'contact-1',
      pointers: {},
    })
    expect(seeds).toEqual([])
  })
})
