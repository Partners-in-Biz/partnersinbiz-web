import {
  actorOwnsRow,
  effectiveRecordScopeForModule,
  filterOwnedRowsForActor,
} from '@/lib/orgMembers/record-scope'
import { DEFAULT_RECORD_SCOPES } from '@/lib/orgMembers/access-policy'
import type { ApiUser } from '@/lib/api/types'

const mockMemberGet = jest.fn()
const mockCompanyGet = jest.fn()
const mockContactGet = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => {
      if (name === 'orgMembers') {
        return { doc: (id: string) => ({ get: () => mockMemberGet(id) }) }
      }
      if (name === 'companies') {
        return { doc: (id: string) => ({ get: () => mockCompanyGet(id) }) }
      }
      if (name === 'contacts') {
        return { doc: (id: string) => ({ get: () => mockContactGet(id) }) }
      }
      throw new Error(`Unexpected collection: ${name}`)
    },
  },
}))

function memberUser(overrides: Partial<ApiUser> = {}): ApiUser {
  return {
    uid: 'stean',
    role: 'member',
    email: 'stean@example.com',
    displayName: 'Stean',
    ...overrides,
  } as ApiUser
}

beforeEach(() => {
  jest.clearAllMocks()
  mockMemberGet.mockResolvedValue({ exists: false })
  mockCompanyGet.mockResolvedValue({ exists: false })
  mockContactGet.mockResolvedValue({ exists: false })
})

