import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ClientReviewDetailPage from '@/app/(portal)/portal/social/review/[id]/page'

const mockPush = jest.fn()
let mockSearchParams = new URLSearchParams()

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'post-1' }),
  useRouter: () => ({ push: mockPush }),
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

describe('ClientReviewDetailPage', () => {
  beforeEach(() => {
    mockPush.mockClear()
    mockSearchParams = new URLSearchParams({ orgId: 'lumen-org', orgSlug: 'lumen-speeds' })
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/v1/social/posts/post-1/comments') && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              id: 'comment-2',
              text: 'Please use the new product line wording.',
              userName: 'Peet',
              userRole: 'client',
              createdAt: null,
            },
          }),
        } as Response)
      }
      if (url.includes('/api/v1/social/posts/post-1/comments')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: [
              {
                id: 'comment-1',
                text: 'Ready for client review.',
                userName: 'Team',
                userRole: 'admin',
                createdAt: null,
              },
            ],
          }),
        } as Response)
      }
      if (url.includes('/api/v1/social/posts/post-1/client-approve') && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { status: 'scheduled' } }),
        } as Response)
      }
      if (url.includes('/api/v1/social/posts/post-1/client-reject') && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { status: 'regenerating' } }),
        } as Response)
      }
      if (url.includes('/api/v1/social/posts/post-1')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              id: 'post-1',
              status: 'client_review',
              platforms: ['linkedin'],
              content: { text: 'Lumen social approval copy' },
              createdAt: null,
            },
          }),
        } as Response)
      }
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response)
    }) as jest.Mock
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  it('keeps review detail data, actions, and navigation scoped to the company workspace org', async () => {
    await act(async () => {
      render(<ClientReviewDetailPage />)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(await screen.findByText('Lumen social approval copy')).toBeInTheDocument()

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/social/posts/post-1?orgId=lumen-org')
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/social/posts/post-1/comments?orgId=lumen-org')
    })

    expect(screen.getByText('← Back to review queue').closest('a')).toHaveAttribute(
      'href',
      '/portal/social/review?orgId=lumen-org&orgSlug=lumen-speeds',
    )

    fireEvent.click(screen.getByRole('button', { name: /approve & schedule/i }))
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/social/posts/post-1/client-approve?orgId=lumen-org',
        expect.objectContaining({ method: 'POST' }),
      )
    })

    fireEvent.change(screen.getByPlaceholderText(/leave a note/i), {
      target: { value: 'Please use the new product line wording.' },
    })
    fireEvent.click(screen.getByRole('button', { name: /post note/i }))
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/social/posts/post-1/comments?orgId=lumen-org',
        expect.objectContaining({ method: 'POST' }),
      )
    })
  })
})
