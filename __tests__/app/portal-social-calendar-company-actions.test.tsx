import { act, render, waitFor } from '@testing-library/react'
import PortalSocialCalendarPage from '@/app/(portal)/portal/social/calendar/page'

const mockPush = jest.fn()
let mockSearchParams = new URLSearchParams()
let mockCalendarProps: Record<string, unknown> | null = null

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockSearchParams,
}))

jest.mock('@/components/social/SocialCalendarWorkspace', () => ({
  getScheduledDate: (post: { scheduledAt?: string; scheduledFor?: string }) => {
    const value = post.scheduledAt ?? post.scheduledFor
    return value ? new Date(value) : null
  },
  toDatetimeLocalValue: (date: Date) => {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    return local.toISOString().slice(0, 16)
  },
  SocialCalendarWorkspace: (props: Record<string, unknown>) => {
    mockCalendarProps = props
    return null
  },
}))

describe('PortalSocialCalendarPage company workspace actions', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCalendarProps = null
    mockSearchParams = new URLSearchParams({
      orgId: 'lumen-org',
      orgSlug: 'lumen-speeds',
      sourceCompanyId: 'company-1',
      sourceCompanyName: 'Lumen',
    })
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/portal/org?orgId=lumen-org') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ org: { id: 'lumen-org', name: 'Lumen', slug: 'lumen-speeds' } }),
        } as Response)
      }
      if (url === '/api/v1/social/posts?limit=500&orgId=lumen-org') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: [
              {
                id: 'post-1',
                status: 'scheduled',
                platforms: ['linkedin'],
                content: { text: 'Lumen launch post' },
                scheduledAt: '2026-06-13T08:00:00.000Z',
              },
            ],
          }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  it('enables the shared admin-grade calendar operations while preserving company scope', async () => {
    await act(async () => {
      render(<PortalSocialCalendarPage />)
      await Promise.resolve()
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(mockCalendarProps).toEqual(expect.objectContaining({ loading: false }))
    })

    expect(mockCalendarProps).toEqual(expect.objectContaining({
      allowDayCreate: true,
      allowDragReschedule: true,
      closePanelAfterActions: true,
      composeHref:
        '/portal/social/compose?orgId=lumen-org&orgSlug=lumen-speeds&sourceCompanyId=company-1&sourceCompanyName=Lumen',
    }))

    const editHref = mockCalendarProps?.editHref as ((post: { id: string }) => string) | undefined
    expect(editHref?.({ id: 'post-1' })).toBe(
      '/portal/social/compose?orgId=lumen-org&orgSlug=lumen-speeds&sourceCompanyId=company-1&sourceCompanyName=Lumen',
    )

    const onCreateForDay = mockCalendarProps?.onCreateForDay as ((day: Date) => void) | undefined
    onCreateForDay?.(new Date(2026, 5, 15, 10, 30))

    expect(mockPush).toHaveBeenCalledWith(
      '/portal/social/compose?orgId=lumen-org&orgSlug=lumen-speeds&sourceCompanyId=company-1&sourceCompanyName=Lumen&scheduledAt=2026-06-15T10%3A30',
    )
  })
})
