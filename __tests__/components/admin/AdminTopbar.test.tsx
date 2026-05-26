import { render, screen } from '@testing-library/react'
import { AdminTopbar } from '@/components/admin/AdminTopbar'

jest.mock('@/components/crm/NotificationBell', () => ({
  NotificationBell: ({ orgId, userId, mode }: { orgId?: string; userId?: string; mode?: string }) => (
    <button type="button" aria-label="Open notifications" data-org-id={orgId} data-user-id={userId} data-mode={mode}>
      Notifications
    </button>
  ),
}))

describe('AdminTopbar', () => {
  it('shows the admin notification bell in the top navbar without exposing the email address', () => {
    render(<AdminTopbar userEmail="peet@example.com" userUid="admin-1" orgId="pib-platform-owner" />)

    const notifications = screen.getByRole('button', { name: 'Open notifications' })
    expect(notifications).toHaveAttribute('data-org-id', 'pib-platform-owner')
    expect(notifications).toHaveAttribute('data-user-id', 'admin-1')
    expect(notifications).toHaveAttribute('data-mode', 'admin')
    expect(screen.queryByText('peet@example.com')).not.toBeInTheDocument()
  })
})
