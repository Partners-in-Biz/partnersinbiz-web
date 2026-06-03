import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import PortalLayout from '@/app/(portal)/layout'

const pushMock = jest.fn()
const refreshMock = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    refresh: refreshMock,
  }),
  usePathname: () => '/portal/dashboard',
  useSearchParams: () => new URLSearchParams(),
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
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/portal/org') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            org: { id: 'org-acme', slug: 'acme', name: 'Acme Growth', type: 'client' },
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
      if (url === '/api/v1/portal/documents/count') {
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
})
