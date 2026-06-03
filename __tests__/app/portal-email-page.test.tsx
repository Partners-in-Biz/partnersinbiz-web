import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import PortalEmailPage from '@/app/(portal)/portal/email/page'

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}))

const account = {
  id: 'account-1',
  orgId: 'org-1',
  userId: 'user-1',
  provider: 'smtp_imap',
  emailAddress: 'hello@partnersinbiz.online',
  displayName: 'Partners in Biz',
  status: 'connected',
  isDefault: true,
  createdAt: null,
  updatedAt: null,
}

describe('Portal email page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/portal/email/accounts') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { accounts: [account] } }),
        } as Response)
      }
      if (url === '/api/v1/portal/email/messages?folder=inbox&accountId=all&q=') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { messages: [] } }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('uses an in-composer link panel instead of a browser prompt', async () => {
    const promptSpy = jest.spyOn(window, 'prompt').mockReturnValue('https://example.com')

    render(<PortalEmailPage />)

    await waitFor(() => {
      expect(screen.getAllByText('hello@partnersinbiz.online').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: /new email/i }))
    fireEvent.mouseDown(screen.getByTitle('Insert link'))

    expect(promptSpy).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Insert email link' })).toBeInTheDocument()
    expect(screen.getByLabelText('URL to link')).toHaveValue('https://')
    expect(screen.getByRole('button', { name: 'Apply link to email body' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel email link insert' })).toBeInTheDocument()

    promptSpy.mockRestore()
  })
})
