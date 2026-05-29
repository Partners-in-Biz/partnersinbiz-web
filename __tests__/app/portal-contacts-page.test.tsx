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
      expect(screen.getByRole('link', { name: /Owned Client/i })).toBeInTheDocument()
    })
    expect(screen.getByRole('link', { name: /Unowned Prospect/i })).toBeInTheDocument()

    expect(screen.getByText('Owner coverage')).toBeInTheDocument()
    expect(screen.getByText('1 unowned')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show unowned contacts needing an owner' }))

    expect(screen.queryByRole('link', { name: /Owned Client/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Unowned Prospect/i })).toBeInTheDocument()

    const row = screen.getByRole('link', { name: /Unowned Prospect/i }).closest('[data-contact-row]')
    expect(row).not.toBeNull()
    expect(within(row as HTMLElement).getByText('Unassigned')).toBeInTheDocument()
  })

  it('opens directly to the unowned-owner lens from CRM reports', async () => {
    mockSearchParams = new URLSearchParams('owner=unowned')

    render(<PortalContactsPage />)

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /Unowned Prospect/i })).toBeInTheDocument()
    })

    expect(screen.queryByRole('link', { name: /Owned Client/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show all contacts' })).toBeInTheDocument()
    expect(screen.getByText('1 unowned contact need assignment.')).toBeInTheDocument()
    expect(screen.getByText('owner: unowned')).toBeInTheDocument()
  })

  it('opens directly to a stage lens from CRM reports', async () => {
    mockSearchParams = new URLSearchParams('stage=new')

    render(<PortalContactsPage />)

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /Unowned Prospect/i })).toBeInTheDocument()
    })

    expect(screen.queryByRole('link', { name: /Owned Client/i })).not.toBeInTheDocument()
    expect(screen.getByText('1 contact match this view.')).toBeInTheDocument()
    expect(screen.getByText('stage: new')).toBeInTheDocument()
  })

  it('opens directly to stale follow-up contacts from CRM reports', async () => {
    mockSearchParams = new URLSearchParams('followUp=stale')

    render(<PortalContactsPage />)

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /Owned Client/i })).toBeInTheDocument()
    })

    expect(screen.getByRole('link', { name: /Unowned Prospect/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Fresh Followup/i })).not.toBeInTheDocument()
    expect(screen.getByText('2 contacts need follow-up.')).toBeInTheDocument()
    expect(screen.getByText('followUp: stale')).toBeInTheDocument()
  })
})
