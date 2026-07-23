import {
  filterBillingRecordsForCrmActor,
  crmActorCanReadBillingRecord,
} from '@/lib/billing/crm-record-scope'
import {
  FULL_ACCESS_POLICY,
  normalizeMemberAccessPolicy,
} from '@/lib/orgMembers/access-policy'
import type { CrmAuthContext } from '@/lib/auth/crm-middleware'

const mockCompanyGet = jest.fn()
const mockContactGet = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => {
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

function ctx(overrides: Partial<CrmAuthContext> = {}): CrmAuthContext {
  return {
    orgId: 'org-1',
    uid: 'stean',
    actor: { uid: 'stean', displayName: 'Stean', kind: 'human' },
    role: 'member',
    isAgent: false,
    permissions: {},
    accessPolicy: normalizeMemberAccessPolicy({
      preset: 'crm_sales',
      modules: { crm: true, billing: true },
      recordScopes: { crm: 'owned_or_linked', projects: 'owned_or_linked' },
    }),
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCompanyGet.mockImplementation(async (id: string) => {
    if (id === 'co-stean') {
      return {
        exists: true,
        data: () => ({ orgId: 'org-1', ownerUid: 'stean' }),
      }
    }
    if (id === 'co-other') {
      return {
        exists: true,
        data: () => ({ orgId: 'org-1', ownerUid: 'other' }),
      }
    }
    return { exists: false }
  })
  mockContactGet.mockImplementation(async (id: string) => {
    if (id === 'ct-stean') {
      return {
        exists: true,
        data: () => ({ orgId: 'org-1', assignedTo: 'stean', companyId: 'co-stean' }),
      }
    }
    if (id === 'ct-other') {
      return {
        exists: true,
        data: () => ({ orgId: 'org-1', assignedTo: 'other', companyId: 'co-other' }),
      }
    }
    return { exists: false }
  })
})

describe('billing CRM record scope', () => {
  it('keeps privileged actors unfiltered', async () => {
    const privileged = ctx({ accessPolicy: FULL_ACCESS_POLICY, role: 'owner' })
    const rows = [
      { id: 'inv-1', orgId: 'org-1', companyId: 'co-other' },
      { id: 'inv-2', orgId: 'org-1', companyId: 'co-stean' },
    ]
    await expect(filterBillingRecordsForCrmActor(privileged, rows)).resolves.toEqual(rows)
  })

  it('filters invoices to owned/linked CRM companies and creator', async () => {
    const rows = [
      { id: 'inv-owned-company', orgId: 'org-1', companyId: 'co-stean' },
      { id: 'inv-other-company', orgId: 'org-1', companyId: 'co-other' },
      { id: 'inv-created', orgId: 'org-1', createdBy: 'stean' },
      { id: 'inv-contact', orgId: 'org-1', contactId: 'ct-stean' },
      { id: 'inv-other-contact', orgId: 'org-1', contactId: 'ct-other' },
    ]

    const scoped = await filterBillingRecordsForCrmActor(ctx(), rows)
    expect(scoped.map((row) => row.id)).toEqual([
      'inv-owned-company',
      'inv-created',
      'inv-contact',
    ])
  })

  it('allows detail reads only for owned/linked billing records', async () => {
    await expect(
      crmActorCanReadBillingRecord(ctx(), { id: 'q1', orgId: 'org-1', companyId: 'co-stean' }),
    ).resolves.toBe(true)
    await expect(
      crmActorCanReadBillingRecord(ctx(), { id: 'q2', orgId: 'org-1', companyId: 'co-other' }),
    ).resolves.toBe(false)
  })
})
