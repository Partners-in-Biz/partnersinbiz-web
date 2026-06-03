import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import PortalContactsPage from '@/app/(portal)/portal/contacts/page'

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

describe('Portal contacts page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSearchParams = new URLSearchParams()
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/v1/crm/contacts')) {
        const requestUrl = new URL(url, 'http://localhost')
        const stage = requestUrl.searchParams.get('stage')
        const contacts = [
          {
            id: 'contact-owned',
            name: 'Owned Client',
            email: 'owned@example.com',
            phone: '+27825550111',
            company: 'Owned Co',
            type: 'client',
            stage: 'won',
            assignedTo: 'sales-lead-1',
            assignedToRef: { uid: 'sales-lead-1', displayName: 'Ava Owner' },
            tags: [],
            lastContactedAt: null,
          },
          {
            id: 'contact-unowned',
            name: 'Unowned Prospect',
            email: 'unowned@example.com',
            company: 'Open Co',
            type: 'lead',
            stage: 'new',
            assignedTo: '',
            tags: [],
            lastContactedAt: null,
          },
          {
            id: 'contact-fresh',
            name: 'Fresh Followup',
            email: 'fresh@example.com',
            company: 'Fresh Co',
            type: 'lead',
            stage: 'contacted',
            assignedTo: 'sales-lead-1',
            assignedToRef: { uid: 'sales-lead-1', displayName: 'Ava Owner' },
            tags: [],
            lastContactedAt: '2026-05-28T08:00:00.000Z',
          },
        ]
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: stage ? contacts.filter(contact => contact.stage === stage) : contacts,
          }),
        } as Response)
      }
      if (url === '/api/v1/portal/settings/team') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            members: [
              {
                uid: 'sales-lead-2',
                firstName: 'Mandy',
                lastName: 'Manager',
                jobTitle: 'Sales lead',
                role: 'admin',
              },
            ],
          }),
        } as Response)
      }
      if (url.startsWith('/api/v1/crm/saved-views')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: [] }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock
  })

  it('surfaces unowned contacts as a portal accountability lens', async () => {
    render(<PortalContactsPage />)

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Open contact Owned Client' })).toBeInTheDocument()
    })
    expect(screen.getByRole('link', { name: 'Open contact Unowned Prospect' })).toBeInTheDocument()

    expect(screen.getByText('Owner coverage')).toBeInTheDocument()
    expect(screen.getByText('1 unowned')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show unowned contacts needing an owner' }))

    expect(screen.queryByRole('link', { name: 'Open contact Owned Client' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open contact Unowned Prospect' })).toBeInTheDocument()

    const row = screen.getByRole('link', { name: 'Open contact Unowned Prospect' }).closest('[data-contact-row]')
    expect(row).not.toBeNull()
    expect(within(row as HTMLElement).getByText('Unassigned')).toBeInTheDocument()
  })

  it('turns the team workload card into a bulk owner-gap assignment command', async () => {
    render(<PortalContactsPage />)

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Open contact Owned Client' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Select 1 unowned contact for owner assignment' }))

    expect(screen.getByRole('checkbox', { name: 'Select Unowned Prospect' })).toBeChecked()
    expect(screen.queryByRole('checkbox', { name: 'Select Owned Client' })).not.toBeInTheDocument()
    expect(screen.getByText('1 selected')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Bulk action' })).toHaveValue('assign')
    expect(screen.getByText('owner: unowned')).toBeInTheDocument()
  })

  it('warns leaders when visible contacts look like smoke-test setup data', async () => {
    ;(global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/v1/crm/contacts')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: [
              {
                id: 'contact-owned',
                name: 'Owned Client',
                email: 'owned@example.com',
                phone: '+27825550111',
                company: 'Owned Co',
                type: 'client',
                stage: 'won',
                assignedTo: 'sales-lead-1',
                assignedToRef: { uid: 'sales-lead-1', displayName: 'Ava Owner' },
                tags: [],
                lastContactedAt: null,
              },
              {
                id: 'contact-smoke',
                name: 'Smoke composer focus contact 20260531172148',
                email: 'smoke-20260531172148@example.com',
                company: '',
                type: 'lead',
                stage: 'new',
                assignedTo: '',
                tags: [],
                lastContactedAt: null,
              },
            ],
          }),
        } as Response)
      }
      if (url === '/api/v1/portal/settings/team') {
        return Promise.resolve({ ok: true, json: async () => ({ members: [] }) } as Response)
      }
      if (url.startsWith('/api/v1/crm/saved-views')) {
        return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    })

    render(<PortalContactsPage />)

    expect(await screen.findByRole('heading', { name: 'Contact setup needs review' })).toBeInTheDocument()

    const review = screen.getByRole('region', { name: 'Contact setup review for visible contacts' })
    expect(within(review).getByText('1 visible contact looks like smoke-test setup data.')).toBeInTheDocument()
    expect(within(review).getByText('Smoke composer focus contact 20260531172148')).toBeInTheDocument()

    fireEvent.click(within(review).getByRole('button', { name: 'Select 1 setup contact for cleanup' }))

    expect(screen.getByRole('checkbox', { name: 'Select Smoke composer focus contact 20260531172148' })).toBeChecked()
    expect(screen.queryByRole('checkbox', { name: 'Select Owned Client' })).not.toBeChecked()
    expect(screen.getByText('1 selected')).toBeInTheDocument()
  })

  it('warns when contacts fail to load instead of presenting the audience as empty', async () => {
    ;(global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/v1/crm/contacts')) {
        return Promise.resolve({
          ok: false,
          json: async () => ({ error: 'Contacts index unavailable' }),
        } as Response)
      }
      if (url === '/api/v1/portal/settings/team') {
        return Promise.resolve({ ok: true, json: async () => ({ members: [] }) } as Response)
      }
      if (url.startsWith('/api/v1/crm/saved-views')) {
        return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    })

    render(<PortalContactsPage />)

    expect(await screen.findByRole('heading', { name: 'Contacts could not load' })).toBeInTheDocument()
    expect(screen.getByText('Contacts index unavailable')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'No contacts yet.' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry loading contacts' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(4)
    })
  })

  it('opens directly to the unowned-owner lens from CRM reports', async () => {
    mockSearchParams = new URLSearchParams('owner=unowned')

    render(<PortalContactsPage />)

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Open contact Unowned Prospect' })).toBeInTheDocument()
    })

    expect(screen.queryByRole('link', { name: 'Open contact Owned Client' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show all contacts' })).toBeInTheDocument()
    expect(screen.getByText('1 unowned contact need assignment.')).toBeInTheDocument()
    expect(screen.getByText('owner: unowned')).toBeInTheDocument()
  })

  it('treats an empty unowned-owner lens as clean contact accountability', async () => {
    mockSearchParams = new URLSearchParams('owner=unowned')
    ;(global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/v1/crm/contacts')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: [
              {
                id: 'contact-owned',
                name: 'Owned Client',
                email: 'owned@example.com',
                company: 'Owned Co',
                type: 'client',
                stage: 'won',
                assignedTo: 'sales-lead-1',
                assignedToRef: { uid: 'sales-lead-1', displayName: 'Ava Owner' },
                tags: [],
                lastContactedAt: null,
              },
            ],
          }),
        } as Response)
      }
      if (url === '/api/v1/portal/settings/team') {
        return Promise.resolve({ ok: true, json: async () => ({ members: [] }) } as Response)
      }
      if (url.startsWith('/api/v1/crm/saved-views')) {
        return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    })

    render(<PortalContactsPage />)

    expect(await screen.findByRole('heading', { name: 'No unowned contacts.' })).toBeInTheDocument()
    expect(screen.getAllByText('No unowned contacts.').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('Every contact in this view has an owner.').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByRole('button', { name: 'Show all contacts' }).length).toBeGreaterThan(0)
  })

  it('opens directly to a stage lens from CRM reports', async () => {
    mockSearchParams = new URLSearchParams('stage=new')

    render(<PortalContactsPage />)

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Open contact Unowned Prospect' })).toBeInTheDocument()
    })

    expect(screen.queryByRole('link', { name: 'Open contact Owned Client' })).not.toBeInTheDocument()
    expect(screen.getByText('1 contact match this view.')).toBeInTheDocument()
    expect(screen.getByText('stage: new')).toBeInTheDocument()
  })

  it('renders contact stage and type labels as readable CRM language', async () => {
    render(<PortalContactsPage />)

    const ownedRowLink = await screen.findByRole('link', { name: 'Open contact Owned Client' })
    const ownedRow = ownedRowLink.closest('[data-contact-row]')
    expect(ownedRow).not.toBeNull()

    expect(within(ownedRow as HTMLElement).getByText('Client')).toBeInTheDocument()
    expect(within(ownedRow as HTMLElement).getByText('Won')).toBeInTheDocument()
    expect(within(ownedRow as HTMLElement).queryByText('client')).not.toBeInTheDocument()
    expect(within(ownedRow as HTMLElement).queryByText('won')).not.toBeInTheDocument()

    expect(screen.getByRole('option', { name: 'Contacted' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Client' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'contacted' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'client' })).not.toBeInTheDocument()
  })

  it('keeps the mobile select control from taking a full contact-card column', async () => {
    render(<PortalContactsPage />)

    const ownedRowLink = await screen.findByRole('link', { name: 'Open contact Owned Client' })
    const ownedRow = ownedRowLink.closest('[data-contact-row]')
    expect(ownedRow).not.toBeNull()

    expect(ownedRow).toHaveClass('grid-cols-1')
    expect(ownedRow).toHaveClass('md:grid-cols-15')
    expect(ownedRow).not.toHaveClass('grid-cols-2')

    const selectCell = within(ownedRow as HTMLElement)
      .getByRole('checkbox', { name: 'Select Owned Client' })
      .closest('[data-contact-select]')
    expect(selectCell).not.toBeNull()
    expect(selectCell).toHaveClass('absolute')
    expect(selectCell).toHaveClass('md:static')

    const contentCell = (ownedRow as HTMLElement).querySelector('[data-contact-card-content]')
    expect(contentCell).not.toBeNull()
    expect(contentCell).toHaveClass('col-span-1')
    expect(contentCell).toHaveClass('md:col-span-14')
  })

  it('names primary contact commands and filters without decorative icon text', async () => {
    render(<PortalContactsPage />)

    expect(await screen.findByRole('link', { name: 'Open contact Owned Client' })).toBeInTheDocument()

    expect(screen.getByRole('button', { name: 'Find duplicates' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New contact' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save current view' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Filter contacts by stage' })).toHaveValue('')
    expect(screen.getByRole('combobox', { name: 'Filter contacts by type' })).toHaveValue('')
    expect(screen.queryByRole('button', { name: 'merge Find duplicates' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'add New contact' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'bookmark_add Save current view' })).not.toBeInTheDocument()
  })

  it('surfaces duplicate scan failures before the contact table', async () => {
    ;(global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/crm/contacts/duplicates') {
        return Promise.resolve({
          ok: false,
          json: async () => ({ error: 'Duplicate scan unavailable' }),
        } as Response)
      }
      if (url.startsWith('/api/v1/crm/contacts')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: [
              {
                id: 'contact-owned',
                name: 'Owned Client',
                email: 'owned@example.com',
                phone: '+27825550111',
                company: 'Owned Co',
                type: 'client',
                stage: 'won',
                assignedTo: 'sales-lead-1',
                assignedToRef: { uid: 'sales-lead-1', displayName: 'Ava Owner' },
                tags: [],
                lastContactedAt: null,
              },
            ],
          }),
        } as Response)
      }
      if (url === '/api/v1/portal/settings/team') {
        return Promise.resolve({ ok: true, json: async () => ({ members: [] }) } as Response)
      }
      if (url.startsWith('/api/v1/crm/saved-views')) {
        return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    })

    render(<PortalContactsPage />)

    expect(await screen.findByRole('link', { name: 'Open contact Owned Client' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Find duplicates' }))

    const warning = await screen.findByRole('status', { name: 'Duplicate scan could not run' })
    expect(warning).toHaveTextContent('Duplicate scan unavailable')

    const firstContactLink = screen.getByRole('link', { name: 'Open contact Owned Client' })
    expect(warning.compareDocumentPosition(firstContactLink) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('names the new contact drawer close action by drawer context', async () => {
    render(<PortalContactsPage />)

    expect(await screen.findByRole('link', { name: 'Open contact Owned Client' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'New contact' }))

    expect(screen.getByRole('button', { name: 'Close New contact drawer' })).toBeInTheDocument()
  })

  it('turns contact list row details into direct outreach and company triage actions', async () => {
    render(<PortalContactsPage />)

    const ownedRowLink = await screen.findByRole('link', { name: 'Open contact Owned Client' })
    const ownedRow = ownedRowLink.closest('[data-contact-row]')
    expect(ownedRow).not.toBeNull()

    expect(within(ownedRow as HTMLElement).getByRole('link', { name: 'Open contact Owned Client' }))
      .toHaveAttribute('href', '/portal/contacts/contact-owned')
    expect(within(ownedRow as HTMLElement).getByRole('link', { name: 'Email owned@example.com from contacts list' }))
      .toHaveAttribute('href', 'mailto:owned@example.com')
    expect(within(ownedRow as HTMLElement).getByRole('link', { name: 'Call +27825550111 from contacts list' }))
      .toHaveAttribute('href', 'tel:+27825550111')
    expect(within(ownedRow as HTMLElement).getByRole('link', { name: 'Log activity for Owned Client from last contacted column' }))
      .toHaveAttribute('href', '/portal/contacts/contact-owned?activity=note')

    fireEvent.click(within(ownedRow as HTMLElement).getByRole('button', { name: 'Filter contacts by company Owned Co' }))
    expect(screen.getByPlaceholderText('Search name, email, company…')).toHaveValue('Owned Co')
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/contacts?search=Owned+Co')
    })
  })

  it('treats an empty contact stage lens as a clean funnel stage', async () => {
    mockSearchParams = new URLSearchParams('stage=proposal')

    render(<PortalContactsPage />)

    expect(await screen.findByRole('heading', { name: 'No contacts in Proposal.' })).toBeInTheDocument()
    expect(screen.getByText('This funnel stage is clear for the current contact lens.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument()
    expect(screen.getByText('stage: proposal')).toBeInTheDocument()
  })

  it('opens directly to stale follow-up contacts from CRM reports', async () => {
    mockSearchParams = new URLSearchParams('followUp=stale')

    render(<PortalContactsPage />)

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Open contact Owned Client' })).toBeInTheDocument()
    })

    expect(screen.getByRole('link', { name: 'Open contact Unowned Prospect' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Open contact Fresh Followup' })).not.toBeInTheDocument()
    expect(screen.getByText('2 contacts need follow-up.')).toBeInTheDocument()
    expect(screen.getByText('followUp: stale')).toBeInTheDocument()
  })

  it('names missing row details instead of showing bare dashes', async () => {
    ;(global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/v1/crm/contacts')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: [
              {
                id: 'contact-needs-enrichment',
                name: 'Needs Enrichment',
                email: '',
                company: '',
                type: 'lead',
                stage: 'new',
                assignedTo: '',
                tags: [],
                lastContactedAt: null,
              },
            ],
          }),
        } as Response)
      }
      if (url === '/api/v1/portal/settings/team') {
        return Promise.resolve({ ok: true, json: async () => ({ members: [] }) } as Response)
      }
      if (url.startsWith('/api/v1/crm/saved-views')) {
        return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    })

    render(<PortalContactsPage />)

    const rowLink = await screen.findByRole('link', { name: 'Open contact Needs Enrichment' })
    const row = rowLink.closest('[data-contact-row]')

    expect(row).not.toBeNull()
    expect(within(row as HTMLElement).getByText('Email missing')).toBeInTheDocument()
    expect(within(row as HTMLElement).getByText('Company missing')).toBeInTheDocument()
    expect(within(row as HTMLElement).getByText('No touch logged')).toBeInTheDocument()
  })

  it('names incomplete owner snapshots instead of exposing raw team member ids', async () => {
    ;(global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/v1/crm/contacts')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: [
              {
                id: 'contact-raw-owner',
                name: 'Raw Owner Contact',
                email: 'raw-owner@example.com',
                company: 'Owner Gap Co',
                type: 'lead',
                stage: 'new',
                assignedTo: 'sales-lead-raw',
                assignedToRef: { uid: 'sales-lead-raw' },
                tags: [],
                lastContactedAt: null,
              },
            ],
          }),
        } as Response)
      }
      if (url === '/api/v1/portal/settings/team') {
        return Promise.resolve({ ok: true, json: async () => ({ members: [] }) } as Response)
      }
      if (url.startsWith('/api/v1/crm/saved-views')) {
        return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    })

    render(<PortalContactsPage />)

    const rowLink = await screen.findByRole('link', { name: 'Open contact Raw Owner Contact' })
    const row = rowLink.closest('[data-contact-row]')

    expect(row).not.toBeNull()
    expect(within(row as HTMLElement).getByText('Owner identity missing')).toBeInTheDocument()
    expect(within(row as HTMLElement).queryByText('sales-lead-raw')).not.toBeInTheDocument()
  })

  it('treats an empty stale follow-up lens as a clean relationship health state', async () => {
    mockSearchParams = new URLSearchParams('followUp=stale')
    ;(global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/v1/crm/contacts')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: [
              {
                id: 'contact-fresh',
                name: 'Fresh Followup',
                email: 'fresh@example.com',
                company: 'Fresh Co',
                type: 'lead',
                stage: 'contacted',
                assignedTo: 'sales-lead-1',
                assignedToRef: { uid: 'sales-lead-1', displayName: 'Ava Owner' },
                tags: [],
                lastContactedAt: '2026-05-28T08:00:00.000Z',
              },
            ],
          }),
        } as Response)
      }
      if (url === '/api/v1/portal/settings/team') {
        return Promise.resolve({ ok: true, json: async () => ({ members: [] }) } as Response)
      }
      if (url.startsWith('/api/v1/crm/saved-views')) {
        return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    })

    render(<PortalContactsPage />)

    expect(await screen.findByRole('heading', { name: 'No contacts need follow-up.' })).toBeInTheDocument()
    expect(screen.getByText('Every contact in this view has recent activity.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show all contacts' })).toBeInTheDocument()
  })

  it('opens the new contact drawer directly from CRM create links', async () => {
    mockSearchParams = new URLSearchParams('create=contact')

    render(<PortalContactsPage />)

    expect(await screen.findByRole('heading', { name: 'New contact' })).toBeInTheDocument()
  })

  it('uses an in-page confirmation before bulk deleting selected contacts', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false)

    render(<PortalContactsPage />)

    await screen.findByRole('link', { name: 'Open contact Owned Client' })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Owned Client' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected contacts' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog', { name: 'Delete 1 selected contact?' })).toBeInTheDocument()
    expect(screen.getByText('This cannot be undone. The selected contacts will be removed from this audience.')).toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalledWith('/api/v1/crm/contacts/bulk', expect.any(Object))
    expect(screen.getByRole('button', { name: 'Cancel delete 1 selected contact' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete 1 selected contact' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/contacts/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: ['contact-owned'], patch: { delete: true } }),
      })
    })

    confirmSpy.mockRestore()
  })
})
