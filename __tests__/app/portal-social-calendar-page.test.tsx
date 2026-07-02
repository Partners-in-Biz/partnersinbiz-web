import React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import PortalSocialCalendarPage from '@/app/(portal)/portal/social/calendar/page'

const mockPush = jest.fn()
let mockSearchParams = new URLSearchParams()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockSearchParams,
}))

describe('PortalSocialCalendarPage', () => {
  // The calendar opens on the current month and the fixture post is scheduled
  // for 2026-06-13, so pin the clock to June 2026 to keep the post visible as
  // real time advances. Real timers stay active so waitFor keeps working.
  beforeAll(() => {
    jest.useFakeTimers({ now: new Date('2026-06-10T09:00:00.000Z'), doNotFake: ['nextTick', 'setImmediate', 'setInterval', 'setTimeout', 'queueMicrotask'] })
  })

  afterAll(() => {
    jest.useRealTimers()
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockSearchParams = new URLSearchParams()
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/portal/org') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            org: { id: 'client-org-1', name: 'Client Org' },
            user: { role: 'admin' },
          }),
        } as Response)
      }
      if (url === '/api/v1/social/posts?limit=500&orgId=client-org-1') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: [
              {
                id: 'post-1',
                status: 'scheduled',
                platforms: ['linkedin'],
                content: { text: 'Scheduled client post' },
                scheduledAt: { seconds: 1781337600 },
              },
            ],
          }),
        } as Response)
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: [] }),
      } as Response)
    }) as jest.Mock
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  it('loads calendar posts for the active portal workspace', async () => {
    await act(async () => {
      render(<PortalSocialCalendarPage />)
      await Promise.resolve()
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/portal/org')
    })
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/social/posts?limit=500&orgId=client-org-1')
    })

    expect(await screen.findByText('Scheduled client post')).toBeInTheDocument()
  })
})
