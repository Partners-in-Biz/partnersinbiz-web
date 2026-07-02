import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'fs'
import * as path from 'path'
import PortalLayout from '@/app/(portal)/PortalLayoutClient'

const pushMock = jest.fn()
const refreshMock = jest.fn()
const backMock = jest.fn()
let mockPathname = '/portal/dashboard'
let mockSearchParams = new URLSearchParams()
let mockPortalModules: { mobileApps?: boolean; youtubeStudio?: boolean; bookStudio?: boolean } | undefined
let mockModulePolicies: Record<string, unknown> | undefined
let mockMemberRole: string | null
let mockAccessPolicy: unknown
const fullAccessPolicy = {
  preset: 'full',
  modules: {
    crm: true,
    projects: true,
    documents: true,
    marketing: true,
    messages: true,
    email: true,
    reports: true,
    research: true,
    properties: true,
    billing: true,
    mobileApps: true,
    youtubeStudio: true,
    bookStudio: true,
  },
  recordScopes: { crm: 'all', projects: 'all' },
}

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    refresh: refreshMock,
    back: backMock,
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

function routeSource(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('PortalLayout mobile role switch', () => {
  beforeEach(() => {
    localStorage.clear()
    jest.clearAllMocks()
    mockPathname = '/portal/dashboard'
    mockSearchParams = new URLSearchParams()
    mockPortalModules = undefined
    mockModulePolicies = undefined
    mockMemberRole = 'admin'
    mockAccessPolicy = fullAccessPolicy
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/portal/org') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            org: { id: 'org-acme', slug: 'acme', name: 'Acme Growth', type: 'client', portalModules: mockPortalModules, modulePolicies: mockModulePolicies },
            user: { role: 'admin', memberRole: mockMemberRole, accessPolicy: mockAccessPolicy },
          }),
        } as Response)
      }
      if (url === '/api/v1/portal/org?orgId=lumen-org') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            org: { id: 'lumen-org', slug: 'lumen-speeds', name: 'Lumen', type: 'client', portalModules: mockPortalModules, modulePolicies: mockModulePolicies },
            user: { role: 'admin', memberRole: mockMemberRole, accessPolicy: mockAccessPolicy },
          }),
        } as Response)
      }
      if (url === '/api/v1/portal/orgs') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            activeOrgId: 'org-acme',
            orgs: [
              { id: 'org-acme', slug: 'acme', name: 'Acme Growth', type: 'client', modulePolicies: mockModulePolicies },
              { id: 'course-digs-org', slug: 'course-digs', name: 'Course Digs', type: 'client', modulePolicies: mockModulePolicies },
            ],
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

  it('uses the person icon for every client-side admin-view switch control', () => {
    const source = routeSource('app/(portal)/PortalLayoutClient.tsx')

    expect(source).toContain('Switch to admin view')
    expect(source.match(/>\s*person\s*<\/span>/g)?.length).toBeGreaterThanOrEqual(5)
  })

  it('keeps the portal workspace switcher dark instead of browser-white', () => {
    const source = routeSource('app/(portal)/PortalLayoutClient.tsx')

    expect(source).toContain('id="portal-workspace-switcher"')
    expect(source).toContain('<ThemedSelect')
    expect(source).toContain('ariaLabel="Switch portal workspace"')
    expect(source).toContain('menuClassName="bg-[var(--color-pib-surface)] text-[var(--color-pib-text)]"')
    expect(source).not.toContain('<select\n                    id="portal-workspace-switcher"')
  })

  it('shows a navbar back button that returns to the previous portal page', async () => {
    render(
      <PortalLayout>
        <div>Portal content</div>
      </PortalLayout>,
    )

    const backButton = await screen.findByRole('button', { name: 'Go back' })
    fireEvent.click(backButton)

    expect(backMock).toHaveBeenCalledTimes(1)
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

  it('navigates plain portal workspace switches to an explicit scoped URL', async () => {
    mockPathname = '/portal/projects'

    render(
      <PortalLayout>
        <div>Portal content</div>
      </PortalLayout>,
    )

    const switcher = await screen.findByRole('button', { name: 'Switch portal workspace' })
    fireEvent.click(switcher)
    fireEvent.click(await screen.findByText('Course Digs'))

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/portal/projects?orgId=course-digs-org&orgSlug=course-digs')
    })
    expect(refreshMock).not.toHaveBeenCalled()
  })

  // The Studio entries (Mobile Apps / YouTube Studio / Book Studio) moved out of
  // the top-level sidebar into the Marketing workspace subnav, under a "Studio"
  // dropdown. They only render on marketing routes and after the dropdown is
  // opened. Helper: render on a marketing route, open the Studio dropdown.
  async function renderMarketingAndOpenStudio() {
    mockPathname = '/portal/marketing'
    render(
      <PortalLayout>
        <div>Portal content</div>
      </PortalLayout>,
    )
    const studioButton = await screen.findByRole('button', { name: /Studio/ })
    fireEvent.click(studioButton)
    return studioButton
  }

  it('shows Mobile Apps in the marketing Studio subnav', async () => {
    await renderMarketingAndOpenStudio()

    await waitFor(() => {
      expect(screen.getAllByRole('menuitem', { name: /Mobile Apps/ }).length).toBeGreaterThan(0)
    })
  })

  it('shows Mobile Apps in the Studio subnav when the active organisation enables the module', async () => {
    mockPortalModules = { mobileApps: true }
    await renderMarketingAndOpenStudio()

    await waitFor(() => {
      expect(screen.getAllByRole('menuitem', { name: /Mobile Apps/ }).length).toBeGreaterThan(0)
    })
  })

  it('shows YouTube Studio in the marketing Studio subnav', async () => {
    await renderMarketingAndOpenStudio()

    await waitFor(() => {
      expect(screen.getAllByRole('menuitem', { name: /YouTube Studio/ }).length).toBeGreaterThan(0)
    })
  })

  it('keeps Studio subnav entries off non-marketing routes like the dashboard', async () => {
    render(
      <PortalLayout>
        <div>Portal content</div>
      </PortalLayout>,
    )

    expect(await screen.findByText('Client portal')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Studio/ })).not.toBeInTheDocument()
    })
    expect(screen.queryByRole('menuitem', { name: /Book Studio/ })).not.toBeInTheDocument()
  })

  it('gives the Creative Canvas route a full-width no-scroll workspace shell', async () => {
    mockPathname = '/portal/creative-canvas'

    render(
      <PortalLayout>
        <div>Canvas content</div>
      </PortalLayout>,
    )

    const content = await screen.findByText('Canvas content')
    const shell = content.closest('main')

    expect(shell).toHaveClass('flex-1')
    expect(shell).toHaveClass('min-h-0')
    expect(shell).toHaveClass('overflow-hidden')
    expect(shell).toHaveClass('max-w-none')
    expect(shell).not.toHaveClass('max-w-[1400px]')
  })

  it('shows Book Studio in the marketing Studio subnav', async () => {
    mockPortalModules = { bookStudio: true }
    await renderMarketingAndOpenStudio()

    await waitFor(() => {
      expect(screen.getAllByRole('menuitem', { name: /Book Studio/ }).length).toBeGreaterThan(0)
    })
  })

  it('hides module navigation when organisation governance denies the current member role', async () => {
    mockMemberRole = 'member'
    mockModulePolicies = {
      projects: {
        actions: {
          visibility: { owner: true, admin: true, member: false },
        },
      },
    }

    render(
      <PortalLayout>
        <div>Portal content</div>
      </PortalLayout>,
    )

    await waitFor(() => {
      expect(screen.queryByText('Projects')).not.toBeInTheDocument()
      expect(screen.getByText('Documents')).toBeInTheDocument()
    })
  })

  it('keeps normal portal modules visible for admins when no explicit access policy is stored', async () => {
    mockAccessPolicy = undefined

    render(
      <PortalLayout>
        <div>Portal content</div>
      </PortalLayout>,
    )

    await waitFor(() => {
      expect(screen.getByText('Projects')).toBeInTheDocument()
      expect(screen.getByText('Documents')).toBeInTheDocument()
      expect(screen.getByText('CRM')).toBeInTheDocument()
      expect(screen.getByText('Marketing')).toBeInTheDocument()
      expect(screen.getByText('Messages')).toBeInTheDocument()
    })
  })

  it('lists YouTube Studio in the Studio subnav regardless of the portal module flag', async () => {
    // The Studio subnav entries are no longer gated by portalModules; they live
    // under the Marketing workspace Studio dropdown and render on marketing
    // routes even when the org has youtubeStudio set false.
    mockPortalModules = { youtubeStudio: false }
    await renderMarketingAndOpenStudio()

    await waitFor(() => {
      expect(screen.getAllByRole('menuitem', { name: /YouTube Studio/ }).length).toBeGreaterThan(0)
    })
  })
})
