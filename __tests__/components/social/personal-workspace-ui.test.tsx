import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import WorkspacesPage from '@/app/(portal)/portal/settings/workspaces/page'
import SocialAccountsManager from '@/components/social/SocialAccountsManager'
import SocialPostComposer from '@/components/social/SocialPostComposer'
import { PersonalXMcpConnectionCard } from '@/components/workspace-os/PersonalXMcpConnectionCard'

const push = jest.fn()
const replace = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => new URLSearchParams(),
}))

describe('personal workspace social UI', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/portal/orgs') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ activeOrgId: 'org-1', orgs: [{ id: 'org-1', name: 'Acme', logoUrl: '' }] }),
        } as Response)
      }
      if (url === '/api/v1/social/accounts?scope=personal' && !init) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: [
              { id: 'acct-1', platform: 'linkedin', displayName: 'Peet Stander', username: 'peet', status: 'active' },
            ],
          }),
        } as Response)
      }
      if (url === '/api/v1/social/accounts/acct-1' && init?.method === 'DELETE') {
        return Promise.resolve({ ok: true, json: async () => ({ success: true }) } as Response)
      }
      if (url === '/api/v1/social/posts?scope=personal' && init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: async () => ({ data: { id: 'post-1' } }) } as Response)
      }
      if (url === '/api/v1/workspace-connections?orgId=org-1&provider=x_mcp&owner=me' && !init) {
        return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response)
      }
      if (url === '/api/v1/workspace-connections' && init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: async () => ({ data: { id: 'x-conn-1' } }) } as Response)
      }
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response)
    }) as jest.Mock
  })

  it('links to the personal workspace from My workspaces', async () => {
    render(<WorkspacesPage />)

    const link = await screen.findByRole('link', { name: /personal marketing/i })
    expect(link).toHaveAttribute('href', '/portal/personal/marketing')
    expect(await screen.findByText('Acme')).toBeInTheDocument()
  })

  it('loads personal accounts and keeps OAuth links scoped to personal', async () => {
    render(
      <SocialAccountsManager
        scope="personal"
        basePath="/portal/personal/social/accounts"
        title="Personal social accounts"
      />,
    )

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/social/accounts?scope=personal')
    })

    const connectTwitter = screen.getByRole('link', { name: /connect x/i })
    expect(connectTwitter).toHaveAttribute(
      'href',
      '/api/v1/social/oauth/twitter?redirectUrl=%2Fportal%2Fpersonal%2Fsocial%2Faccounts&scope=personal',
    )
  })

  it('confirms personal social account disconnects inside the page', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false)

    render(
      <SocialAccountsManager
        scope="personal"
        basePath="/portal/personal/social/accounts"
        title="Personal social accounts"
      />,
    )

    const disconnectButton = await screen.findByRole('button', {
      name: 'Disconnect social account Peet Stander from LinkedIn',
    })

    fireEvent.click(disconnectButton)

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalledWith('/api/v1/social/accounts/acct-1', { method: 'DELETE' })
    expect(
      screen.getByRole('alertdialog', { name: 'Disconnect LinkedIn account "Peet Stander"?' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'This removes the account from posting, scheduling, and inbox sync. You can reconnect it later from this workspace.',
      ),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm disconnect LinkedIn account Peet Stander' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/social/accounts/acct-1', { method: 'DELETE' })
    })
    expect(await screen.findByText('Account disconnected.')).toBeInTheDocument()

    confirmSpy.mockRestore()
  })

  it('posts personal drafts to the personal post API', async () => {
    render(
      <SocialPostComposer
        scope="personal"
        accountsHref="/portal/personal/social/accounts"
        afterSaveHref="/portal/personal/marketing"
      />,
    )

    await screen.findByRole('button', { name: /linkedin/i })
    fireEvent.click(screen.getByRole('button', { name: /linkedin/i }))
    fireEvent.change(screen.getByPlaceholderText('Write your post…'), {
      target: { value: 'Personal update' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save draft/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/social/posts?scope=personal',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"accountIds":["acct-1"]'),
        }),
      )
    })
  })

  it('shows saved X MCP metadata as authorization-required, not connected', async () => {
    ;(global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/portal/orgs') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ activeOrgId: 'org-1', orgs: [{ id: 'org-1', name: 'Acme', logoUrl: '' }] }),
        } as Response)
      }
      if (url === '/api/v1/workspace-connections?orgId=org-1&provider=x_mcp&owner=me') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: [{ id: 'x-conn-1', provider: 'x_mcp', connectionKey: 'x-mcp-user-account', status: 'proposed', tokenStatus: 'user_authorization_required' }],
          }),
        } as Response)
      }
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response)
    })

    render(<PersonalXMcpConnectionCard />)

    expect(await screen.findByText('Authorization required · not usable by agents yet')).toBeInTheDocument()
    expect(screen.getByText(/authorization is still required in xurl/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /x mcp setup saved/i })).toBeDisabled()
  })

  it('prepares a user-owned X MCP registry record from the personal account surface', async () => {
    render(<PersonalXMcpConnectionCard />)

    expect(await screen.findByText('Personal X MCP and bookmarks')).toBeInTheDocument()
    expect(await screen.findByText('Not prepared')).toBeInTheDocument()
    expect(screen.getAllByText(/https:\/\/api\.x\.com\/mcp/i).length).toBeGreaterThan(0)

    const prepareButton = screen.getByRole('button', { name: /prepare personal x mcp/i })
    await waitFor(() => expect(prepareButton).not.toBeDisabled())
    fireEvent.click(prepareButton)

    await waitFor(() => {
      const post = (global.fetch as jest.Mock).mock.calls.find(([url, init]) =>
        String(url) === '/api/v1/workspace-connections' && init?.method === 'POST',
      )
      expect(post).toBeTruthy()
      const payload = JSON.parse(post![1].body as string)
      expect(payload).toMatchObject({
        orgId: 'org-1',
        connectionKey: 'x-mcp-user-account',
        displayName: 'Personal X MCP account',
        provider: 'x_mcp',
        connectionType: 'user_oauth',
        tokenStatus: 'user_authorization_required',
        capabilityScopes: expect.arrayContaining(['x.bookmarks.read', 'x.bookmarks.write', 'x.search.read']),
        capabilities: expect.objectContaining({ xBookmarksRead: true, xBookmarksWrite: true, xSearchRead: true }),
        safeMetadata: expect.objectContaining({
          setupSurface: 'portal_personal_social_accounts',
          perUserAccount: true,
          sharedPlatformTokenStored: false,
        }),
      })
    })
  })
})
