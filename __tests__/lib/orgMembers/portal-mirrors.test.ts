import { normalizePortalUserOrgIds, portalUserMembershipUpdate } from '@/lib/orgMembers/portal-mirrors'

describe('normalizePortalUserOrgIds', () => {
  it('adds the org without replacing a staff primary orgId of pib-platform-owner', () => {
    expect(normalizePortalUserOrgIds({
      role: 'admin',
      orgId: 'pib-platform-owner',
      orgIds: [],
    }, 'client-org')).toEqual(['client-org'])
  })

  it('keeps existing client orgIds and appends the new org', () => {
    expect(normalizePortalUserOrgIds({
      role: 'admin',
      orgId: 'pib-platform-owner',
      orgIds: ['existing-client'],
    }, 'client-org')).toEqual(['existing-client', 'client-org'])
  })
})

describe('portalUserMembershipUpdate', () => {
  it('does not write orgId when the user already has a primary org', () => {
    const update = portalUserMembershipUpdate({
      role: 'admin',
      orgId: 'pib-platform-owner',
    }, 'client-org')

    expect(update.orgIds).toEqual(['client-org'])
    expect(update).not.toHaveProperty('orgId')
  })
})
