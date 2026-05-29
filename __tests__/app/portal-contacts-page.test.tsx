import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import PortalContactsPage from '@/app/(portal)/portal/contacts/page'

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

describe('Portal contacts page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn((input: RequestInfo | URL) => {
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
            ],
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
})
