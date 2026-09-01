/**
 * @jest-environment node
 */
const mockLoadStaff = jest.fn()
const mockFindDuplicate = jest.fn()

jest.mock('@/lib/orgMembers/platform-staff', () => ({
  loadPlatformStaffMembership: (...args: unknown[]) => mockLoadStaff(...args),
}))

jest.mock('@/lib/companies/store', () => ({
  findDuplicateCompany: (...args: unknown[]) => mockFindDuplicate(...args),
}))

import { pibStaffCanServeClientOrg } from '@/lib/auth/staff-client-org'

describe('pibStaffCanServeClientOrg', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('is true when platform CRM has a company linked to the client org', async () => {
    mockLoadStaff.mockResolvedValue({ platformOrgId: 'pib-platform-owner' })
    mockFindDuplicate.mockResolvedValue({ id: 'YgKHsbteioeP2NglZamG' })
    await expect(pibStaffCanServeClientOrg(
      { uid: 'stean', role: 'client' },
      'wS5pgwa6c9WbPocf4w0w',
    )).resolves.toBe(true)
    expect(mockFindDuplicate).toHaveBeenCalledWith('pib-platform-owner', { linkedOrgId: 'wS5pgwa6c9WbPocf4w0w' })
  })

  it('is false when the caller is not PiB staff', async () => {
    mockLoadStaff.mockResolvedValue(null)
    await expect(pibStaffCanServeClientOrg(
      { uid: 'outsider', role: 'client' },
      'wS5pgwa6c9WbPocf4w0w',
    )).resolves.toBe(false)
  })
})