describe('org member record scope (research/documents/marketing)', () => {
  it('defaults research/documents/marketing to all for members without an explicit policy', async () => {
    mockMemberGet.mockResolvedValue({ exists: false })

    await expect(effectiveRecordScopeForModule(memberUser(), 'org-1', 'research')).resolves.toBe(
      DEFAULT_RECORD_SCOPES.research,
    )
    await expect(effectiveRecordScopeForModule(memberUser(), 'org-1', 'documents')).resolves.toBe(
      DEFAULT_RECORD_SCOPES.documents,
    )
    await expect(effectiveRecordScopeForModule(memberUser(), 'org-1', 'marketing')).resolves.toBe(
      DEFAULT_RECORD_SCOPES.marketing,
    )
    await expect(effectiveRecordScopeForModule(memberUser(), 'org-1', 'crm')).resolves.toBe(
      DEFAULT_RECORD_SCOPES.crm,
    )
  })

  it('honors an explicit owned_or_linked scope for research', async () => {
    mockMemberGet.mockResolvedValue({
      exists: true,
      data: () => ({
        role: 'member',
        accessPolicy: {
          preset: 'custom',
          modules: { research: true, crm: true },
          recordScopes: { crm: 'owned_or_linked', projects: 'owned_or_linked', research: 'owned_or_linked' },
        },
      }),
    })

    await expect(effectiveRecordScopeForModule(memberUser(), 'org-1', 'research')).resolves.toBe('owned_or_linked')
  })

  it('treats platform admins as always-all', async () => {
    mockMemberGet.mockResolvedValue({ exists: false })
    const admin = memberUser({ role: 'admin' })
    await expect(effectiveRecordScopeForModule(admin, 'org-1', 'research')).resolves.toBe('all')
  })

  it('recognizes ownership and shares in row visibility (actorOwnsRow)', () => {
    expect(actorOwnsRow({ createdBy: 'stean' }, 'stean')).toBe(true)
    expect(actorOwnsRow({ ownerUid: 'stean' }, 'stean')).toBe(true)
    expect(actorOwnsRow({ createdByRef: { uid: 'stean' } }, 'stean')).toBe(true)
    expect(actorOwnsRow({ sharedWithUserIds: ['stean'] }, 'stean')).toBe(true)
    expect(actorOwnsRow({ allowedUserIds: ['stean'] }, 'stean')).toBe(true)
    expect(actorOwnsRow({ createdBy: 'other' }, 'stean')).toBe(false)
  })

  it('filters owned rows by creator/share when scope is owned_or_linked', async () => {
    mockMemberGet.mockResolvedValue({
      exists: true,
      data: () => ({
        role: 'member',
        accessPolicy: {
          preset: 'custom',
          modules: { research: true },
          recordScopes: { research: 'owned_or_linked' },
        },
      }),
    })

    const rows = [
      { id: 'r1', createdBy: 'stean' },
      { id: 'r2', createdBy: 'other', sharedWithUserIds: ['stean'] },
      { id: 'r3', createdBy: 'other' },
    ]
    const filtered = await filterOwnedRowsForActor(memberUser(), 'org-1', 'research', rows)
    expect(filtered.map((row) => row.id)).toEqual(['r1', 'r2'])
  })

  it('keeps rows when scope is all', async () => {
    mockMemberGet.mockResolvedValue({
      exists: true,
      data: () => ({
        role: 'member',
        accessPolicy: {
          preset: 'custom',
          modules: { research: true },
          recordScopes: { research: 'all' },
        },
      }),
    })

    const rows = [
      { id: 'r1', createdBy: 'stean' },
      { id: 'r2', createdBy: 'other' },
    ]
    const filtered = await filterOwnedRowsForActor(memberUser(), 'org-1', 'research', rows)
    expect(filtered.map((row) => row.id)).toEqual(['r1', 'r2'])
  })

  it('keeps rows linked to CRM companies the actor owns', async () => {
    mockMemberGet.mockResolvedValue({
      exists: true,
      data: () => ({
        role: 'member',
        accessPolicy: {
          preset: 'custom',
          modules: { marketing: true },
          recordScopes: { marketing: 'owned_or_linked' },
        },
      }),
    })
    mockCompanyGet.mockImplementation(async (id: string) => {
      if (id === 'co-owned') {
        return { exists: true, data: () => ({ orgId: 'org-1', ownerUid: 'stean' }) }
      }
      return { exists: false }
    })

    const rows = [
      { id: 'm1', linked: { companyIds: ['co-owned'] } },
      { id: 'm2', linked: { companyIds: ['co-other'] } },
    ]
    const filtered = await filterOwnedRowsForActor(memberUser(), 'org-1', 'marketing', rows)
    expect(filtered.map((row) => row.id)).toEqual(['m1'])
  })

  it('keeps marketing rows linked to CRM companies via top-level relationship fields', async () => {
    mockMemberGet.mockResolvedValue({
      exists: true,
      data: () => ({
        role: 'member',
        accessPolicy: {
          preset: 'custom',
          modules: { marketing: true },
          recordScopes: { marketing: 'owned_or_linked' },
        },
      }),
    })
    mockCompanyGet.mockImplementation(async (id: string) => {
      if (id === 'co-owned') {
        return { exists: true, data: () => ({ orgId: 'org-1', ownerUid: 'stean' }) }
      }
      return { exists: false }
    })

    // Campaigns and social posts spread normalized relationship links at the
    // top level (companyIds / companyId), not under a nested `linked` field.
    const rows = [
      { id: 'c1', companyIds: ['co-owned'] },
      { id: 'c2', companyIds: ['co-other'] },
      { id: 'c3', companyId: 'co-owned' },
      { id: 'c4', companyId: 'co-other' },
    ]
    const filtered = await filterOwnedRowsForActor(memberUser(), 'org-1', 'marketing', rows)
    expect(filtered.map((row) => row.id)).toEqual(['c1', 'c3'])
  })

  it('keeps marketing rows linked to CRM contacts the actor owns via top-level fields', async () => {
    mockMemberGet.mockResolvedValue({
      exists: true,
      data: () => ({
        role: 'member',
        accessPolicy: {
          preset: 'custom',
          modules: { marketing: true },
          recordScopes: { marketing: 'owned_or_linked' },
        },
      }),
    })
    mockContactGet.mockImplementation(async (id: string) => {
      if (id === 'ct-owned') {
        return { exists: true, data: () => ({ orgId: 'org-1', ownerUid: 'stean' }) }
      }
      return { exists: false }
    })

    const rows = [
      { id: 'p1', contactIds: ['ct-owned'] },
      { id: 'p2', contactIds: ['ct-other'] },
      { id: 'p3', contactId: 'ct-owned' },
    ]
    const filtered = await filterOwnedRowsForActor(memberUser(), 'org-1', 'marketing', rows)
    expect(filtered.map((row) => row.id)).toEqual(['p1', 'p3'])
  })
})
