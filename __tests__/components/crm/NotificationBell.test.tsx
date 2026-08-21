import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NotificationBell } from '@/components/crm/NotificationBell'

const push = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push,
    replace: jest.fn(),
    back: jest.fn(),
    prefetch: jest.fn(),
  }),
}))

describe('NotificationBell', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    push.mockReset()
  })

  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  it('turns an empty CRM notification inbox into a monitored operating state', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          notifications: [],
          unreadCount: 0,
        },
      }),
    }) as jest.Mock

    render(<NotificationBell />)

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/notifications?limit=20'))

    fireEvent.click(screen.getByRole('button', { name: 'Open notifications' }))

    expect(await screen.findByRole('heading', { name: 'No CRM alerts need action' })).toBeInTheDocument()
    expect(
      screen.getByText('You are clear on owner gaps, deal movement, form submissions, and follow-up automation alerts.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Watching owner, deal, and intake signals')).toBeInTheDocument()
  })

  it('opens a notification, marks it read, and navigates to the resolved task destination', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            items: [
              {
                id: 'notification-1',
                orgId: 'pib-platform-owner',
                userId: 'admin-1',
                agentId: null,
                type: 'task.assigned',
                title: 'Task assigned to you',
                body: 'Call the client about the website',
                link: '/portal/projects?task=task-1',
                data: { taskId: 'task-1', projectId: 'project-1' },
                priority: 'normal',
                status: 'unread',
                snoozedUntil: null,
                readAt: null,
                createdAt: '2026-05-24T10:00:00.000Z',
              },
            ],
            unreadCount: 1,
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            id: 'notification-1',
            href: '/admin/org/partners-in-biz/projects/project-1?taskId=task-1',
            status: 'read',
          },
        }),
      }) as jest.Mock

    render(<NotificationBell mode="admin" orgId="pib-platform-owner" userId="admin-1" />)

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/v1/notifications?orgId=pib-platform-owner&limit=20&userId=admin-1'))

    fireEvent.click(screen.getByRole('button', { name: 'Open notifications' }))

    const item = await screen.findByRole('button', { name: /task assigned to you/i })
    fireEvent.click(item)

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/notifications/notification-1/open', { method: 'POST' }),
    )
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/admin/org/partners-in-biz/projects/project-1?taskId=task-1'),
    )
  })

  it('clears visible notifications after marking them read', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            notifications: [
              {
                id: 'notification-1',
                orgId: 'pib-platform-owner',
                userId: 'user-1',
                agentId: null,
                type: 'task.assigned',
                title: 'Task assigned to you',
                body: 'Follow up with a client',
                link: null,
                data: null,
                priority: 'normal',
                status: 'unread',
                snoozedUntil: null,
                readAt: null,
                createdAt: '2026-07-09T08:00:00.000Z',
              },
            ],
            unreadCount: 1,
          },
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) }) as jest.Mock

    render(<NotificationBell />)

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/notifications?limit=20'))
    fireEvent.click(screen.getByRole('button', { name: 'Open notifications' }))
    expect(await screen.findByText('Task assigned to you')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /clear/i }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/notifications/mark-read', { method: 'POST' }))
    expect(screen.queryByText('Task assigned to you')).not.toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'No CRM alerts need action' })).toBeInTheDocument()
  })

  it('prevents dropdown overflow on 390px mobile viewport', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          notifications: [
            {
              id: 'notification-1',
              orgId: 'test-org',
              userId: 'test-user',
              agentId: null,
              type: 'task.assigned',
              title: 'Assigned to you',
              body: 'call: Quinton Mundell (Pretoria dra...',
              link: '/portal/projects?task=task-1',
              data: null,
              priority: 'normal',
              status: 'unread',
              snoozedUntil: null,
              readAt: null,
              createdAt: '2026-08-21T09:45:00.000Z',
            },
          ],
          unreadCount: 1,
        },
      }),
    }) as jest.Mock

    // Simulate 390px mobile viewport
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 390 })
    global.matchMedia = jest.fn().mockImplementation(query => ({
      matches: query === '(max-width: 639px)',
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }))

    const { container } = render(<NotificationBell />)

    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Open notifications' }))

    const dropdown = container.querySelector('.fixed')
    expect(dropdown).toBeInTheDocument()
    expect(dropdown).toHaveClass('right-2')
    expect(dropdown).toHaveClass('sm:right-0')
    expect(dropdown).toHaveClass('w-[min(20rem,calc(100vw-1rem))]')
    
    // Verify "Assigned to you" title is present (not clipped)
    expect(await screen.findByText('Assigned to you')).toBeInTheDocument()
  })
})
