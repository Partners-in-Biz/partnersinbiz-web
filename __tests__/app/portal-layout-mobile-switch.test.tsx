import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import PortalLayout from '@/app/(portal)/layout'

const pushMock = jest.fn()
const refreshMock = jest.fn()
let mockPathname = '/portal/dashboard'
let mockSearchParams = new URLSearchParams()
let mockPortalModules: { mobileApps?: boolean; youtubeStudio?: boolean } | undefined

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    refresh: refreshMock,
  }),
  usePathname: () => mockPathname,
  useSearchParams: () => mockSearchParams,
}))

jest.mock('next/image', () => ({
  __esModule: true,
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) => <img alt={alt} {...props} />,
}))

jest.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, callback: (user: { email: string; uid: string; displayName: string }) => void) => {
    callback({ email: 'admin@example.com', uid: 'admin-1', displayName: 'Admin User' })
    return jest.fn()
  },
}))

jest.mock('@/lib/firebase/config', () => ({
  auth: {},
  getClientAuth: () => ({
    authStateReady: () => Promise.resolve(),
  }),
}))

jest.mock('@/lib/firebase/auth', () => ({
  logout: jest.fn(),
}))

jest.mock('@/components/pwa/LastPathTracker', () => ({
  LastPathTracker: () => null,
}))

jest.mock('@/components/ui/WelcomeFlashHandler', () => ({
  WelcomeFlashHandler: () => null,
}))

jest.mock('@/components/settings/SettingsNav', () => ({
  SettingsNav: () => null,
}))

jest.mock('@/components/support/SupportDrawer', () => ({
  SupportDrawer: () => null,
}))

jest.mock('@/components/crm/NotificationBell', () => ({
  NotificationBell: () => null,
}))

jest.mock('@/components/chat/MessageDrawer', () => ({
  MessageDrawer: () => null,
}))

jest.mock('@/lib/pwa/lastPath', () => ({
  clearLastPath: jest.fn(),
}))

function hasHiddenAncestor(element: HTMLElement) {
  let current: HTMLElement | null = element
  while (current) {
    if (current.className.toString().split(/\s+/).includes('hidden')) return true
    current = current.parentElement
  }
  return false
}

describe('PortalLayout mobile role switch', () => {
  beforeEach(() => {
    localStorage.clear()
    jest.clearAllMocks()
    mockPathname = '/portal/dashboard'
    mockSearchParams = new URLSearchParams()
    mockPortalModules = undefined
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/portal/org') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            org: { id: 'org-acme', slug: 'acme', name: 'Acme Growth', type: 'client', portalModules: mockPortalModules },
            user: { role: 'admin' },
          }),
        } as Response)
      }
      if (url === '/api/v1/portal/org?orgId=lumen-org') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            org: { id: 'lumen-org', slug: 'lumen-speeds', name: 'Lumen', type: 'client', portalModules: mockPortalModules },
            user: { role: 'admin' },
          }),
        } as Response)
      }
      if (url === '/api/v1/portal/orgs') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            activeOrgId: 'org-acme',
            orgs: [{ id: 'org-acme', slug: 'acme', name: 'Acme Growth', type: 'client' }],
          }),
        } as Response)
      }
      if (url === '/api/v1/portal/settings/profile') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ profile: { firstName: 'Admin', lastName: 'User', role: 'admin' } }),
        } as Response)
      }
      if (url === '/api/v1/portal/documents/count' || url === '/api/v1/portal/documents/count?orgId=lumen-org') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { count: 0 } }),
        } as Response)
      }
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response)
    }) as jest.Mock
  })

  it('keeps the admin switch reachable in the mobile sidebar drawer', async () => {
    render(
      <PortalLayout>
        <div>Portal content</div>
      </PortalLayout>,
    )

    expect(await screen.findByText('Client portal')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))

    await waitFor(() => {
      const switches = screen.getAllByRole('link', { name: 'Switch to admin view' })
      expect(switches.some((control) => !hasHiddenAncestor(control))).toBe(true)
    })
  })

  it('keeps the desktop topbar admin switch icon-only', async () => {
    localStorage.setItem('portal_layout_mode', 'topbar')

    render(
      <PortalLayout>
        <div>Portal content</div>
      </PortalLayout>,
    )

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Switch to admin view' })).toHaveAttribute(
        'href',
        '/admin/org/acme/dashboard',
      )
    })
    expect(screen.queryByText('Admin')).not.toBeInTheDocument()
  })

  it('keeps CRM company workspace scope on portal shell navigation', async () => {
    mockPathname = '/portal/marketing'
    mockSearchParams = new URLSearchParams({
      orgId: 'lumen-org',
      orgSlug: 'lumen-speeds',
      sourceCompanyId: 'company-1',
      sourceCompanyName: 'Lumen',
    })

    render(
      <PortalLayout>
        <div>Portal content</div>
      </PortalLayout>,
    )

    await waitFor(() => expect(screen.getAllByText('Lumen').length).toBeGreaterThan(0))

    await waitFor(() => {
      const marketingHref = screen
        .getAllByRole('link')
        .map((link) => link.getAttribute('href'))
        .find((href) => href?.startsWith('/portal/marketing?'))

      expect(marketingHref).toBe(
        '/portal/marketing?orgId=lumen-org&orgSlug=lumen-speeds&sourceCompanyId=company-1&sourceCompanyName=Lumen',
      )
    })
  })

  it('keeps Mobile Apps visible when no portal module setting is stored', async () => {
    render(
      <PortalLayout>
        <div>Portal content</div>
      </PortalLayout>,
    )

    await waitFor(() => {
      expect(screen.getAllByRole('link', { name: /Mobile Apps/ }).length).toBeGreaterThan(0)
    })
  })

  it('keeps Mobile Apps visible when the active organisation enables the module', async () => {
    mockPortalModules = { mobileApps: true }

    render(
      <PortalLayout>
        <div>Portal content</div>
      </PortalLayout>,
    )

    await waitFor(() => {
      expect(screen.getAllByRole('link', { name: /Mobile Apps/ }).length).toBeGreaterThan(0)
    })
  })

  it('keeps YouTube Studio visible when no portal module setting is stored', async () => {
    render(
      <PortalLayout>
        <div>Portal content</div>
      </PortalLayout>,
    )

    await waitFor(() => {
      expect(screen.getAllByRole('link', { name: /YouTube Studio/ }).length).toBeGreaterThan(0)
    })
  })

  it('hides Mobile Apps navigation when the active organisation disables the module', async () => {
    mockPortalModules = { mobileApps: false }

    render(
      <PortalLayout>
        <div>Portal content</div>
      </PortalLayout>,
    )

    expect(await screen.findByText('Client portal')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.queryByRole('link', { name: /Mobile Apps/ })).not.toBeInTheDocument()
    })
  })

  it('hides YouTube Studio navigation when the active organisation disables the module', async () => {
    mockPortalModules = { youtubeStudio: false }

    render(
      <PortalLayout>
        <div>Portal content</div>
      </PortalLayout>,
    )

    expect(await screen.findByText('Client portal')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.queryByRole('link', { name: /YouTube Studio/ })).not.toBeInTheDocument()
    })
  })
})
