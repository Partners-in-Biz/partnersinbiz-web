import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import AutomationsPage from '@/app/(portal)/portal/settings/automations/page'

let mockSearchParams = new URLSearchParams()

jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

describe('Portal settings automations page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSearchParams = new URLSearchParams()
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/crm/automations') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { rules: [] } }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock
  })

  it('turns the empty automation library into a CRM safety-net command center', async () => {
    render(<AutomationsPage />)

    expect(await screen.findByText('Launch your first CRM safety net')).toBeInTheDocument()
    expect(screen.getByText('Trigger')).toBeInTheDocument()
    expect(screen.getByText('Action')).toBeInTheDocument()
    expect(screen.getByText('Owner handoff')).toBeInTheDocument()
    expect(screen.getByText('Audit trail')).toBeInTheDocument()

    expect(screen.getByRole('link', { name: /create the first automation/i })).toHaveAttribute(
      'href',
      '/portal/settings/automations/new',
    )
  })

  it('names automation creation commands without decorative icon text', async () => {
    render(<AutomationsPage />)

    expect(await screen.findByText('Launch your first CRM safety net')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'New automation' })).toHaveAttribute('href', '/portal/settings/automations/new')
    expect(screen.getByRole('link', { name: 'Create the first automation' })).toHaveAttribute('href', '/portal/settings/automations/new')
    expect(screen.queryByRole('link', { name: 'addNew automation' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'addCreate the first automation' })).not.toBeInTheDocument()
  })

  it('keeps automations scoped when opened from a CRM company workspace', async () => {
    mockSearchParams = new URLSearchParams({ orgId: 'lumen-org', orgSlug: 'lumen-speeds' })
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/crm/automations?orgId=lumen-org') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { rules: [] } }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock

    render(<AutomationsPage />)

    expect(await screen.findByText('Launch your first CRM safety net')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'New automation' })).toHaveAttribute(
      'href',
      '/portal/settings/automations/new?orgId=lumen-org&orgSlug=lumen-speeds',
    )
  })

  it('warns when automations fail to load and gives leaders a retry path', async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/crm/automations') {
        return Promise.resolve({
          ok: false,
          json: async () => ({ error: 'Automation rules unavailable' }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock

    render(<AutomationsPage />)

    expect(await screen.findByRole('heading', { name: 'Automation rules could not load' })).toBeInTheDocument()
    expect(screen.getByText('Automation rules unavailable')).toBeInTheDocument()
    expect(screen.queryByText('Live rules')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry loading automation rules' }))

    await waitFor(() => {
      const automationRequests = (global.fetch as jest.Mock).mock.calls.filter(([url]) => (
        String(url) === '/api/v1/crm/automations'
      ))
      expect(automationRequests).toHaveLength(2)
    })
  })

  it('treats an empty filtered automation view as a reversible operations lens', async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/crm/automations') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              rules: [
                {
                  id: 'rule-active',
                  orgId: 'org-1',
                  name: 'New lead owner alert',
                  description: 'Notify the team when a new lead is captured.',
                  enabled: true,
                  trigger: { event: 'contact.created' },
                  actions: [
                    {
                      type: 'send_notification',
                      notificationMessage: 'Assign the new lead today.',
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

    render(<AutomationsPage />)

    expect(await screen.findByText('New lead owner alert')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Paused' }))

    expect(await screen.findByRole('heading', { name: 'No automations match this view.' })).toBeInTheDocument()
    expect(screen.getByText('Clear the automation filters to return to every CRM rule.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show all automations' }))

    expect(await screen.findByText('New lead owner alert')).toBeInTheDocument()
  })

  it('names incomplete automation action snapshots instead of exposing raw ids', async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/crm/automations') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              rules: [
                {
                  id: 'rule-sparse-actions',
                  orgId: 'org-1',
                  name: 'Sparse automation handoff',
                  description: 'Check sparse action labels.',
                  enabled: true,
                  trigger: { event: 'contact.created' },
                  actions: [
                    {
                      type: 'assign_owner',
                      ownerUid: 'uid-owner-raw',
                    },
                    {
                      type: 'enroll_in_sequence',
                      sequenceId: 'seq-raw',
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

    render(<AutomationsPage />)

    expect(await screen.findByText('Sparse automation handoff')).toBeInTheDocument()
    expect(screen.getByText('Owner identity missing')).toBeInTheDocument()
    expect(screen.getByText('Sequence identity missing')).toBeInTheDocument()
    expect(screen.queryByText('uid-owner-raw')).not.toBeInTheDocument()
    expect(screen.queryByText('seq-raw')).not.toBeInTheDocument()
  })

  it('uses an in-page confirmation before deleting an automation rule', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false)
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => undefined)

    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/crm/automations') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              rules: [
                {
                  id: 'rule-delete',
                  orgId: 'org-1',
                  name: 'New lead owner alert',
                  description: 'Notify the team when a new lead is captured.',
                  enabled: true,
                  trigger: { event: 'contact.created' },
                  actions: [
                    {
                      type: 'send_notification',
                      notificationMessage: 'Assign the new lead today.',
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
      if (url === '/api/v1/crm/automations/rule-delete' && init?.method === 'DELETE') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { ok: true } }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock

    render(<AutomationsPage />)

    expect(await screen.findByText('New lead owner alert')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Delete automation New lead owner alert' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(alertSpy).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog', { name: 'Delete automation "New lead owner alert"?' })).toBeInTheDocument()
    expect(screen.getByText('This removes the CRM safety net for contact.created and stops 1 workflow action from running. Existing CRM history stays available for audit.')).toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalledWith('/api/v1/crm/automations/rule-delete', expect.any(Object))
    expect(screen.getByRole('button', { name: 'Cancel delete for automation New lead owner alert' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete automation New lead owner alert' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/automations/rule-delete', { method: 'DELETE' })
    })
    expect(screen.queryByText('New lead owner alert')).not.toBeInTheDocument()

    confirmSpy.mockRestore()
    alertSpy.mockRestore()
  })

  it('names sparse automation rows and delete confirmations instead of exposing blank controls', async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/crm/automations') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              rules: [
                {
                  id: 'rule-sparse',
                  orgId: 'org-1',
                  name: '',
                  description: '',
                  enabled: true,
                  trigger: { event: 'contact.created' },
                  actions: [],
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

    render(<AutomationsPage />)

    expect(await screen.findByText('Automation name missing')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Delete automation Automation name missing' }))

    expect(screen.getByRole('alertdialog', { name: 'Delete automation "Automation name missing"?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel delete for automation Automation name missing' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm delete automation Automation name missing' })).toBeInTheDocument()
  })
})
