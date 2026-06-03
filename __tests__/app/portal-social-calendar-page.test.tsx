import React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import PortalSocialCalendarPage from '@/app/(portal)/portal/social/calendar/page'

describe('PortalSocialCalendarPage', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-03T08:00:00.000Z'))
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
    jest.useRealTimers()
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
