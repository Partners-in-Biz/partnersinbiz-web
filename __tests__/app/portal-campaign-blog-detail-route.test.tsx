import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockRefresh = jest.fn()
let searchParams = new URLSearchParams()

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'campaign-1', blogId: 'blog-1' }),
  useRouter: () => ({ refresh: mockRefresh }),
  useSearchParams: () => searchParams,
}))

jest.mock('@/components/campaign-preview', () => ({
  BlogReaderCard: ({ blog }: { blog: { title: string; draft?: { body?: string } } }) => (
    <article>
      <h1>{blog.title}</h1>
      <p>{blog.draft?.body}</p>
    </article>
  ),
}))

jest.mock('@/components/inline-comments', () => ({
  SelectionPopover: () => null,
  CommentComposer: () => null,
  CommentList: ({ comments }: { comments: unknown[] }) => (
    <div>Comments ({comments.length})</div>
  ),
}))

describe('portal campaign blog detail route', () => {
  beforeEach(() => {
    mockRefresh.mockClear()
    searchParams = new URLSearchParams()
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/campaigns/campaign-1/assets' || url === '/api/v1/campaigns/campaign-1/assets?orgId=lumen-org') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              blogs: [
                {
                  id: 'blog-1',
                  title: 'Pipeline post',
                  status: 'review',
                  draft: {
                    body: 'Draft body',
                    wordCount: 220,
                  },
                },
              ],
            },
          }),
        } as Response)
      }
      if (url === '/api/v1/seo/content/blog-1/comments' || url === '/api/v1/seo/content/blog-1/comments?orgId=lumen-org') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: [] }),
        } as Response)
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: {} }),
      } as Response)
    }) as jest.Mock
  })

  it('renders the selected blog behind blog cards in the campaign Blogs tab', async () => {
    const routePath = '@/app/(portal)/portal/campaigns/[id]/blog/[blogId]/page'
    const loaded = await import(routePath).catch((error: unknown) => error)

    expect(loaded).toHaveProperty('default', expect.any(Function))
    const Page = (loaded as { default: React.ComponentType }).default

    render(<Page />)

    expect(await screen.findByRole('heading', { name: 'Pipeline post' })).toBeInTheDocument()
    expect(screen.getByText('Draft body')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /blog posts/i })).toHaveAttribute(
      'href',
      '/portal/campaigns/campaign-1?tab=blogs',
    )
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/campaigns/campaign-1/assets')
    })
    expect(screen.getByRole('button', { name: 'Approve this post' })).toBeInTheDocument()
  })

  it('preserves CRM company scope on links back to the campaign Blogs tab', async () => {
    searchParams = new URLSearchParams('orgId=lumen-org&orgSlug=lumen-speeds')
    const Page = (await import('@/app/(portal)/portal/campaigns/[id]/blog/[blogId]/page')).default

    render(<Page />)

    expect(await screen.findByRole('heading', { name: 'Pipeline post' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /blog posts/i })).toHaveAttribute(
      'href',
      '/portal/campaigns/campaign-1?tab=blogs&orgId=lumen-org&orgSlug=lumen-speeds',
    )
  })

  it('loads comments and approves blog posts through the CRM company workspace scope', async () => {
    searchParams = new URLSearchParams('orgId=lumen-org&orgSlug=lumen-speeds')
    ;(global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/campaigns/campaign-1/assets?orgId=lumen-org') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              blogs: [
                {
                  id: 'blog-1',
                  title: 'Lumen scoped post',
                  status: 'review',
                  draft: {
                    body: 'Scoped draft body',
                    wordCount: 220,
                  },
                },
              ],
            },
          }),
        } as Response)
      }
      if (url === '/api/v1/seo/content/blog-1/comments?orgId=lumen-org') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: [] }),
        } as Response)
      }
      if (url === '/api/v1/seo/content/blog-1/client-approve?orgId=lumen-org' && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { status: 'client_approved' } }),
        } as Response)
      }
      return Promise.resolve({
        ok: false,
        json: async () => ({ error: `unexpected fetch: ${url}` }),
      } as Response)
    })
    const Page = (await import('@/app/(portal)/portal/campaigns/[id]/blog/[blogId]/page')).default

    render(<Page />)

    expect(await screen.findByRole('heading', { name: 'Lumen scoped post' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Approve this post' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/campaigns/campaign-1/assets?orgId=lumen-org')
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/seo/content/blog-1/comments?orgId=lumen-org')
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/seo/content/blog-1/client-approve?orgId=lumen-org', {
        method: 'POST',
      })
      expect(global.fetch).not.toHaveBeenCalledWith('/api/v1/campaigns/campaign-1/assets')
      expect(global.fetch).not.toHaveBeenCalledWith('/api/v1/seo/content/blog-1/comments')
      expect(global.fetch).not.toHaveBeenCalledWith('/api/v1/seo/content/blog-1/client-approve', { method: 'POST' })
    })
    await waitFor(() => {
      expect(screen.getByText('This blog post is approved and waiting for publishing.')).toBeInTheDocument()
    })
  })
})
