// __tests__/lib/portal/org-access.test.ts
//
// Regression tests for the P0 restricted-admin portal scope + active
// membership enforcement. Covers:
//   - implicit admin "any existing org" entry is removed
//   - restricted admins honour allowedOrgIds (assigned scope)
//   - stale activeOrgId pointers never grant access (revoked/deleted/inactive)
//   - org switch attempts outside scope are rejected

const mockMemberWhere = jest.fn()
const mockMemberGet = jest.fn()
const mockMemberDocGet = jest.fn()
const mockOrgDocGet = jest.fn()
const mockCollection = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

import {
  canUsePortalOrg,
  getPortalOrgIdsForUser,
  resolvePortalActiveOrgId,
} from '@/lib/portal/org-access'

type MemberRow = Record<string, unknown>

let memberDocs: Array<{ id: string; data: () => MemberRow }> = []
let orgDataByOrg: Record<string, { exists: boolean; data: () => Record<string, unknown> }> = {}

function setMembers(rows: Array<{ orgId: string; row?: MemberRow }>) {
  memberDocs = rows.map(({ orgId, row }) => ({
    id: `${orgId}_user-1`,
    data: () => ({ orgId, uid: 'user-1', ...(row ?? {}) }),
  }))
}

function setOrgs(orgs: Record<string, { exists?: boolean; data?: Record<string, unknown> }>) {
  orgDataByOrg = Object.fromEntries(
    Object.entries(orgs).map(([orgId, cfg]) => [
      orgId,
      {
        exists: cfg.exists ?? true,
        data: () => ({ deleted: false, archived: false, status: 'active', ...(cfg.data ?? {}) }),
      },
    ])
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  memberDocs = []
  orgDataByOrg = {}
  mockMemberWhere.mockReturnValue({ get: mockMemberGet })
  mockMemberGet.mockImplementation(() => Promise.resolve({ docs: memberDocs }))
  mockMemberDocGet.mockResolvedValue({ exists: false, data: () => ({}) })
  mockOrgDocGet.mockResolvedValue({ exists: false, data: () => ({}) })

  mockCollection.mockImplementation((name: string) => {
    if (name === 'orgMembers') {
      return {
        where: mockMemberWhere,
        doc: (docId: string) => ({
          get: async () => {
            const found = memberDocs.find((doc) => doc.id === docId)
            if (found) {
              return { exists: true, data: () => found.data() }
            }
            return mockMemberDocGet()
          },
        }),
      }
    }
    if (name === 'organizations') {
      return {
        doc: (orgId: string) => ({
          get: async () => {
            const cfg = orgDataByOrg[orgId]
            if (cfg) return { exists: cfg.exists, data: cfg.data }
            return mockOrgDocGet()
          },
        }),
      }
    }
    throw new Error(`Unexpected collection: ${name}`)
  })
})

describe('canUsePortalOrg — admin scope', () => {
  it('does NOT let a restricted admin enter an org outside allowedOrgIds (implicit global entry removed)', async () => {
    setMembers([])
    setOrgs({ 'client-org': { data: { deleted: false, status: 'active' } } })
    const data = { role: 'admin', orgId: 'pib-platform-owner', allowedOrgIds: ['assigned-org'] }

    await expect(canUsePortalOrg('user-1', data, 'client-org')).resolves.toBe(false)
  })

  it('lets a restricted admin enter an org in allowedOrgIds', async () => {
    setMembers([])
    setOrgs({ 'assigned-org': { data: { deleted: false, status: 'active' } } })
    const data = { role: 'admin', orgId: 'pib-platform-owner', allowedOrgIds: ['assigned-org'] }

    await expect(canUsePortalOrg('user-1', data, 'assigned-org')).resolves.toBe(true)
  })

  it('lets an admin enter their home orgId even without allowedOrgIds', async () => {
    setMembers([])
    setOrgs({ 'pib-platform-owner': { data: { deleted: false, status: 'active' } } })
    const data = { role: 'admin', orgId: 'pib-platform-owner' }

    await expect(canUsePortalOrg('user-1', data, 'pib-platform-owner')).resolves.toBe(true)
  })

  it('does NOT let a super admin (no allowedOrgIds) enter an arbitrary org (no implicit any-org entry)', async () => {
    setMembers([])
    setOrgs({ 'client-org': { data: { deleted: false, status: 'active' } } })
    const data = { role: 'admin', orgId: 'pib-platform-owner' }

    await expect(canUsePortalOrg('user-1', data, 'client-org')).resolves.toBe(false)
  })

  it('rejects an admin entering a deleted/archived/suspended/churned org', async () => {
    setMembers([])
    setOrgs({ 'gone-org': { data: { deleted: true, status: 'active' } } })
    const data = { role: 'admin', orgId: 'pib-platform-owner', allowedOrgIds: ['gone-org'] }

    await expect(canUsePortalOrg('user-1', data, 'gone-org')).resolves.toBe(false)

    setOrgs({ 'suspended-org': { data: { deleted: false, status: 'suspended' } } })
    await expect(canUsePortalOrg('user-1', { role: 'admin', orgId: 'pib-platform-owner', allowedOrgIds: ['suspended-org'] }, 'suspended-org')).resolves.toBe(false)
  })

  it('lets an admin enter via explicit active orgMembers membership even outside allowedOrgIds', async () => {
    setMembers([{ orgId: 'member-org', row: { role: 'owner' } }])
    setOrgs({ 'member-org': { data: { deleted: false, status: 'active' } } })
    const data = { role: 'admin', orgId: 'pib-platform-owner', allowedOrgIds: [] }

    await expect(canUsePortalOrg('user-1', data, 'member-org')).resolves.toBe(true)
  })
})

