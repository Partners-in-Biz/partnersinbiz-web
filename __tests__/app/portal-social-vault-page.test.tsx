import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import VaultPage from '@/app/(portal)/portal/social/vault/page'

let mockSearchParams = new URLSearchParams()
const mockPush = jest.fn()
let mockVaultPosts: unknown[] = []

jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
  useRouter: () => ({ push: mockPush }),
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

describe('Portal social vault page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSearchParams = new URLSearchParams()
    mockVaultPosts = [
      {
        id: 'post-1',
        status: 'published',
        platforms: ['instagram'],
        content: { text: 'Agent handoff, not agent chaos.' },
        media: [{
          url: 'https://example.com/reel.mp4?token=abc',
          thumbnailUrl: 'https://example.com/reel.mp4?token=abc',
          type: 'video',
          alt: 'Agent handoff reel',
        }],
        publishedAt: { seconds: 1782223200 },
      },
    ]
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/portal/org') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ org: { id: 'client-org-1', name: 'Client Org' } }),
        } as Response)
      }
      if (url === '/api/v1/social/vault?orgId=client-org-1') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: mockVaultPosts,
          }),
        } as Response)
      }
      if (url === '/api/v1/portal/social/posts/post-1/publish-now?orgId=client-org-1') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { id: 'post-1', status: 'published', externalId: 'ig-1', error: null } }),
        } as Response)
      }
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response)
    }) as jest.Mock
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  it('loads vault items for the resolved active portal org when the URL has no orgId', async () => {
    await act(async () => {
      render(<VaultPage />)
      await Promise.resolve()
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/portal/org')
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/social/vault?orgId=client-org-1')
    })

    expect(await screen.findByText('Agent handoff, not agent chaos.')).toBeInTheDocument()
    expect(screen.getByLabelText('Agent handoff reel')).toHaveAttribute('src', 'https://example.com/reel.mp4?token=abc')
    expect(screen.queryByText('Your vault is empty.')).not.toBeInTheDocument()
  })

  it('opens a platform preview and pre-fills compose when reposting a published post', async () => {
    await act(async () => {
      render(<VaultPage />)
      await Promise.resolve()
      await Promise.resolve()
    })

    fireEvent.click(await screen.findByRole('button', { name: 'Preview post' }))
    expect(await screen.findByRole('dialog', { name: 'Post preview' })).toBeInTheDocument()
    expect(screen.getAllByText(/Agent handoff, not agent chaos/i).length).toBeGreaterThan(1)

    fireEvent.click(screen.getByRole('button', { name: 'Repost published post' }))
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('/portal/social/compose?orgId=client-org-1'))
    const pushedUrl = new URL(mockPush.mock.calls[0][0], 'http://localhost')
    expect(pushedUrl.searchParams.get('draft')).toBe('Agent handoff, not agent chaos.')
  })

  it('posts scheduled content immediately from the Vault card action', async () => {
    mockVaultPosts = [
      {
        id: 'post-1',
        status: 'scheduled',
        platforms: ['instagram'],
        content: { text: 'Scheduled post ready to publish.' },
        media: [{ url: 'https://example.com/reel.mp4?token=abc', type: 'video' }],
        scheduledAt: { seconds: 1782223200 },
      },
    ]

    await act(async () => {
      render(<VaultPage />)
      await Promise.resolve()
      await Promise.resolve()
    })

    fireEvent.click(await screen.findByRole('button', { name: 'Post scheduled post' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/portal/social/posts/post-1/publish-now?orgId=client-org-1',
        expect.objectContaining({ method: 'POST' }),
      )
    })
  })
})
