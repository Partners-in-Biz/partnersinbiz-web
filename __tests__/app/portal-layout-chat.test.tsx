import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import PortalLayout from '@/app/(portal)/layout'

const mockPush = jest.fn()
const mockRefresh = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
  usePathname: () => '/portal/dashboard',
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('next/image', () => ({
  __esModule: true,
  default: (props: { alt?: string }) => <span role="img" aria-label={props.alt} />,
}))

jest.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, cb: (user: { uid: string; email: string; displayName: string }) => void) => {
    cb({ uid: 'admin-1', email: 'peet@example.com', displayName: 'Peet' })
    return jest.fn()
  },
}))

jest.mock('@/lib/firebase/config', () => ({
  auth: {},
  getClientAuth: () => ({ authStateReady: () => Promise.resolve() }),
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

jest.mock('@/components/crm/NotificationBell', () => ({
  NotificationBell: () => <button type="button">Notifications</button>,
}))

jest.mock('@/components/support/SupportDrawer', () => ({
  SupportDrawer: () => <button type="button">Support</button>,
}))

jest.mock('@/components/settings/SettingsNav', () => ({
  SettingsNav: () => null,
}))

jest.mock('@/components/chat/UnifiedChat', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => (
    <div
      data-testid="unified-chat"
      data-allow-agent-participants={String(props.allowAgentParticipants)}
    />
  ),
}))

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as Response
}

describe('PortalLayout chat drawer', () => {
  beforeEach(() => {
    localStorage.clear()
    window.matchMedia = jest.fn().mockImplementation((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }))
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/portal/org') {
        return jsonResponse({
          org: { id: 'org-1', name: 'Acme', slug: 'acme', type: 'client' },
          user: { uid: 'admin-1', role: 'admin', name: 'Peet', email: 'peet@example.com' },
        })
      }
      if (url === '/api/v1/portal/orgs') {
        return jsonResponse({
          activeOrgId: 'org-1',
          orgs: [{ id: 'org-1', name: 'Acme', slug: 'acme', type: 'client', logoUrl: '' }],
        })
      }
      if (url === '/api/v1/portal/settings/profile') {
        return jsonResponse({ profile: { firstName: 'Peet', lastName: 'Stander', role: 'owner' } })
      }
      if (url === '/api/v1/portal/documents/count') {
        return jsonResponse({ data: { count: 0 } })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
  })

  it('keeps agent participants enabled for system admins using the portal sidebar chat', async () => {
    render(
      <PortalLayout>
        <main>Portal content</main>
      </PortalLayout>,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Open messages' }))

    await waitFor(() => {
      expect(screen.getByTestId('unified-chat')).toHaveAttribute('data-allow-agent-participants', 'true')
    })
  })
})
