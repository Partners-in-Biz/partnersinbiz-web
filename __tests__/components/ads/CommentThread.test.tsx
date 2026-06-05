/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { CommentThread } from '@/app/(portal)/portal/ads/ads/[id]/CommentThread'

const baseCommentsResponse = {
  ok: true,
  json: async () => ({
    success: true,
    data: [
      {
        id: 'cmt_1',
        orgId: 'org_1',
        adId: 'ad_1',
        authorUid: 'uid_client',
        authorName: 'Alice',
        authorRole: 'client',
        text: 'First comment',
        resolved: false,
        createdAt: { seconds: 1700000000, nanoseconds: 0 },
        updatedAt: { seconds: 1700000000, nanoseconds: 0 },
      },
    ],
  }),
}

beforeEach(() => {
  jest.clearAllMocks()
  global.fetch = jest.fn().mockResolvedValue(baseCommentsResponse) as unknown as typeof fetch
})

describe('CommentThread', () => {
  it('renders existing comments fetched from the portal API', async () => {
    render(<CommentThread adId="ad_1" currentUserUid="uid_client" isAdmin={false} />)

    await waitFor(() => {
      expect(screen.getByText('First comment')).toBeInTheDocument()
    })
    expect(screen.getByText('Alice')).toBeInTheDocument()

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit?]
    expect(url).toBe('/api/v1/portal/ads/ads/ad_1/comments')
    expect(init?.method).toBeUndefined() // initial GET
  })

  it('carries the selected company org into comment requests', async () => {
    render(<CommentThread adId="ad_1" currentUserUid="uid_client" isAdmin={false} orgId="lumen-org" />)

    await waitFor(() => {
      expect(screen.getByText('First comment')).toBeInTheDocument()
    })

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit?]
    expect(url).toBe('/api/v1/portal/ads/ads/ad_1/comments?orgId=lumen-org')
    expect(init?.method).toBeUndefined()
  })

  it('POSTs to the portal comments endpoint when Send is clicked', async () => {
    // Initial GET returns base list; second call (POST) returns 201; third call (refetch GET)
    // returns updated list. We only assert the POST shape.
    const mockFetch = jest
      .fn()
      .mockResolvedValueOnce(baseCommentsResponse) // initial GET
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { id: 'cmt_new' } }),
      }) // POST
      .mockResolvedValueOnce(baseCommentsResponse) // refetch
    global.fetch = mockFetch as unknown as typeof fetch

    render(<CommentThread adId="ad_1" currentUserUid="uid_client" isAdmin={false} />)

    // Wait for initial load to finish so the textarea is enabled
    await waitFor(() => {
      expect(screen.getByText('First comment')).toBeInTheDocument()
    })

    const textarea = screen.getByLabelText('New comment') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'Looks good' } })

    fireEvent.click(screen.getByRole('button', { name: /Send/i }))

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(3)
    })

    const [postUrl, postInit] = mockFetch.mock.calls[1] as [string, RequestInit]
    expect(postUrl).toBe('/api/v1/portal/ads/ads/ad_1/comments')
    expect(postInit.method).toBe('POST')
    const body = JSON.parse(postInit.body as string)
    expect(body).toEqual({ text: 'Looks good' })
  })
})
