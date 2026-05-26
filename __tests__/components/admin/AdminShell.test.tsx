import { fireEvent, render, screen } from '@testing-library/react'
import { AdminShell } from '@/components/admin/AdminShell'

let mockPathname = '/admin'

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}))

jest.mock('@/lib/contexts/OrgContext', () => ({
  useOrg: () => ({
    selectedOrgId: 'org_1',
    orgName: 'Acme',
    orgs: [{ id: 'org_1', name: 'Acme', slug: 'acme' }],
  }),
}))

jest.mock('@/components/ui/WelcomeFlashHandler', () => ({
  WelcomeFlashHandler: () => null,
}))

jest.mock('@/components/admin/AdminSidebar', () => ({
  AdminSidebar: ({ open, collapsed }: { open?: boolean; collapsed?: boolean }) => (
    <div data-testid="admin-sidebar" data-open={String(open)} data-collapsed={String(collapsed)} />
  ),
}))

jest.mock('@/components/admin/AdminTopbar', () => ({
  AdminTopbar: ({ onMenuClick, messageAction }: { onMenuClick: () => void; messageAction: React.ReactNode }) => (
    <div>
      <button type="button" onClick={onMenuClick}>Open sidebar</button>
      {messageAction}
    </div>
  ),
}))

jest.mock('@/components/admin/AdminTopbarNav', () => ({
  AdminTopbarNav: ({ messageAction }: { messageAction: React.ReactNode }) => <div>{messageAction}</div>,
}))

jest.mock('@/components/chat/UnifiedChat', () => ({
  __esModule: true,
  default: () => <div data-testid="unified-chat" />,
}))

describe('AdminShell message drawer coordination', () => {
  beforeEach(() => {
    mockPathname = '/admin'
    localStorage.clear()
    window.matchMedia = jest.fn().mockImplementation((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }))
  })

  it('opens the mobile sidebar expanded even when the saved desktop preference is collapsed', () => {
    localStorage.setItem('sidebar_collapsed', 'true')

    render(<AdminShell userEmail="peet@example.com" userUid="user_1"><main>Dashboard</main></AdminShell>)

    expect(screen.getByTestId('admin-sidebar')).toHaveAttribute('data-collapsed', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Open sidebar' }))

    expect(screen.getByTestId('admin-sidebar')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('admin-sidebar')).toHaveAttribute('data-collapsed', 'false')
    expect(localStorage.getItem('sidebar_collapsed')).toBe('false')
  })

  it('closes the left sidebar when the message drawer opens', () => {
    render(<AdminShell userEmail="peet@example.com" userUid="user_1"><main>Dashboard</main></AdminShell>)

    fireEvent.click(screen.getByRole('button', { name: 'Open sidebar' }))
    expect(screen.getByTestId('admin-sidebar')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('admin-sidebar')).toHaveAttribute('data-collapsed', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'Open messages' }))

    expect(screen.getByTestId('admin-sidebar')).toHaveAttribute('data-open', 'false')
    expect(screen.getByTestId('admin-sidebar')).toHaveAttribute('data-collapsed', 'true')
    expect(localStorage.getItem('sidebar_collapsed')).toBe('true')
  })

  it('keeps the org messages page on the standard admin content padding', () => {
    mockPathname = '/admin/org/partners/messages'

    render(<AdminShell userEmail="peet@example.com" userUid="user_1"><main>Messages</main></AdminShell>)

    const main = document.querySelector('[data-slot="app-shell-main"]')
    const content = document.querySelector('[data-slot="app-shell-content"]')

    expect(main).toHaveClass('px-4', 'md:px-8', 'py-8')
    expect(main).not.toHaveClass('px-2', 'md:px-4', 'py-4')
    expect(content).toHaveClass('max-w-[1400px]')
    expect(content).not.toHaveClass('max-w-none')
  })
})
