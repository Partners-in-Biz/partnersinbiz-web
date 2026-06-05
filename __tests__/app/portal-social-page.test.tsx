import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import PortalSocialDashboard from '@/app/(portal)/portal/social/page'

let mockSearchParams = new URLSearchParams()

jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

describe('PortalSocialDashboard', () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams({ orgId: 'lumen-org', orgSlug: 'lumen-speeds' })
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/social/accounts?orgId=lumen-org') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: [
              {
                id: 'acct-1',
                platform: 'linkedin',
                displayName: 'Lumen Speeds',
                username: 'lumenspeeds',
                status: 'active',
              },
            ],
          }),
        } as Response)
      }
      if (url === '/api/v1/social/posts?limit=200&orgId=lumen-org') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: [
              {
                id: 'post-1',
                status: 'pending_approval',
                platforms: ['linkedin'],
                content: { text: 'Lumen launch social post' },
              },
            ],
          }),
        } as Response)
      }
      if (url === '/api/v1/portal/org?orgId=lumen-org') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ org: { id: 'lumen-org', name: 'Lumen', slug: 'lumen-speeds' } }),
        } as Response)
      }
      if (url === '/api/v1/social/posts/post-1/approve?orgId=lumen-org' && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { status: 'approved' } }),
        } as Response)
      }
      if (url === '/api/v1/social/posts/post-1/comments?orgId=lumen-org') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: [{ id: 'comment-1', text: 'Ready', userName: 'Peet', userRole: 'admin', createdAt: null }] }),
        } as Response)
      }
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response)
    }) as jest.Mock
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  it('keeps the Social overview scoped to the company workspace org', async () => {
    await act(async () => {
      render(<PortalSocialDashboard />)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(await screen.findByText('Lumen')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getAllByText('Lumen launch social post')).toHaveLength(2)
    })
    expect(screen.getByText('Recent posts')).toBeInTheDocument()

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/social/accounts?orgId=lumen-org')
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/social/posts?limit=200&orgId=lumen-org')
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/portal/org?orgId=lumen-org')
    })

    expect(screen.getByText('Compose post').closest('a')).toHaveAttribute(
      'href',
      '/portal/social/compose?orgId=lumen-org&orgSlug=lumen-speeds',
    )
    expect(screen.getByText('Vault').closest('a')).toHaveAttribute(
      'href',
      '/portal/social/vault?orgId=lumen-org&orgSlug=lumen-speeds',
    )
    expect(screen.getByText('Calendar').closest('a')).toHaveAttribute(
      'href',
      '/portal/social/calendar?orgId=lumen-org&orgSlug=lumen-speeds',
    )
    expect(screen.getByText('Accounts').closest('a')).toHaveAttribute(
      'href',
      '/portal/social/accounts?orgId=lumen-org&orgSlug=lumen-speeds',
    )

    fireEvent.click(screen.getByRole('button', { name: /comments/i }))
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/social/posts/post-1/comments?orgId=lumen-org')
    })

    fireEvent.click(screen.getByRole('button', { name: /approve/i }))
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/social/posts/post-1/approve?orgId=lumen-org',
        expect.objectContaining({ method: 'POST' }),
      )
    })
  })
})
