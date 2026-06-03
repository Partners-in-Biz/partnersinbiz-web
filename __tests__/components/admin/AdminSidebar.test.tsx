import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { AdminSidebar } from '@/components/admin/AdminSidebar'

jest.mock('next/navigation', () => ({
  usePathname: () => '/admin/org/acme/dashboard',
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
    selectedOrgId: 'org-acme',
    orgs: [
      {
        id: 'org-acme',
        slug: 'acme',
        name: 'Acme Growth',
        type: 'client',
      },
    ],
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
  beforeAll(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: jest.fn().mockReturnValue({
        matches: true,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      }),
    })
  })

  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        orgs: [{ id: 'org-acme', name: 'Acme Growth' }],
      }),
    } as Response) as jest.Mock
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  it('keeps the client portal switch reachable in the mobile drawer', async () => {
    render(<AdminSidebar open collapsed={false} onClose={jest.fn()} onToggleCollapsed={jest.fn()} />)

    await waitFor(() => {
      const switches = screen.getAllByRole('button', { name: 'Switch to portal view' })
      expect(switches.some((control) => !hasHiddenAncestor(control))).toBe(true)
    })
  })
})
