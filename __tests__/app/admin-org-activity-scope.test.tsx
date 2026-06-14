import '@testing-library/jest-dom'
import { render, screen, waitFor } from '@testing-library/react'
import ActivityPage from '@/app/(admin)/admin/org/[slug]/activity/page'

jest.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'lumen' }),
}))

const fetchMock = jest.fn()

beforeEach(() => {
  fetchMock.mockReset()
  global.fetch = fetchMock
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/v1/organizations') {
      return jsonResponse({
        data: [
          { id: 'wrong-org', name: 'Wrong', slug: 'wrong' },
          { id: 'org-1', name: 'Lumen', slug: 'lumen' },
        ],
      })
    }
    if (url === '/api/v1/activity?orgId=org-1&limit=50') {
      expect(init?.headers).toEqual(expect.objectContaining({ 'X-Org-Id': 'org-1', 'X-Org-Slug': 'lumen' }))
      return jsonResponse({ data: [{ id: 'evt-1', orgId: 'org-1', type: 'task_created', actorId: 'staff', actorName: 'Theo', actorRole: 'admin', description: 'Scoped event', createdAt: new Date().toISOString() }] })
    }
    throw new Error(`Unexpected fetch: ${url}`)
  })
})

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

describe('Admin org activity scope', () => {
  it('resolves the selected slug before loading tenant-scoped activity', async () => {
    render(<ActivityPage />)

    expect(await screen.findByText('Scoped event')).toBeInTheDocument()
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/activity?orgId=org-1&limit=50', expect.objectContaining({
        headers: expect.objectContaining({ 'X-Org-Id': 'org-1', 'X-Org-Slug': 'lumen' }),
      }))
    })
  })
})
