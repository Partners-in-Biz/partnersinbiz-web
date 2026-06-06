import React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import SocialOverviewPage from '@/app/(admin)/admin/social/page'

const mockUseOrg = jest.fn()

jest.mock('@/lib/contexts/OrgContext', () => ({
  useOrg: () => mockUseOrg(),
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

describe('admin social overview page', () => {
  beforeEach(() => {
    mockUseOrg.mockReturnValue({ orgId: '', orgName: '' })
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/social/accounts?orgId=pib-platform-owner') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: [{ id: 'account-1', platform: 'linkedin', displayName: 'Partners in Biz', status: 'active' }] }),
        } as Response)
      }
      if (url === '/api/v1/social/posts?limit=200&orgId=pib-platform-owner') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: [
              {
                id: 'post-1',
                status: 'scheduled',
                platforms: ['linkedin'],
                content: { text: 'Partners in Biz social post' },
                scheduledFor: '2026-06-10T09:00:00.000Z',
              },
            ],
          }),
        } as Response)
      }
      if (url === '/api/v1/social/inbox?status=unread&limit=1&orgId=pib-platform-owner') {
        return Promise.resolve({ ok: true, json: async () => ({ items: [] }) } as Response)
      }
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response)
    }) as jest.Mock
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  it('defaults the top-level overview to the Partners in Biz workspace instead of the empty default tenant', async () => {
    await act(async () => {
      render(<SocialOverviewPage />)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.getByText('Monitor and manage social media for Partners in Biz.')).toBeInTheDocument()
    expect(await screen.findByText('Partners in Biz social post')).toBeInTheDocument()

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/social/accounts?orgId=pib-platform-owner')
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/social/posts?limit=200&orgId=pib-platform-owner')
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/social/inbox?status=unread&limit=1&orgId=pib-platform-owner')
    })

    expect(screen.getByText('Compose Post').closest('a')).toHaveAttribute(
      'href',
      '/admin/social/compose?orgId=pib-platform-owner',
    )
  })

  it('uses the selected org when an admin has picked a client workspace', async () => {
    mockUseOrg.mockReturnValue({ orgId: 'lumen-org', orgName: 'Lumen' })

    await act(async () => {
      render(<SocialOverviewPage />)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.getByText('Monitor and manage social media for Lumen.')).toBeInTheDocument()

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/social/accounts?orgId=lumen-org')
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/social/posts?limit=200&orgId=lumen-org')
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/social/inbox?status=unread&limit=1&orgId=lumen-org')
    })
  })
})
