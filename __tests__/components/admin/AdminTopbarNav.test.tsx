import { render, screen } from '@testing-library/react'
import { AdminTopbarNav } from '@/components/admin/AdminTopbarNav'

jest.mock('next/navigation', () => ({
  usePathname: () => '/admin/dashboard',
}))

jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ alt, ...props }: { alt: string }) => <img alt={alt} {...props} />,
}))

jest.mock('@/lib/contexts/OrgContext', () => ({
  useOrg: () => ({
    selectedOrgId: null,
    orgs: [],
  }),
}))

jest.mock('@/components/admin/OrgSwitcher', () => ({
  OrgSwitcher: () => <div data-testid="org-switcher" />,
}))

jest.mock('@/components/crm/NotificationBell', () => ({
  NotificationBell: ({ orgId, userId, mode }: { orgId?: string; userId?: string; mode?: string }) => (
    <button type="button" aria-label="Open notifications" data-org-id={orgId} data-user-id={userId} data-mode={mode}>
      Notifications
    </button>
  ),
}))

describe('AdminTopbarNav account display', () => {
  it('keeps the account email out of the top navbar', () => {
    render(
      <AdminTopbarNav
        userEmail="peet@example.com"
        userUid="admin-1"
        orgId="pib-platform-owner"
        onToggleLayout={jest.fn()}
      />,
    )

    expect(screen.queryByText('peet@example.com')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open notifications' })).toHaveAttribute('data-mode', 'admin')
    expect(screen.getByRole('link', { name: /logout/i })).toBeInTheDocument()
  })
})
