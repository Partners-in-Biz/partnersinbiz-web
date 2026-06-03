import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

  it('names sequence creation commands without decorative icon text', async () => {
    render(<SequencesPage />)

    expect(await screen.findByText('Launch your first follow-up journey')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'New sequence' })).toHaveAttribute('href', '/portal/settings/sequences/new')
    expect(screen.getByRole('link', { name: 'Create the first sequence' })).toHaveAttribute('href', '/portal/settings/sequences/new')
    expect(screen.queryByRole('link', { name: 'addNew sequence' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'addCreate the first sequence' })).not.toBeInTheDocument()
  })

  it('warns when sequences fail to load and gives leaders a retry path', async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/crm/sequences') {
        return Promise.resolve({
          ok: false,
          json: async () => ({ error: 'Sequence journeys unavailable' }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock

    render(<SequencesPage />)

    expect(await screen.findByRole('heading', { name: 'Follow-up journeys could not load' })).toBeInTheDocument()
    expect(screen.getByText('Sequence journeys unavailable')).toBeInTheDocument()
    expect(screen.queryByText('Active journeys')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry loading follow-up journeys' }))

    await waitFor(() => {
      const sequenceRequests = (global.fetch as jest.Mock).mock.calls.filter(([url]) => (
        String(url) === '/api/v1/crm/sequences'
      ))
      expect(sequenceRequests).toHaveLength(2)
    })
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

    expect(await screen.findByRole('heading', { name: 'Lead welcome' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Paused' }))

    expect(await screen.findByRole('heading', { name: 'No sequences match this view.' })).toBeInTheDocument()
    expect(screen.getByText('Clear the sequence filters to return to every journey.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show all sequences' }))

    expect(await screen.findByRole('heading', { name: 'Lead welcome' })).toBeInTheDocument()
  })

  it('flags active sequences without exit goals as journey governance gaps', async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/crm/sequences') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              sequences: [
                {
                  id: 'seq-no-goal',
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
                      channel: 'email',
                      subject: 'Still interested?',
                      bodyText: 'Can we help you move forward?',
                    },
                  ],
                  createdAt: null,
                  updatedAt: null,
                },
                {
                  id: 'seq-with-goal',
                  orgId: 'org-1',
                  name: 'Reply-aware welcome',
                  description: 'Stops when a lead replies',
                  status: 'active',
                  goals: [
                    {
                      id: 'goal-replied',
                      label: 'Lead replied',
                      condition: { kind: 'replied' },
                    },
                  ],
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

    expect(await screen.findByRole('heading', { name: 'Lead welcome' })).toBeInTheDocument()
    expect(screen.getByText('1 sequence needs detail')).toBeInTheDocument()
    expect(screen.getByText('92%')).toBeInTheDocument()

    const warning = screen.getByRole('region', { name: 'Sequence exit goal review' })
    expect(within(warning).getByRole('heading', { name: 'Exit goals need review' })).toBeInTheDocument()
    expect(within(warning).getByText('1 active sequence can run without an exit goal.')).toBeInTheDocument()
    expect(within(warning).getByRole('link', { name: 'Review exit goal for Lead welcome' })).toHaveAttribute(
      'href',
      '/portal/settings/sequences/seq-no-goal/edit',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Needs work' }))

    expect(screen.getByRole('heading', { name: 'Lead welcome' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Reply-aware welcome' })).not.toBeInTheDocument()
    expect(screen.getByText('Needs: exit goal')).toBeInTheDocument()
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

    expect(await screen.findByRole('heading', { name: 'Lead welcome' })).toBeInTheDocument()

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

  it('names sparse sequence rows and delete confirmations instead of exposing blank controls', async () => {
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/crm/sequences') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              sequences: [
                {
                  id: 'seq-sparse',
                  orgId: 'org-1',
                  name: '',
                  description: '',
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
      if (url === '/api/v1/crm/sequences/seq-sparse' && init?.method === 'DELETE') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { ok: true } }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock

    render(<SequencesPage />)

    expect(await screen.findByRole('heading', { name: 'Sequence name missing' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Review exit goal for Sequence name missing' })).toHaveAttribute(
      'href',
      '/portal/settings/sequences/seq-sparse/edit',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Delete sequence Sequence name missing' }))

    expect(screen.getByRole('alertdialog', { name: 'Delete sequence "Sequence name missing"?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel delete for sequence Sequence name missing' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm delete sequence Sequence name missing' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete sequence Sequence name missing' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/sequences/seq-sparse', { method: 'DELETE' })
    })
    expect(screen.queryByRole('heading', { name: 'Sequence name missing' })).not.toBeInTheDocument()
  })
})
