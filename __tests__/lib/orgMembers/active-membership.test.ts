import {
  isActiveOrgMembershipRow,
  isOrgRole,
  activeRoleOf,
  type OrgMemberRow,
} from '@/lib/orgMembers/active-membership'

describe('isActiveOrgMembershipRow (central active-membership predicate)', () => {
  it('treats a legacy row without status as active', () => {
    expect(isActiveOrgMembershipRow({ role: 'member' })).toBe(true)
  })

  it('treats explicit active/enabled status as active', () => {
    expect(isActiveOrgMembershipRow({ role: 'admin', status: 'active' })).toBe(true)
    expect(isActiveOrgMembershipRow({ role: 'admin', status: 'enabled' })).toBe(true)
    expect(isActiveOrgMembershipRow({ role: 'member', status: 'ACTIVE' })).toBe(true)
  })

  it('rejects disabled rows', () => {
    expect(isActiveOrgMembershipRow({ role: 'member', disabled: true })).toBe(false)
    expect(isActiveOrgMembershipRow({ role: 'member', status: 'disabled' })).toBe(false)
  })

  it('rejects revoked rows', () => {
    expect(isActiveOrgMembershipRow({ role: 'member', revoked: true })).toBe(false)
    expect(isActiveOrgMembershipRow({ role: 'member', revokedAt: '2026-08-09T00:00:00Z' })).toBe(false)
    expect(isActiveOrgMembershipRow({ role: 'member', status: 'revoked' })).toBe(false)
  })

  it('rejects deleted rows', () => {
    expect(isActiveOrgMembershipRow({ role: 'member', deleted: true })).toBe(false)
    expect(isActiveOrgMembershipRow({ role: 'member', deletedAt: '2026-08-09T00:00:00Z' })).toBe(false)
    expect(isActiveOrgMembershipRow({ role: 'member', status: 'deleted' })).toBe(false)
    expect(isActiveOrgMembershipRow({ role: 'member', status: 'removed' })).toBe(false)
  })

  it('rejects inactive/suspended/left/churned rows', () => {
    expect(isActiveOrgMembershipRow({ role: 'member', inactive: true })).toBe(false)
    expect(isActiveOrgMembershipRow({ role: 'member', status: 'inactive' })).toBe(false)
    expect(isActiveOrgMembershipRow({ role: 'member', status: 'suspended' })).toBe(false)
    expect(isActiveOrgMembershipRow({ role: 'member', status: 'left' })).toBe(false)
    expect(isActiveOrgMembershipRow({ role: 'member', status: 'churned' })).toBe(false)
    expect(isActiveOrgMembershipRow({ role: 'member', archived: true })).toBe(false)
  })

  it('rejects null, undefined and non-object rows', () => {
    expect(isActiveOrgMembershipRow(null)).toBe(false)
    expect(isActiveOrgMembershipRow(undefined)).toBe(false)
    expect(isActiveOrgMembershipRow('member' as unknown as OrgMemberRow)).toBe(false)
  })

  it('rejects unknown status values (fail closed)', () => {
    expect(isActiveOrgMembershipRow({ role: 'member', status: 'pending' })).toBe(false)
    expect(isActiveOrgMembershipRow({ role: 'member', status: 'invited' })).toBe(false)
  })
})

describe('isOrgRole / activeRoleOf', () => {
  it('accepts only canonical OrgRole values', () => {
    expect(isOrgRole('owner')).toBe(true)
    expect(isOrgRole('admin')).toBe(true)
    expect(isOrgRole('member')).toBe(true)
    expect(isOrgRole('viewer')).toBe(true)
    expect(isOrgRole('superadmin')).toBe(false)
    expect(isOrgRole(undefined)).toBe(false)
  })

  it('activeRoleOf returns the role only for active rows', () => {
    expect(activeRoleOf({ role: 'admin' })).toBe('admin')
    expect(activeRoleOf({ role: 'admin', status: 'active' })).toBe('admin')
    expect(activeRoleOf({ role: 'admin', disabled: true })).toBeNull()
    expect(activeRoleOf({ role: 'admin', revoked: true })).toBeNull()
    expect(activeRoleOf({ role: 'admin', status: 'deleted' })).toBeNull()
    expect(activeRoleOf({ role: 'not-a-role' })).toBeNull()
    expect(activeRoleOf(null)).toBeNull()
  })
})