describe('canUsePortalOrg — active membership (stale / revoked / disabled / deleted rows)', () => {
  it('grants access for an active orgMembers row', async () => {
    setMembers([{ orgId: 'org-a', row: { role: 'member' } }])
    setOrgs({ 'org-a': {} })
    const data = { role: 'client', orgId: 'org-a' }

    await expect(canUsePortalOrg('user-1', data, 'org-a')).resolves.toBe(true)
  })

  it('rejects a disabled orgMembers row even when the user pointer claims the org', async () => {
    setMembers([{ orgId: 'org-a', row: { role: 'member', disabled: true } }])
    setOrgs({ 'org-a': {} })
    const data = { role: 'client', orgId: 'org-a', activeOrgId: 'org-a', orgIds: ['org-a'] }

    await expect(canUsePortalOrg('user-1', data, 'org-a')).resolves.toBe(false)
  })

  it('rejects a revoked orgMembers row', async () => {
    setMembers([{ orgId: 'org-a', row: { role: 'member', revoked: true } }])
    setOrgs({ 'org-a': {} })
    const data = { role: 'client', orgId: 'org-a', activeOrgId: 'org-a' }

    await expect(canUsePortalOrg('user-1', data, 'org-a')).resolves.toBe(false)
  })

  it('rejects a deleted orgMembers row', async () => {
    setMembers([{ orgId: 'org-a', row: { role: 'member', deleted: true } }])
    setOrgs({ 'org-a': {} })
    const data = { role: 'client', orgId: 'org-a', activeOrgId: 'org-a' }

    await expect(canUsePortalOrg('user-1', data, 'org-a')).resolves.toBe(false)
  })

  it('rejects a row with status inactive', async () => {
    setMembers([{ orgId: 'org-a', row: { role: 'member', status: 'inactive' } }])
    setOrgs({ 'org-a': {} })
    const data = { role: 'client', orgId: 'org-a', activeOrgId: 'org-a' }

    await expect(canUsePortalOrg('user-1', data, 'org-a')).resolves.toBe(false)
  })

  it('rejects a stale pointer to an org where the membership row is gone entirely', async () => {
    setMembers([])
    setOrgs({ 'org-a': {} })
    const data = { role: 'client', orgId: 'org-a', activeOrgId: 'org-a', orgIds: ['org-a'] }

    await expect(canUsePortalOrg('user-1', data, 'org-a')).resolves.toBe(false)
  })

  it('rejects a non-member client trying to switch into another org (org switch attempt)', async () => {
    setMembers([{ orgId: 'org-a', row: { role: 'member' } }])
    setOrgs({ 'org-a': {}, 'org-b': {} })
    const data = { role: 'client', orgId: 'org-a', activeOrgId: 'org-a', orgIds: ['org-a'] }

    await expect(canUsePortalOrg('user-1', data, 'org-b')).resolves.toBe(false)
  })

  it('accepts a legacy organizations.members array entry as active membership', async () => {
    setMembers([])
    setOrgs({ 'legacy-org': { data: { members: [{ userId: 'user-1', role: 'viewer' }] } } })
    const data = { role: 'client', orgId: 'legacy-org', activeOrgId: 'legacy-org' }

    await expect(canUsePortalOrg('user-1', data, 'legacy-org')).resolves.toBe(true)
  })

  it('rejects a legacy members array entry that is disabled/revoked', async () => {
    setMembers([])
    setOrgs({
      'legacy-org': { data: { members: [{ userId: 'user-1', role: 'viewer', disabled: true }] } },
    })
    const data = { role: 'client', orgId: 'legacy-org', activeOrgId: 'legacy-org' }

    await expect(canUsePortalOrg('user-1', data, 'legacy-org')).resolves.toBe(false)
  })
})

