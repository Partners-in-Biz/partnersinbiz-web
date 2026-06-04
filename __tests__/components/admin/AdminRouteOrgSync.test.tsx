import { render } from '@testing-library/react'
import { AdminRouteOrgSync } from '@/components/admin/AdminRouteOrgSync'

const setOrg = jest.fn()
const clearOrg = jest.fn()

let mockPathname = '/admin/org/lumen-speeds/marketing'
let mockSearchParams = new URLSearchParams()
let mockSelectedOrgId = ''

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useSearchParams: () => mockSearchParams,
}))

jest.mock('@/lib/contexts/OrgContext', () => ({
  useOrg: () => ({
    selectedOrgId: mockSelectedOrgId,
    orgName: '',
    orgs: [
      { id: 'org-lumen', slug: 'lumen-speeds', name: 'Lumen' },
      { id: 'org-pib', slug: 'partners-in-biz', name: 'Partners in Biz' },
    ],
    setOrg,
    clearOrg,
    orgId: mockSelectedOrgId,
  }),
}))

describe('AdminRouteOrgSync', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockPathname = '/admin/org/lumen-speeds/marketing'
    mockSearchParams = new URLSearchParams()
    mockSelectedOrgId = ''
  })

  it('selects the organisation from an admin workspace route', () => {
    render(<AdminRouteOrgSync />)

    expect(setOrg).toHaveBeenCalledWith('org-lumen', 'Lumen')
  })

  it('selects the organisation from an admin org query for global tools', () => {
    mockPathname = '/admin/social/compose'
    mockSearchParams = new URLSearchParams('org=lumen-speeds')
    mockSelectedOrgId = 'org-pib'

    render(<AdminRouteOrgSync />)

    expect(setOrg).toHaveBeenCalledWith('org-lumen', 'Lumen')
  })

  it('does not reselect the organisation when it is already active', () => {
    mockSelectedOrgId = 'org-lumen'

    render(<AdminRouteOrgSync />)

    expect(setOrg).not.toHaveBeenCalled()
  })
})
