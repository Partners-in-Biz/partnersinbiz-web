import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import PortalLayout from '@/app/(portal)/layout'

const mockPush = jest.fn()
const mockRefresh = jest.fn()
let mockPathname = '/portal/dashboard'
let mockSearchParams = new URLSearchParams()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
  usePathname: () => mockPathname,
  useSearchParams: () => mockSearchParams,
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
    mockPathname = '/portal/dashboard'
    mockSearchParams = new URLSearchParams()
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
      if (url === '/api/v1/portal/active-org') {
        return jsonResponse({ orgId: 'lumen-org' })
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

  it('gives the portal messages route a non-scrolling workspace shell', async () => {
    mockPathname = '/portal/messages'

    render(
      <PortalLayout>
        <div>Portal messages content</div>
      </PortalLayout>,
    )

    await screen.findByText('Portal messages content')

    const main = screen.getByText('Portal messages content').closest('main')
    expect(main).toHaveClass('overflow-hidden')
    expect(main).not.toHaveClass('overflow-y-auto')
    expect(screen.queryByText(/Partners in Biz · Pretoria/)).not.toBeInTheDocument()
  })

  it('loads the requested workspace when portal routes are opened from a CRM company', async () => {
    mockSearchParams = new URLSearchParams({ orgId: 'lumen-org', orgSlug: 'lumen-speeds' })

    render(
      <PortalLayout>
        <main>Portal content</main>
      </PortalLayout>,
    )

    await screen.findByText('Portal content')

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/portal/org?orgId=lumen-org')
    })
  })

  it('keeps the requested CRM company workspace active when it is not in the normal switcher list', async () => {
    mockSearchParams = new URLSearchParams({ orgId: 'lumen-org', orgSlug: 'lumen-speeds' })
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/portal/org?orgId=lumen-org') {
        return jsonResponse({
          org: { id: 'lumen-org', name: 'Lumen', slug: 'lumen-speeds', type: 'client' },
          user: { uid: 'admin-1', role: 'admin', name: 'Peet', email: 'peet@example.com' },
        })
      }
      if (url === '/api/v1/portal/orgs') {
        return jsonResponse({
          activeOrgId: 'pib-org',
          orgs: [
            { id: 'pib-org', name: 'Partners in Biz', slug: 'partners-in-biz', type: 'platform_owner', logoUrl: '' },
            { id: 'other-client', name: 'Other Client', slug: 'other-client', type: 'client', logoUrl: '' },
          ],
        })
      }
      if (url === '/api/v1/portal/settings/profile') {
        return jsonResponse({ profile: { firstName: 'Peet', lastName: 'Stander', role: 'owner' } })
      }
      if (url === '/api/v1/portal/documents/count?orgId=lumen-org') {
        return jsonResponse({ data: { count: 0 } })
      }
      if (url === '/api/v1/portal/active-org') {
        return jsonResponse({ orgId: 'lumen-org' })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })

    render(
      <PortalLayout>
        <main>Portal content</main>
      </PortalLayout>,
    )

    const switcher = await screen.findByLabelText('Workspace')

    await waitFor(() => {
      expect(switcher).toHaveValue('lumen-org')
    })

    expect(screen.getByRole('option', { name: 'Lumen' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Marketing/ })).toHaveAttribute(
      'href',
      '/portal/marketing?orgId=lumen-org&orgSlug=lumen-speeds',
    )
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/portal/active-org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId: 'lumen-org' }),
      })
    })
  })
})
