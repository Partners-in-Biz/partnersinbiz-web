import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DealDrawer } from '@/components/crm/DealDrawer'

jest.mock('@/components/crm/CompanyPicker', () => ({
  CompanyPicker: ({ onChange }: { onChange: (value: { companyId: string | null; companyName: string | null }) => void }) => (
    <button
      type="button"
      onClick={() => onChange({ companyId: 'company-1', companyName: 'Acme Growth' })}
    >
      Pick Acme Growth
    </button>
  ),
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

describe('DealDrawer', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url)
      if (path === '/api/v1/crm/pipelines') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: [
              {
                id: 'pipeline-1',
                name: 'Sales pipeline',
                isDefault: true,
                stages: [{ id: 'stage-1', label: 'Discovery', kind: 'open', order: 1, probability: 25 }],
              },
            ],
          }),
        } as Response)
      }

      if (path === '/api/v1/crm/deals' && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, data: { id: 'deal-1' } }),
        } as Response)
      }

      if (path.startsWith('/api/v1/crm/contacts?')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, data: [] }),
        } as Response)
      }

      return Promise.reject(new Error(`Unexpected fetch: ${path}`))
    })
  })

  it('sends the selected company name with the deal payload', async () => {
    const onSaved = jest.fn()

    render(
      <DealDrawer
        defaultContactId="contact-1"
        orgId="org-1"
        onSaved={onSaved}
        onClose={jest.fn()}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText(/Annual License/i), {
      target: { value: 'Acme annual growth package' },
    })
    fireEvent.click(await screen.findByText('Pick Acme Growth'))
    fireEvent.click(screen.getByRole('button', { name: /Create deal/i }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('deal-1'))

    const postCall = (global.fetch as jest.Mock).mock.calls.find(([url, init]) => (
      url === '/api/v1/crm/deals' && init?.method === 'POST'
    ))
    expect(JSON.parse(postCall[1].body)).toEqual(expect.objectContaining({
      companyId: 'company-1',
      companyName: 'Acme Growth',
    }))
  })

  it('sends default company context with account-scoped deal creation', async () => {
    const onSaved = jest.fn()

    render(
      <DealDrawer
        defaultContactId="contact-1"
        defaultContactLabel="Ava Owner"
        defaultCompanyId="company-1"
        defaultCompanyName="Acme Growth"
        orgId="org-1"
        onSaved={onSaved}
        onClose={jest.fn()}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText(/Annual License/i), {
      target: { value: 'Acme expansion package' },
    })
    await screen.findByDisplayValue('Sales pipeline')
    await screen.findByDisplayValue('Discovery')
    fireEvent.click(screen.getByRole('button', { name: /Create deal/i }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('deal-1'))

    const postCall = (global.fetch as jest.Mock).mock.calls.find(([url, init]) => (
      url === '/api/v1/crm/deals' && init?.method === 'POST'
    ))
    expect(JSON.parse(postCall[1].body)).toEqual(expect.objectContaining({
      contactId: 'contact-1',
      companyId: 'company-1',
      companyName: 'Acme Growth',
    }))
  })

  it('shows the readable default contact label for preselected contact deals', async () => {
    render(
      <DealDrawer
        defaultContactId="contact-1"
        defaultContactLabel="Ava Owner"
        orgId="org-1"
        onSaved={jest.fn()}
        onClose={jest.fn()}
      />,
    )

    await screen.findByDisplayValue('Sales pipeline')

    expect(screen.getByPlaceholderText('Search contacts...')).toHaveValue('Ava Owner')
  })

  it('shows the readable contact label when editing an existing deal', async () => {
    render(
      <DealDrawer
        deal={{
          id: 'deal-1',
          orgId: 'org-1',
          title: 'Growth retainer',
          contactId: 'contact-1',
          pipelineId: 'pipeline-1',
          stageId: 'stage-1',
          value: 50000,
          currency: 'ZAR',
        }}
        defaultContactLabel="Ava Owner"
        orgId="org-1"
        onSaved={jest.fn()}
        onClose={jest.fn()}
      />,
    )

    await screen.findByDisplayValue('Sales pipeline')

    expect(screen.getByPlaceholderText('Search contacts...')).toHaveValue('Ava Owner')
  })

  it('falls back to the existing contact id when an edit label is blank', async () => {
    render(
      <DealDrawer
        deal={{
          id: 'deal-1',
          orgId: 'org-1',
          title: 'Growth retainer',
          contactId: 'contact-1',
          pipelineId: 'pipeline-1',
          stageId: 'stage-1',
          value: 50000,
          currency: 'ZAR',
        }}
        defaultContactLabel=""
        orgId="org-1"
        onSaved={jest.fn()}
        onClose={jest.fn()}
      />,
    )

    await screen.findByDisplayValue('Sales pipeline')

    expect(screen.getByPlaceholderText('Search contacts...')).toHaveValue('contact-1')
  })

  it('turns an empty contact search into a contacts workspace action', async () => {
    render(
      <DealDrawer
        orgId="org-1"
        onSaved={jest.fn()}
        onClose={jest.fn()}
      />,
    )

    await screen.findByDisplayValue('Sales pipeline')
    fireEvent.change(screen.getByPlaceholderText('Search contacts...'), {
      target: { value: 'No match' },
    })

    expect(await screen.findByText('No contacts found.')).toBeInTheDocument()

    const contactsLink = screen.getByRole('link', { name: 'Open contacts to create a deal contact' })
    expect(contactsLink).toHaveAttribute('href', '/portal/contacts')
  })
})
