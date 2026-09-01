import type { ApiUser } from '@/lib/api/types'

const mockLoadStaff = jest.fn()
const mockCanManageOrgAs = jest.fn()
const mockLoadCompany = jest.fn()
const mockFindDuplicateCompany = jest.fn()

jest.mock('@/lib/orgMembers/platform-staff', () => ({
  loadPlatformStaffMembership: (...args: unknown[]) => mockLoadStaff(...args),
}))

jest.mock('@/lib/orgMembers/permissions', () => ({
  canManageOrgAs: (...args: unknown[]) => mockCanManageOrgAs(...args),
}))

jest.mock('@/lib/companies/store', () => ({
  loadCompany: (...args: unknown[]) => mockLoadCompany(...args),
  findDuplicateCompany: (...args: unknown[]) => mockFindDuplicateCompany(...args),
}))

const staffPolicy = {
  preset: 'custom',
  modules: { crm: true, billing: true },
  recordScopes: { crm: 'owned_or_linked', projects: 'owned_or_linked' },
  capabilities: { invoices: true, quotes: true },
  agentRuntimeAccess: {},
  allowPersonalLlmOnOrgVps: false,
}

const stean: ApiUser = {
  uid: 'stean',
  role: 'client',
  orgId: 'wS5pgwa6c9WbPocf4w0w',
  activeOrgId: 'wS5pgwa6c9WbPocf4w0w',
  orgIds: ['wS5pgwa6c9WbPocf4w0w'],
}

describe('resolvePibStaffIssuerRemap', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCanManageOrgAs.mockResolvedValue(false)
    mockFindDuplicateCompany.mockResolvedValue(null)
    mockLoadStaff.mockResolvedValue({
      platformOrgId: 'pib-platform-owner',
      uid: 'stean',
      role: 'member',
      policy: staffPolicy,
    })
    mockLoadCompany.mockResolvedValue({
      data: {
        id: 'YgKHsbteioeP2NglZamG',
        orgId: 'pib-platform-owner',
        name: 'Elemental',
        linkedOrgId: 'wS5pgwa6c9WbPocf4w0w',
        ownerUid: 'stean',
      },
    })
  })

  it('remaps a client-org staff POST to the platform issuer', async () => {
    const { resolvePibStaffIssuerRemap } = await import('@/lib/billing/staff-issuer-remap')
    const result = await resolvePibStaffIssuerRemap({
      user: stean,
      requestedOrgId: 'wS5pgwa6c9WbPocf4w0w',
      companyId: 'YgKHsbteioeP2NglZamG',
      kind: 'invoices',
    })

    expect(result).toEqual(expect.objectContaining({
      sourceOrgId: 'pib-platform-owner',
      recipientOrgId: 'wS5pgwa6c9WbPocf4w0w',
      companyId: 'YgKHsbteioeP2NglZamG',
      role: 'member',
    }))
  })

  it('does not remap client-org owners (Humanaut path)', async () => {
    mockCanManageOrgAs.mockResolvedValue(true)
    const { resolvePibStaffIssuerRemap } = await import('@/lib/billing/staff-issuer-remap')
    await expect(resolvePibStaffIssuerRemap({
      user: { ...stean, orgId: 'humanaut-org', activeOrgId: 'humanaut-org', orgIds: ['humanaut-org'] },
      requestedOrgId: 'humanaut-org',
      kind: 'invoices',
    })).resolves.toBeNull()
  })

  it('does not remap platform admins', async () => {
    const { resolvePibStaffIssuerRemap } = await import('@/lib/billing/staff-issuer-remap')
    await expect(resolvePibStaffIssuerRemap({
      user: { uid: 'peet', role: 'admin' },
      requestedOrgId: 'wS5pgwa6c9WbPocf4w0w',
      kind: 'invoices',
    })).resolves.toBeNull()
  })

  it('does not remap members without an invoice grant', async () => {
    mockLoadStaff.mockResolvedValue({
      platformOrgId: 'pib-platform-owner',
      uid: 'stean',
      role: 'member',
      policy: { ...staffPolicy, capabilities: { invoices: false, quotes: false } },
    })
    const { resolvePibStaffIssuerRemap } = await import('@/lib/billing/staff-issuer-remap')
    await expect(resolvePibStaffIssuerRemap({
      user: stean,
      requestedOrgId: 'wS5pgwa6c9WbPocf4w0w',
      companyId: 'YgKHsbteioeP2NglZamG',
      kind: 'invoices',
    })).resolves.toBeNull()
  })
})
