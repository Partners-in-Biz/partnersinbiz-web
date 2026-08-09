import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'
import type { ApiUser } from '@/lib/api/types'
import type { ClientDocument } from '@/lib/client-documents/types'
import {
  allowedRecipientOrgIds,
  canUserShareViewAttachments,
  canUserShareViewVersions,
  deriveUserShareUserIds,
  hasActiveUserShare,
  isGrantOnlyRecipient,
  revokeUserShares,
  upsertUserShares,
  userShareGrantForUser,
  validateRevokeUserShareInput,
  validateUserShareInput,
  type DocumentUserShare,
  type UserShareInput,
} from '@/lib/client-documents/grants'

const HOLDER = 'pib-platform-owner'
const CLIENT_ORG = 'client-org'
const OTHER_ORG = 'other-org'

function grant(overrides: Partial<DocumentUserShare> = {}): DocumentUserShare {
  return {
    userId: 'client-1',
    recipientOrgId: CLIENT_ORG,
    status: 'active',
    grantedBy: 'admin-1',
    grantedAt: '2026-08-01T00:00:00.000Z',
    permissions: {
      canView: true,
      canComment: false,
      canSuggest: false,
      canViewVersions: true,
      canViewAttachments: true,
      canApprove: false,
    },
    ...overrides,
  }
}

function documentWith(overrides: Partial<ClientDocument> = {}): Partial<ClientDocument> {
  return {
    orgId: HOLDER,
    linked: { clientOrgId: CLIENT_ORG },
    ...overrides,
  }
}

const clientMember: ApiUser = { uid: 'client-1', role: 'client', orgId: CLIENT_ORG }
const clientOtherOrg: ApiUser = { uid: 'client-1', role: 'client', orgId: OTHER_ORG }
const unrelatedUser: ApiUser = { uid: 'client-9', role: 'client', orgId: CLIENT_ORG }
const adminUser: ApiUser = { uid: 'admin-1', role: 'admin' }
const aiUser: ApiUser = { uid: 'ai-agent', role: 'ai' }

describe('allowedRecipientOrgIds', () => {
  it('returns the holder org plus linked recipient client orgs', () => {
    expect(allowedRecipientOrgIds(documentWith())).toEqual([HOLDER, CLIENT_ORG])
  })

  it('never treats the platform holder as a client recipient org', () => {
    const doc = documentWith({ linked: { clientOrgId: HOLDER, clientOrgIds: [CLIENT_ORG, HOLDER] } })
    expect(allowedRecipientOrgIds(doc)).toEqual([HOLDER, CLIENT_ORG])
  })

  it('supports plural clientOrgIds linkage', () => {
    const doc = documentWith({ linked: { clientOrgIds: [CLIENT_ORG, OTHER_ORG] } })
    expect(allowedRecipientOrgIds(doc)).toEqual([HOLDER, CLIENT_ORG, OTHER_ORG])
  })
})

describe('userShareGrantForUser', () => {
  it('returns an active, unexpired grant for the recipient', () => {
    const doc = documentWith({ userShares: [grant()] })
    expect(userShareGrantForUser(doc, 'client-1')?.status).toBe('active')
  })

  it('returns null for a user with no grant', () => {
    const doc = documentWith({ userShares: [grant()] })
    expect(userShareGrantForUser(doc, 'someone-else')).toBeNull()
  })

  it('returns null when the grant is revoked', () => {
    const doc = documentWith({
      userShares: [grant({ status: 'revoked', revokedAt: '2026-08-02T00:00:00.000Z', revokedBy: 'admin-1' })],
    })
    expect(userShareGrantForUser(doc, 'client-1')).toBeNull()
  })

  it('returns null when the grant is expired', () => {
    const doc = documentWith({
      userShares: [grant({ expiresAt: '2020-01-01T00:00:00.000Z' })],
    })
    expect(userShareGrantForUser(doc, 'client-1')).toBeNull()
  })

  it('returns null when the recipient org is no longer linked to the document', () => {
    const doc = documentWith({
      linked: { clientOrgId: OTHER_ORG },
      userShares: [grant()], // stamped against CLIENT_ORG which is no longer linked
    })
    expect(userShareGrantForUser(doc, 'client-1')).toBeNull()
  })

  it('returns null when the grant has no usable recipient org', () => {
    const doc = documentWith({ userShares: [grant({ recipientOrgId: '' })] })
    expect(userShareGrantForUser(doc, 'client-1')).toBeNull()
  })
})

