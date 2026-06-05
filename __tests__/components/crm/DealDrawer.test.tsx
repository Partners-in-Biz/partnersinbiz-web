import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DealDrawer } from '@/components/crm/DealDrawer'

let mockPipelinesBody: unknown = null
let mockPipelineDetailBody: unknown = null

jest.mock('@/components/crm/CompanyPicker', () => ({
  CompanyPicker: ({
    ariaLabel,
    currentCompanyName,
    onChange,
  }: {
    ariaLabel?: string
    currentCompanyName?: string
    onChange: (value: { companyId: string | null; companyName: string | null }) => void
  }) => (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={() => onChange({ companyId: 'company-1', companyName: 'Acme Growth' })}
    >
      {currentCompanyName || 'Pick Acme Growth'}
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
    mockPipelinesBody = null
    mockPipelineDetailBody = null
    global.fetch = jest.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url)
      const basePath = path.split('?')[0]
      if (basePath === '/api/v1/crm/pipelines') {
        return Promise.resolve({
          ok: true,
          json: async () => mockPipelinesBody ?? ({
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

      if (basePath === '/api/v1/crm/pipelines/pipeline-1') {
        return Promise.resolve({
          ok: true,
          json: async () => mockPipelineDetailBody ?? ({
            success: true,
            data: {
              pipeline: {
                id: 'pipeline-1',
                name: 'Sales pipeline',
                isDefault: true,
                stages: [{ id: 'stage-1', label: 'Discovery', kind: 'open', order: 1, probability: 25 }],
              },
            },
          }),
        } as Response)
      }

      if (basePath === '/api/v1/crm/deals' && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, data: { id: 'deal-1' } }),
        } as Response)
      }

      if (basePath === '/api/v1/crm/deals/deal-1' && init?.method === 'PUT') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, data: { id: 'deal-1' } }),
        } as Response)
      }

      if (basePath === '/api/v1/crm/contacts') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, data: [] }),
        } as Response)
      }

      if (basePath === '/api/v1/crm/contacts/contact-1') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, data: { id: 'contact-1', name: 'Ava Owner', email: 'ava@example.test' } }),
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

  it('names account-scoped deal creation controls by company and contact context', async () => {
    render(
      <DealDrawer
        defaultContactId="contact-1"
        defaultContactLabel="Ava Owner"
        defaultCompanyId="company-1"
        defaultCompanyName="Acme Growth"
        orgId="org-1"
        onSaved={jest.fn()}
        onClose={jest.fn()}
      />,
    )

    expect(screen.getByRole('dialog', { name: 'Create deal for Acme Growth with Ava Owner' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close deal drawer for Acme Growth' })).toBeInTheDocument()
    expect(screen.getByLabelText('Deal title for Acme Growth')).toBeInTheDocument()
    expect(screen.getByLabelText('Deal contact for Acme Growth')).toHaveValue('Ava Owner')
    expect(screen.getByLabelText('Deal company for Acme Growth')).toBeInTheDocument()
    expect(screen.getByLabelText('Deal value for Acme Growth')).toBeInTheDocument()
    expect(screen.getByLabelText('Deal currency for Acme Growth')).toBeInTheDocument()
    expect(screen.getByLabelText('Expected close date for Acme Growth')).toBeInTheDocument()
    expect(await screen.findByLabelText('Deal pipeline for Acme Growth')).toHaveValue('pipeline-1')
    expect(screen.getByLabelText('Deal stage for Acme Growth')).toHaveValue('stage-1')
    expect(screen.getByLabelText('Deal probability slider for Acme Growth')).toBeInTheDocument()
    expect(screen.getByLabelText('Deal probability percent for Acme Growth')).toBeInTheDocument()
    expect(screen.getByLabelText('Deal notes for Acme Growth')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel deal for Acme Growth' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create deal for Acme Growth' })).toBeInTheDocument()
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

  it('resolves an existing deal pipeline when it is missing from the list response', async () => {
    mockPipelinesBody = { success: true, data: [] }
    mockPipelineDetailBody = {
      success: true,
      data: {
        pipeline: {
          id: 'pipeline-1',
          name: 'Sales pipeline',
          isDefault: true,
          stages: [{ id: 'stage-1', label: 'Discovery', kind: 'open', order: 1, probability: 25 }],
        },
      },
    }

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

    expect(await screen.findByDisplayValue('Sales pipeline')).toBeInTheDocument()
    expect(await screen.findByDisplayValue('Discovery')).toBeInTheDocument()
    expect(screen.getByLabelText('Pipeline')).toHaveValue('pipeline-1')
    expect(screen.getByLabelText('Stage')).toHaveValue('stage-1')
    expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/pipelines/pipeline-1')
  })

  it('lets reps edit expected close dates from the deal drawer', async () => {
    const onSaved = jest.fn()

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
          expectedCloseDate: null,
          notes: '',
          createdAt: null,
          updatedAt: null,
        }}
        defaultContactLabel="Ava Owner"
        orgId="org-1"
        onSaved={onSaved}
        onClose={jest.fn()}
      />,
    )

    await screen.findByDisplayValue('Sales pipeline')
    fireEvent.change(screen.getByLabelText('Expected close date'), {
      target: { value: '2026-06-30' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Save deal changes/i }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('deal-1'))

    const putCall = (global.fetch as jest.Mock).mock.calls.find(([url, init]) => (
      url === '/api/v1/crm/deals/deal-1' && init?.method === 'PUT'
    ))
    expect(JSON.parse(putCall[1].body)).toEqual(expect.objectContaining({
      expectedCloseDate: '2026-06-30',
    }))
  })

  it('resolves the readable contact label when an edit label is missing', async () => {
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

    expect(screen.getByPlaceholderText('Search contacts...')).toHaveValue('Resolving contact identity...')
    expect(screen.queryByDisplayValue('contact-1')).not.toBeInTheDocument()

    await screen.findByDisplayValue('Sales pipeline')

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search contacts...')).toHaveValue('Ava Owner')
    })
    expect(screen.queryByDisplayValue('contact-1')).not.toBeInTheDocument()
  })

  it('turns an empty contact search into an operational contact creation state', async () => {
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

    expect(await screen.findByRole('heading', { name: 'No matching deal contacts' })).toBeInTheDocument()
    expect(screen.getByText('Deal contact required')).toBeInTheDocument()
    expect(screen.getByText('Create or link a contact before this opportunity can carry owner, email, quote, and activity history.')).toBeInTheDocument()

    const contactsLink = screen.getByRole('link', { name: 'Create contact for this deal' })
    expect(contactsLink).toHaveAttribute('href', '/portal/contacts?create=contact')
  })

  it('preserves company workspace scope through deal drawer contact and pipeline operations', async () => {
    const onSaved = jest.fn()

    render(
      <DealDrawer
        defaultContactId="contact-1"
        defaultContactLabel="Ava Owner"
        defaultCompanyId="company-1"
        defaultCompanyName="Acme Growth"
        orgId="lumen-org"
        orgScope={{
          orgId: 'lumen-org',
          orgSlug: 'lumen-speeds',
          sourceCompanyId: 'company-1',
          sourceCompanyName: 'Lumen',
        }}
        onSaved={onSaved}
        onClose={jest.fn()}
      />,
    )

    await screen.findByDisplayValue('Sales pipeline')

    expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/pipelines?orgId=lumen-org')

    fireEvent.change(screen.getByPlaceholderText('Search contacts...'), {
      target: { value: 'No match' },
    })

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/contacts?search=No%20match&limit=8&orgId=lumen-org')
    })
    expect(screen.getByRole('link', { name: 'Create contact for this deal' }))
      .toHaveAttribute(
        'href',
        '/portal/contacts?create=contact&orgId=lumen-org&orgSlug=lumen-speeds&sourceCompanyId=company-1&sourceCompanyName=Lumen',
      )

    fireEvent.change(screen.getByPlaceholderText(/Annual License/i), {
      target: { value: 'Scoped expansion package' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create deal for Acme Growth' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('deal-1'))
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/v1/crm/deals?orgId=lumen-org',
      expect.objectContaining({ method: 'POST' }),
    )
  })
})
