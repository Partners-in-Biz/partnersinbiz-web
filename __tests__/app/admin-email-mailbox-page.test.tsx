import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import MailboxPage from '@/app/(admin)/admin/email/mailbox/page'

const back = jest.fn()
const push = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ back, push }),
  useSearchParams: () => new URLSearchParams(),
}))

describe('Admin mailbox page', () => {
  beforeEach(() => {
    back.mockClear()
    push.mockClear()
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/v1/admin/mailbox/accounts')) {
        return {
          ok: true,
          json: async () => ({
            data: {
              accounts: [
                {
                  id: 'acct_1',
                  displayName: 'Peet Stander',
                  emailAddress: 'peet@example.com',
                  provider: 'google',
                  status: 'connected',
                  isDefault: true,
                },
              ],
            },
          }),
        } as Response
      }
      if (url.startsWith('/api/v1/admin/mailbox/messages')) {
        return {
          ok: true,
          json: async () => ({ data: { messages: [] } }),
        } as Response
      }
      throw new Error(`Unhandled fetch ${url}`)
    }) as jest.Mock
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('provides a close action for mobile mailbox navigation', async () => {
    window.history.pushState({}, '', '/admin/dashboard')
    window.history.pushState({}, '', '/admin/email/mailbox')

    render(<MailboxPage />)

    const close = await screen.findByRole('button', { name: 'Close email and return to workspace' })
    expect(close).toHaveClass('sm:hidden')

    fireEvent.click(close)

    expect(back).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
  })
})