describe('resolvePortalActiveOrgId / getPortalOrgIdsForUser — stale sessions', () => {
  it('never resolves a stale activeOrgId that no longer has active membership', async () => {
    setMembers([{ orgId: 'org-a', row: { role: 'member' } }])
    setOrgs({ 'org-a': {}, 'stale-org': {} })
    const data = { role: 'client', orgId: 'org-a', activeOrgId: 'stale-org', orgIds: ['org-a', 'stale-org'] }

    await expect(resolvePortalActiveOrgId('user-1', data)).resolves.toBe('org-a')
  })

  it('lists only active membership orgs for a client (revoked org excluded)', async () => {
    setMembers([
      { orgId: 'org-a', row: { role: 'member' } },
      { orgId: 'org-b', row: { role: 'member', revoked: true } },
    ])
    setOrgs({ 'org-a': {}, 'org-b': {} })
    const data = { role: 'client', orgId: 'org-a', orgIds: ['org-a', 'org-b'] }

    await expect(getPortalOrgIdsForUser('user-1', data)).resolves.toEqual(['org-a'])
  })

  it('lists assigned orgs for a restricted admin only', async () => {
    setMembers([])
    setOrgs({ 'assigned-org': {}, 'pib-platform-owner': {}, 'other-org': {} })
    const data = { role: 'admin', orgId: 'pib-platform-owner', allowedOrgIds: ['assigned-org'] }

    const orgIds = await getPortalOrgIdsForUser('user-1', data)
    expect(orgIds).toContain('assigned-org')
    expect(orgIds).toContain('pib-platform-owner')
    expect(orgIds).not.toContain('other-org')
  })

  it('super admin lists home org only, not arbitrary orgs, without membership', async () => {
    setMembers([])
    setOrgs({ 'pib-platform-owner': {}, 'client-org': {} })
    const data = { role: 'admin', orgId: 'pib-platform-owner' }

    const orgIds = await getPortalOrgIdsForUser('user-1', data)
    expect(orgIds).toContain('pib-platform-owner')
    expect(orgIds).not.toContain('client-org')
  })

  it('lists all orgs where user is an owner (portal switcher bug regression)', async () => {
    setMembers([
      { orgId: 'pib-platform-owner', row: { role: 'owner' } },
      { orgId: 'velox-org', row: { role: 'owner' } },
      { orgId: 'lumen-org', row: { role: 'owner' } },
    ])
    setOrgs({
      'pib-platform-owner': { data: { name: 'Partners in Biz', type: 'platform_owner' } },
      'velox-org': { data: { name: 'Velox', type: 'platform_product' } },
      'lumen-org': { data: { name: 'Lumen', type: 'platform_product' } },
    })
    const data = { role: 'admin', orgId: 'pib-platform-owner' }

    const orgIds = await getPortalOrgIdsForUser('user-1', data)
    expect(orgIds).toContain('pib-platform-owner')
    expect(orgIds).toContain('velox-org')
    expect(orgIds).toContain('lumen-org')
    expect(orgIds.length).toBeGreaterThanOrEqual(3)
  })

  it('includes orgs with incomplete portal setup (no areas configured yet)', async () => {
    setMembers([
      { orgId: 'org-with-areas', row: { role: 'owner' } },
      { orgId: 'org-without-areas', row: { role: 'owner' } },
    ])
    setOrgs({
      'org-with-areas': { data: { name: 'Configured Org' } },
      'org-without-areas': { data: { name: 'New Org' } },
    })
    const data = { role: 'client', orgId: 'org-with-areas' }

    const orgIds = await getPortalOrgIdsForUser('user-1', data)
    expect(orgIds).toContain('org-with-areas')
    expect(orgIds).toContain('org-without-areas')
  })

  it('includes owner memberships with pending/onboarding/setup status (portal switcher fix)', async () => {
    setMembers([
      { orgId: 'pib-platform-owner', row: { role: 'owner', status: 'active' } },
      { orgId: 'velox-org', row: { role: 'owner', status: 'onboarding' } },
      { orgId: 'lumen-org', row: { role: 'owner', status: 'pending' } },
      { orgId: 'client-org', row: { role: 'member', status: 'onboarding' } },
    ])
    setOrgs({
      'pib-platform-owner': {},
      'velox-org': {},
      'lumen-org': {},
      'client-org': {},
    })
    const data = { role: 'admin', orgId: 'pib-platform-owner' }

    const orgIds = await getPortalOrgIdsForUser('user-1', data)
    expect(orgIds).toContain('pib-platform-owner')
    expect(orgIds).toContain('velox-org')
    expect(orgIds).toContain('lumen-org')
    // Regular members with onboarding status should NOT be included
    expect(orgIds).not.toContain('client-org')
  })

  it('includes owner memberships with ANY non-negative status (draft, configuring, etc.)', async () => {
    setMembers([
      { orgId: 'active-org', row: { role: 'owner', status: 'active' } },
      { orgId: 'draft-org', row: { role: 'owner', status: 'draft' } },
      { orgId: 'configuring-org', row: { role: 'owner', status: 'configuring' } },
      { orgId: 'invited-org', row: { role: 'owner', status: 'invited' } },
      { orgId: 'unknown-org', row: { role: 'owner', status: 'some-unknown-status' } },
      { orgId: 'member-draft', row: { role: 'member', status: 'draft' } },
    ])
    setOrgs({
      'active-org': {},
      'draft-org': {},
      'configuring-org': {},
      'invited-org': {},
      'unknown-org': {},
      'member-draft': {},
    })
    const data = { role: 'admin', orgId: 'active-org' }

    const orgIds = await getPortalOrgIdsForUser('user-1', data)
    // All owner memberships with any non-negative status should be included
    expect(orgIds).toContain('active-org')
    expect(orgIds).toContain('draft-org')
    expect(orgIds).toContain('configuring-org')
    expect(orgIds).toContain('invited-org')
    expect(orgIds).toContain('unknown-org')
    // Members with non-active status should still be excluded
    expect(orgIds).not.toContain('member-draft')
  })

  it('excludes owner memberships with explicitly inactive/disabled/revoked status', async () => {
    setMembers([
      { orgId: 'active-org', row: { role: 'owner', status: 'active' } },
      { orgId: 'disabled-org', row: { role: 'owner', status: 'active', disabled: true } },
      { orgId: 'revoked-org', row: { role: 'owner', status: 'active', revoked: true } },
      { orgId: 'deleted-org', row: { role: 'owner', status: 'active', deleted: true } },
    ])
    setOrgs({
      'active-org': {},
      'disabled-org': {},
      'revoked-org': {},
      'deleted-org': {},
    })
    const data = { role: 'admin', orgId: 'active-org' }

    const orgIds = await getPortalOrgIdsForUser('user-1', data)
    expect(orgIds).toContain('active-org')
    expect(orgIds).not.toContain('disabled-org')
    expect(orgIds).not.toContain('revoked-org')
    expect(orgIds).not.toContain('deleted-org')
  })

  it('excludes owner memberships with negative status strings (suspended, churned, revoked, etc.)', async () => {
    setMembers([
      { orgId: 'active-org', row: { role: 'owner', status: 'active' } },
      { orgId: 'suspended-org', row: { role: 'owner', status: 'suspended' } },
      { orgId: 'churned-org', row: { role: 'owner', status: 'churned' } },
      { orgId: 'revoked-status-org', row: { role: 'owner', status: 'revoked' } },
      { orgId: 'deleted-status-org', row: { role: 'owner', status: 'deleted' } },
      { orgId: 'inactive-status-org', row: { role: 'owner', status: 'inactive' } },
    ])
    setOrgs({
      'active-org': {},
      'suspended-org': {},
      'churned-org': {},
      'revoked-status-org': {},
      'deleted-status-org': {},
      'inactive-status-org': {},
    })
    const data = { role: 'admin', orgId: 'active-org' }

    const orgIds = await getPortalOrgIdsForUser('user-1', data)
    expect(orgIds).toContain('active-org')
    expect(orgIds).not.toContain('suspended-org')
    expect(orgIds).not.toContain('churned-org')
    expect(orgIds).not.toContain('revoked-status-org')
    expect(orgIds).not.toContain('deleted-status-org')
    expect(orgIds).not.toContain('inactive-status-org')
  })
})
