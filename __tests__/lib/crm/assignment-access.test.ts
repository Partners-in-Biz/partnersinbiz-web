import {
  crmActorCanReadRecord,
  crmRecordAssignedToUid,
  filterCrmRowsForActor,
  isCrmPrivilegedActor,
  normalizeAllowedUserIds,
  normalizeSharedWithUserPatch,
} from '@/lib/crm/assignment-access'
import {
  FULL_ACCESS_POLICY,
  normalizeMemberAccessPolicy,
} from '@/lib/orgMembers/access-policy'
import type { CrmAuthContext } from '@/lib/auth/crm-middleware'

function ctx(overrides: Partial<CrmAuthContext>): CrmAuthContext {
  return {
    orgId: 'org-1',
    uid: 'uid-admin',
    actor: { uid: 'uid-admin', displayName: 'Admin User', kind: 'human' },
    role: 'admin',
    isAgent: false,
    permissions: {},
    accessPolicy: FULL_ACCESS_POLICY,
    ...overrides,
  }
}

function memberCtx(overrides: Partial<CrmAuthContext> = {}): CrmAuthContext {
  return {
    orgId: 'org-1',
    uid: 'uid-member',
    actor: { uid: 'uid-member', displayName: 'Member', kind: 'human' },
    role: 'member',
    isAgent: false,
    permissions: {},
    accessPolicy: normalizeMemberAccessPolicy({
      preset: 'custom',
      modules: { crm: true },
      recordScopes: { crm: 'owned_or_linked', projects: 'owned_or_linked' },
    }),
    ...overrides,
  }
}

describe('CRM assignment access policy integration', () => {
  it('keeps default admins privileged when their policy is full access', () => {
    expect(isCrmPrivilegedActor(ctx({}))).toBe(true)
  })

  it('does not treat owner-narrowed admins as privileged for record filtering', () => {
    const narrowed = ctx({
      accessPolicy: normalizeMemberAccessPolicy({
        preset: 'custom',
        modules: { crm: true },
        recordScopes: { crm: 'owned_or_linked', projects: 'owned_or_linked' },
      }),
    })

    expect(isCrmPrivilegedActor(narrowed)).toBe(false)
    expect(crmActorCanReadRecord(narrowed, { id: 'c1', orgId: 'org-1', assignedTo: 'uid-other' })).toBe(false)
    expect(crmActorCanReadRecord(narrowed, { id: 'c2', orgId: 'org-1', assignedTo: 'uid-admin' })).toBe(true)
  })

  it('honors the sharedWithUserIds read path for companies', () => {
    const member = memberCtx()
    const record = {
      id: 'c-shared',
      orgId: 'org-1',
      assignedTo: 'uid-other',
      sharedWithUserIds: ['uid-member'],
    }
    expect(crmActorCanReadRecord(member, record)).toBe(true)
    expect(crmRecordAssignedToUid(record, 'uid-member')).toBe(true)
    expect(crmRecordAssignedToUid(record, 'uid-not-shared')).toBe(false)
  })

  it('honors the sharedWithUserIds read path for contacts and linked companies', () => {
    const member = memberCtx()
    const sharedContact = {
      id: 'ct-shared',
      orgId: 'org-1',
      assignedTo: 'uid-other',
      sharedWithUserIds: ['uid-member'],
      companyId: 'co-other',
    }
    expect(crmActorCanReadRecord(member, sharedContact)).toBe(true)

    // A deal referencing the shared contact is readable through the contact map.
    const dealOnSharedContact = {
      id: 'deal-1',
      orgId: 'org-1',
      contactId: 'ct-shared',
    }
    expect(crmActorCanReadRecord(member, dealOnSharedContact, {
      contacts: new Map([['ct-shared', sharedContact]]),
    })).toBe(true)

    // A company not owned and not shared stays hidden even when another staff
    // member's contact links to it (company read needs its own assignment).
    const companyOnly = {
      id: 'co-other',
      orgId: 'org-1',
      assignedTo: 'uid-other',
    }
    expect(crmActorCanReadRecord(member, companyOnly)).toBe(false)
  })

  it('filters CRM lists to shared records for scoped members', () => {
    const member = memberCtx()
    const rows = [
      { id: 'c-owned', orgId: 'org-1', assignedTo: 'uid-member' },
      { id: 'c-shared', orgId: 'org-1', assignedTo: 'uid-other', sharedWithUserIds: ['uid-member'] },
      { id: 'c-hidden', orgId: 'org-1', assignedTo: 'uid-other' },
    ]
    expect(filterCrmRowsForActor(member, rows).map((row) => row.id)).toEqual(['c-owned', 'c-shared'])
  })

  it('normalizes sharedWithUserIds patches fail-closed', () => {
    expect(normalizeSharedWithUserPatch(['a', ' b ', 'a'])).toEqual(['a', 'b'])
    expect(normalizeSharedWithUserPatch('nope')).toBeNull()
    expect(normalizeSharedWithUserPatch(undefined)).toBeNull()
    expect(normalizeAllowedUserIds([' x ', 'x'])).toEqual(['x'])
  })
})
