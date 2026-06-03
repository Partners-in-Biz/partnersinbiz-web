import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import SequencesPage from '@/app/(portal)/portal/settings/sequences/page'

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

describe('Portal settings sequences page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/crm/sequences') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { sequences: [] } }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock
  })

  it('turns the empty sequence library into a journey setup command center', async () => {
    render(<SequencesPage />)

    expect(await screen.findByText('Launch your first follow-up journey')).toBeInTheDocument()
    expect(screen.getByText('First touch')).toBeInTheDocument()
    expect(screen.getByText('Sales action')).toBeInTheDocument()
    expect(screen.getByText('Employee consistency')).toBeInTheDocument()
    expect(screen.getByText('Automation ready')).toBeInTheDocument()

    expect(screen.getByRole('link', { name: /create the first sequence/i })).toHaveAttribute(
      'href',
      '/portal/settings/sequences/new',
    )
  })

  it('treats an empty filtered sequence view as a reversible journey lens', async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/crm/sequences') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              sequences: [
                {
                  id: 'seq-active',
                  orgId: 'org-1',
                  name: 'Lead welcome',
                  description: 'Follow up new leads fast',
                  status: 'active',
                  steps: [
                    {
                      delayDays: 0,
                      channel: 'email',
                      subject: 'Welcome',
                      bodyText: 'Thanks for getting in touch.',
                    },
                  ],
                  createdAt: null,
                  updatedAt: null,
                },
              ],
            },
          }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock

    render(<SequencesPage />)

    expect(await screen.findByText('Lead welcome')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Paused' }))

    expect(await screen.findByRole('heading', { name: 'No sequences match this view.' })).toBeInTheDocument()
    expect(screen.getByText('Clear the sequence filters to return to every journey.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show all sequences' }))

    expect(await screen.findByText('Lead welcome')).toBeInTheDocument()
  })

  it('uses an in-page confirmation before deleting a sequence journey', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false)
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => undefined)

    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/crm/sequences') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              sequences: [
                {
                  id: 'seq-delete',
                  orgId: 'org-1',
                  name: 'Lead welcome',
                  description: 'Follow up new leads fast',
                  status: 'active',
                  steps: [
                    {
                      delayDays: 0,
                      channel: 'email',
                      subject: 'Welcome',
                      bodyText: 'Thanks for getting in touch.',
                    },
                    {
                      delayDays: 2,
                      channel: 'sms',
                      smsBody: 'Still keen to chat?',
                    },
                  ],
                  createdAt: null,
                  updatedAt: null,
                },
              ],
            },
          }),
        } as Response)
      }
      if (url === '/api/v1/crm/sequences/seq-delete' && init?.method === 'DELETE') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { ok: true } }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock

    render(<SequencesPage />)

    expect(await screen.findByText('Lead welcome')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Delete sequence Lead welcome' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(alertSpy).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog', { name: 'Delete sequence "Lead welcome"?' })).toBeInTheDocument()
    expect(screen.getByText('This removes the active follow-up journey with 2 steps. Existing contact history stays available for audit.')).toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalledWith('/api/v1/crm/sequences/seq-delete', expect.any(Object))
    expect(screen.getByRole('button', { name: 'Cancel delete for sequence Lead welcome' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete sequence Lead welcome' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/sequences/seq-delete', { method: 'DELETE' })
    })
    expect(screen.queryByText('Lead welcome')).not.toBeInTheDocument()

    confirmSpy.mockRestore()
    alertSpy.mockRestore()
  })
})
