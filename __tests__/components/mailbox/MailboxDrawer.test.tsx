import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MailboxDrawer } from '@/components/mailbox/MailboxDrawer'

const originalMatchMedia = window.matchMedia

beforeEach(() => {
  document.body.innerHTML = ''
  window.matchMedia = jest.fn().mockImplementation(() => ({
    matches: true,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  }))
})

afterEach(() => {
  jest.restoreAllMocks()
  window.matchMedia = originalMatchMedia
})

describe('MailboxDrawer', () => {
  it('does not render the topbar mail action when no mailbox account is connected', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { accounts: [] } }),
    }) as jest.Mock

    render(<MailboxDrawer />)

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Open email' })).not.toBeInTheDocument()
    })
  })

  it('renders a mail icon for connected accounts and opens the mailbox sidebar', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { accounts: [{ id: 'acct_1', emailAddress: 'peet@example.com' }] } }),
    }) as jest.Mock

    render(
      <div data-message-push-root>
        <MailboxDrawer />
      </div>,
    )

    const action = await screen.findByRole('button', { name: 'Open email' })
    expect(action).toBeInTheDocument()
    expect(screen.queryByText('peet@example.com')).not.toBeInTheDocument()

    fireEvent.click(action)

    expect(await screen.findByRole('complementary', { name: 'Email mailbox' })).toBeInTheDocument()
    expect(screen.getByTitle('Email mailbox')).toHaveAttribute('src', '/portal/email?compact=1')
  })

  it('notifies the shell when email is opened so mobile navigation can close', async () => {
    const handleOpen = jest.fn()
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { accounts: [{ id: 'acct_1' }] } }),
    }) as jest.Mock

    render(<MailboxDrawer onOpen={handleOpen} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Open email' }))

    expect(handleOpen).toHaveBeenCalledTimes(1)
  })
})
