import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NotificationBell } from '@/components/crm/NotificationBell'

describe('NotificationBell', () => {
  const originalFetch = global.fetch

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

  it('renders notification links so clicking an item opens the relevant page', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          items: [
            {
              id: 'notification-1',
              orgId: 'pib-platform-owner',
              userId: 'admin-1',
              agentId: null,
              type: 'project.task.comment',
              title: 'New task comment',
              body: 'Peet replied on a project task',
              link: '/admin/org/partners-in-biz/projects/project-1?taskId=task-1',
              data: null,
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
    }) as jest.Mock

    render(<NotificationBell mode="admin" orgId="pib-platform-owner" userId="admin-1" />)

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/v1/notifications?orgId=pib-platform-owner&limit=20&userId=admin-1'))

    fireEvent.click(screen.getByRole('button', { name: 'Open notifications' }))

    const item = await screen.findByRole('link', { name: /new task comment/i })
    expect(item).toHaveAttribute('href', '/admin/org/partners-in-biz/projects/project-1?taskId=task-1')
  })
})
