import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AdminShell } from '@/components/admin/AdminShell'

let mockPathname = '/admin'
let mockSearchParams = new URLSearchParams()

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useSearchParams: () => mockSearchParams,
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

jest.mock('@/components/mailbox/MailboxDrawer', () => ({
  MailboxDrawer: () => <button type="button" aria-label="Open email">Email</button>,
}))

jest.mock('@/components/command-palette/CommandPalette', () => ({
  CommandPalette: () => null,
}))

describe('AdminShell message drawer coordination', () => {
  beforeEach(() => {
    mockPathname = '/admin'
    mockSearchParams = new URLSearchParams()
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

  it('opens the mobile sidebar expanded even when the saved desktop preference is collapsed', async () => {
    localStorage.setItem('sidebar_collapsed', 'true')

    render(<AdminShell userEmail="peet@example.com" userUid="user_1"><main>Dashboard</main></AdminShell>)

    await waitFor(() => expect(screen.getByTestId('admin-sidebar')).toHaveAttribute('data-collapsed', 'true'))

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

  it('hides admin chrome on messages by default until Show navigation is clicked', () => {
    mockPathname = '/admin/org/partners/messages'
    mockSearchParams = new URLSearchParams()

    render(<AdminShell userEmail="peet@example.com" userUid="user_1"><main>Messages</main></AdminShell>)

    expect(screen.queryByTestId('admin-sidebar')).not.toBeInTheDocument()
    expect(screen.getByTestId('bot-mode-immersive-shell')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show navigation' }))
    expect(screen.getByTestId('admin-sidebar')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide navigation' })).toBeInTheDocument()
  })

  it('hides admin chrome in Bot mode until Show navigation is clicked', () => {
    mockPathname = '/admin/org/partners/messages'
    mockSearchParams = new URLSearchParams('mode=bot')

    render(<AdminShell userEmail="peet@example.com" userUid="user_1"><main>Messages</main></AdminShell>)

    expect(screen.queryByTestId('admin-sidebar')).not.toBeInTheDocument()
    expect(screen.getByTestId('bot-mode-immersive-shell')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show navigation' }))
    expect(screen.getByTestId('admin-sidebar')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide navigation' })).toBeInTheDocument()
  })
})
