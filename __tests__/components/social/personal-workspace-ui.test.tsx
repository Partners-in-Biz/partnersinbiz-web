import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import WorkspacesPage from '@/app/(portal)/portal/settings/workspaces/page'
import SocialAccountsManager from '@/components/social/SocialAccountsManager'
import SocialPostComposer from '@/components/social/SocialPostComposer'

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
})
