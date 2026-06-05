import React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import ClientReviewQueuePage from '@/app/(portal)/portal/social/review/page'

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

describe('ClientReviewQueuePage', () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams({ orgId: 'lumen-org', orgSlug: 'lumen-speeds' })
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/v1/social/posts?status=client_review')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: [
              {
                id: 'post-1',
                status: 'client_review',
                platforms: ['linkedin'],
                content: { text: 'Lumen June launch post' },
                createdAt: { seconds: 1_720_000_000 },
              },
            ],
          }),
        } as Response)
      }
      if (url.includes('/api/v1/social/posts?status=pending_approval')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: [] }),
        } as Response)
      }
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response)
    }) as jest.Mock
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  it('keeps review queue data and links scoped to the company workspace org', async () => {
    await act(async () => {
      render(<ClientReviewQueuePage />)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(await screen.findByText('Lumen June launch post')).toBeInTheDocument()

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/social/posts?status=client_review&limit=100&orgId=lumen-org')
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/social/posts?status=pending_approval&limit=100&orgId=lumen-org')
    })

    expect(screen.getByText('← Social').closest('a')).toHaveAttribute(
      'href',
      '/portal/social?orgId=lumen-org&orgSlug=lumen-speeds',
    )
    expect(screen.getByText('Open review').closest('a')).toHaveAttribute(
      'href',
      '/portal/social/review/post-1?orgId=lumen-org&orgSlug=lumen-speeds',
    )
  })
})
