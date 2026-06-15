import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { AdminSidebar } from '@/components/admin/AdminSidebar'

let mockPathname = '/admin/org/acme/dashboard'
let mockOrgs = [
  {
    id: 'org-acme',
    slug: 'acme',
    name: 'Acme Growth',
    type: 'client',
  },
]

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({
    push: jest.fn(),
    refresh: jest.fn(),
  }),
}))

jest.mock('next/image', () => ({
  __esModule: true,
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) => <img alt={alt} {...props} />,
}))

jest.mock('@/lib/contexts/OrgContext', () => ({
  useOrg: () => ({
    selectedOrgId: mockOrgs[0].id,
    orgs: mockOrgs,
  }),
}))

function hasHiddenAncestor(element: HTMLElement) {
  let current: HTMLElement | null = element
  while (current) {
    if (current.className.toString().split(/\s+/).includes('hidden')) return true
    current = current.parentElement
  }
  return false
}

describe('AdminSidebar', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: jest.fn().mockReturnValue({
        matches: true,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      }),
    })

    mockPathname = '/admin/org/acme/dashboard'
    mockOrgs = [
      {
        id: 'org-acme',
        slug: 'acme',
        name: 'Acme Growth',
        type: 'client',
      },
    ]
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        orgs: [{ id: mockOrgs[0].id, name: mockOrgs[0].name }],
      }),
    } as Response) as jest.Mock
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  it('keeps the client portal switch reachable in the mobile drawer', async () => {
    render(<AdminSidebar open collapsed={false} onClose={jest.fn()} onToggleCollapsed={jest.fn()} />)

    await waitFor(() => {
      const switches = screen.getAllByRole('button', { name: 'Open client portal as admin' })
      expect(switches.some((control) => !hasHiddenAncestor(control))).toBe(true)
    })
  })

  it('does not render the platform admin brand pill in workspace mode', async () => {
    mockPathname = '/admin/org/partners-in-biz/projects'
    mockOrgs = [
      {
        id: 'pib-platform-owner',
        slug: 'partners-in-biz',
        name: 'Partners in Biz',
        type: 'platform_owner',
      },
    ]

    render(<AdminSidebar open collapsed={false} onClose={jest.fn()} onToggleCollapsed={jest.fn()} />)

    expect(screen.queryByText('Platform admin')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/portal/orgs')
    })
  })
})
