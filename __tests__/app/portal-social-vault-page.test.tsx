import React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import VaultPage from '@/app/(portal)/portal/social/vault/page'

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

describe('Portal social vault page', () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams()
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
            data: [
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
            ],
          }),
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
})
