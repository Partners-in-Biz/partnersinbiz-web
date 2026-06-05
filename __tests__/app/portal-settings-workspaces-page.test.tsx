import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import WorkspacesPage from '@/app/(portal)/portal/settings/workspaces/page'

describe('Portal settings workspaces page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/portal/orgs') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            activeOrgId: 'org-lumen',
            orgs: [
              { id: 'org-lumen', name: 'Lumen Speeds', logoUrl: '' },
              { id: 'org-acme', name: 'Acme Sales', logoUrl: '' },
              { id: 'org-foce', name: 'Foce Property', logoUrl: '' },
            ],
          }),
        } as Response)
      }
      if (url === '/api/v1/portal/active-org' && init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: async () => ({ success: true }) } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('gives leaders a workspace command center before switching company context', async () => {
    render(<WorkspacesPage />)

    expect(await screen.findByText('Lumen Speeds')).toBeInTheDocument()

    const commandCenter = screen.getByRole('region', { name: 'Workspace command center' })
    expect(within(commandCenter).getByRole('heading', { name: 'Workspace command center' })).toBeInTheDocument()
    expect(within(commandCenter).getByText('3 company workspaces')).toBeInTheDocument()
    expect(within(commandCenter).getByText('Lumen Speeds active')).toBeInTheDocument()
    expect(within(commandCenter).getByText('2 switch-ready')).toBeInTheDocument()
    expect(within(commandCenter).getByRole('link', { name: 'Review team access' })).toHaveAttribute('href', '/portal/settings/team')
    expect(within(commandCenter).getByRole('link', { name: 'Review CRM setup' })).toHaveAttribute('href', '/portal/settings/crm-setup')

    fireEvent.click(screen.getByRole('button', { name: 'Switch to Acme Sales workspace' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/portal/active-org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId: 'org-acme' }),
      })
    })
    expect(await screen.findByText('Acme Sales active')).toBeInTheDocument()
  })
})