describe('hasActiveUserShare', () => {
  it('allows a client member of the recipient org with an active grant', () => {
    expect(hasActiveUserShare(documentWith({ userShares: [grant()] }), clientMember)).toBe(true)
  })

  it('allows platform staff via a holder-org grant', () => {
    const doc = documentWith({
      userShares: [grant({ userId: 'admin-1', recipientOrgId: HOLDER }), grant({ userId: 'ai-agent', recipientOrgId: HOLDER })],
    })
    expect(hasActiveUserShare(doc, adminUser)).toBe(true)
    expect(hasActiveUserShare(doc, aiUser)).toBe(true)
  })

  it('denies a revoked grant', () => {
    const doc = documentWith({ userShares: [grant({ status: 'revoked' })] })
    expect(hasActiveUserShare(doc, clientMember)).toBe(false)
  })

  it('denies an expired grant', () => {
    const doc = documentWith({ userShares: [grant({ expiresAt: '2020-01-01T00:00:00.000Z' })] })
    expect(hasActiveUserShare(doc, clientMember)).toBe(false)
  })

  it('denies an unrelated user', () => {
    const doc = documentWith({ userShares: [grant()] })
    expect(hasActiveUserShare(doc, unrelatedUser)).toBe(false)
  })

  it('denies when the recipient does not belong to the grant org', () => {
    const doc = documentWith({ userShares: [grant()] })
    expect(hasActiveUserShare(doc, clientOtherOrg)).toBe(false)
  })

  it('never treats the legacy sharedWithUserIds array as a grant', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const legacy = documentWith({ sharedWithUserIds: ['client-1'] } as any)
    expect(hasActiveUserShare(legacy, clientMember)).toBe(false)
  })

  it('denies when the document has no orgId at all', () => {
    const doc = documentWith({ orgId: undefined, userShares: [grant()] })
    expect(hasActiveUserShare(doc, clientMember)).toBe(false)
  })
})

describe('isGrantOnlyRecipient', () => {
  it('is true for a share-only client recipient', () => {
    const doc = documentWith({ userShares: [grant()] })
    expect(isGrantOnlyRecipient(doc, clientMember)).toBe(true)
  })

  it('is false for holder staff who also hold a share', () => {
    const doc = documentWith({ userShares: [grant({ recipientOrgId: HOLDER })] })
    expect(isGrantOnlyRecipient(doc, adminUser)).toBe(false)
  })
})

describe('version and attachment permission checks', () => {
  it('allows versions when the grant permits them', () => {
    const doc = documentWith({ userShares: [grant()] })
    expect(canUserShareViewVersions(doc, clientMember)).toBe(true)
  })

  it('blocks versions for a grant-only recipient when canViewVersions is false', () => {
    const doc = documentWith({
      userShares: [grant({ permissions: { ...grant().permissions, canViewVersions: false } })],
    })
    expect(canUserShareViewVersions(doc, clientMember)).toBe(false)
  })

  it('does not restrict holder staff', () => {
    const doc = documentWith({
      userShares: [grant({ recipientOrgId: HOLDER, permissions: { ...grant().permissions, canViewVersions: false } })],
    })
    expect(canUserShareViewVersions(doc, adminUser)).toBe(true)
  })

  it('blocks attachments for a grant-only recipient when canViewAttachments is false', () => {
    const doc = documentWith({
      userShares: [grant({ permissions: { ...grant().permissions, canViewAttachments: false } })],
    })
    expect(canUserShareViewAttachments(doc, clientMember)).toBe(false)
  })
})

describe('deriveUserShareUserIds', () => {
  it('derives active, non-expired recipient ids only', () => {
    const doc = documentWith({
      userShares: [
        grant({ userId: 'client-1' }),
        grant({ userId: 'client-2', status: 'revoked' }),
        grant({ userId: 'client-3', expiresAt: '2020-01-01T00:00:00.000Z' }),
        grant({ userId: 'client-4', recipientOrgId: OTHER_ORG }),
      ],
    })
    expect(deriveUserShareUserIds(doc)).toEqual(['client-1', 'client-4'])
  })
})

describe('validateUserShareInput', () => {
  it('accepts a well-formed share input', () => {
    const result = validateUserShareInput([{ userId: 'client-1', recipientOrgId: CLIENT_ORG }])
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value[0]).toEqual({ userId: 'client-1', recipientOrgId: CLIENT_ORG })
  })

  it('rejects missing userId or recipientOrgId', () => {
    expect(validateUserShareInput([{ userId: '', recipientOrgId: CLIENT_ORG }]).ok).toBe(false)
    expect(validateUserShareInput([{ userId: 'client-1', recipientOrgId: '  ' }]).ok).toBe(false)
  })

  it('rejects a non-array value', () => {
    expect(validateUserShareInput('nope').ok).toBe(false)
  })

  it('rejects an invalid expiresAt', () => {
    expect(
      validateUserShareInput([{ userId: 'client-1', recipientOrgId: CLIENT_ORG, expiresAt: 'not-a-date' }]).ok,
    ).toBe(false)
  })

  it('rejects unknown permission keys', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = validateUserShareInput([{ userId: 'client-1', recipientOrgId: CLIENT_ORG, permissions: { canHack: true } } as any])
    expect(result.ok).toBe(false)
  })
})

describe('validateRevokeUserShareInput', () => {
  it('accepts revoke entries and rejects malformed ones', () => {
    expect(validateRevokeUserShareInput([{ userId: 'client-1', recipientOrgId: CLIENT_ORG }]).ok).toBe(true)
    expect(validateRevokeUserShareInput([{ userId: '', recipientOrgId: CLIENT_ORG }]).ok).toBe(false)
    expect(validateRevokeUserShareInput('nope').ok).toBe(false)
  })
})

describe('upsertUserShares / revokeUserShares', () => {
  const actor = { uid: 'admin-1', role: 'admin' as const }

  it('stamps active grants with provenance and keeps permissions', () => {
    const input: UserShareInput = { userId: 'client-1', recipientOrgId: CLIENT_ORG, permissions: { canViewVersions: false } }
    const { shares, userShareUserIds } = upsertUserShares([], [input], actor)
    expect(shares).toHaveLength(1)
    expect(shares[0]).toMatchObject({
      userId: 'client-1',
      recipientOrgId: CLIENT_ORG,
      status: 'active',
      grantedBy: 'admin-1',
      permissions: { canView: true, canViewVersions: false, canViewAttachments: true },
    })
    expect(userShareUserIds).toEqual(['client-1'])
  })

  it('reactivates a revoked share on re-grant', () => {
    const existing = [grant({ status: 'revoked', revokedBy: 'admin-1', revokedAt: '2026-08-02T00:00:00.000Z' })]
    const { shares } = upsertUserShares(existing, [{ userId: 'client-1', recipientOrgId: CLIENT_ORG }], actor)
    expect(shares[0].status).toBe('active')
    expect(shares[0].revokedAt).toBeUndefined()
    expect(shares[0].revokedBy).toBeUndefined()
  })

  it('revokes a share with audit fields and drops it from the derived index', () => {
    const existing = [grant()]
    const { shares, userShareUserIds } = revokeUserShares(existing, [{ userId: 'client-1', recipientOrgId: CLIENT_ORG }], actor)
    expect(shares[0].status).toBe('revoked')
    expect(shares[0].revokedBy).toBe('admin-1')
    expect(shares[0].revokedAt).toBeTruthy()
    expect(userShareUserIds).toEqual([])
  })
})
