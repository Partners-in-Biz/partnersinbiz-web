import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import DealDetailPage from '@/app/(portal)/portal/deals/[id]/page'

const pushMock = jest.fn()
const refreshMock = jest.fn()
let mockSearchParams = new URLSearchParams()
let mockDealOverrides: Record<string, unknown> = {}
let mockPipelineResponse: unknown = null
type DeferredResponse = {
  promise: Promise<Response>
  resolve: (response: Response) => void
}
let contactLookupDeferred: DeferredResponse | null = null

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'deal-archive-1' }),
  useRouter: () => ({
    push: pushMock,
    refresh: refreshMock,
  }),
  useSearchParams: () => mockSearchParams,
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

jest.mock('@/components/crm/DealDrawer', () => ({
  DealDrawer: () => <div role="dialog" aria-label="Edit Deal" />,
}))

function apiResponse(data: unknown) {
  return Promise.resolve({
    ok: true,
    json: async () => ({ success: true, data }),
  } as Response)
}

describe('Portal deal detail page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSearchParams = new URLSearchParams()
    mockDealOverrides = {}
    mockPipelineResponse = null
    contactLookupDeferred = null
    global.fetch = jest.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const rawPath = String(url)
      const path = rawPath.split('?')[0]
      if (path === '/api/v1/crm/deals/deal-archive-1' && init?.method === 'DELETE') {
        return apiResponse({ archived: true })
      }
      if (path === '/api/v1/crm/deals/deal-archive-1') {
        return apiResponse({
          deal: {
            id: 'deal-archive-1',
            title: 'Enterprise rollout',
            value: 125000,
            currency: 'ZAR',
            pipelineId: 'pipeline-1',
            stageId: 'proposal',
            probability: 70,
            contactId: 'contact-1',
            companyId: 'company-1',
            companyName: 'Acme Board',
            expectedCloseDate: '2026-07-15',
            notes: 'Board-level expansion deal.',
            ownerRef: { uid: 'owner-1', displayName: 'Mandy Manager', kind: 'human' },
            stageHistory: [],
            lineItems: [],
            ...mockDealOverrides,
          },
        })
      }
      if (path === '/api/v1/crm/pipelines/pipeline-1') {
        if (mockPipelineResponse) return apiResponse(mockPipelineResponse)
        return apiResponse({
          id: 'pipeline-1',
          name: 'Growth pipeline',
          stages: [{ id: 'proposal', label: 'Proposal', kind: 'open', order: 1, probability: 70 }],
        })
      }
      if (path === '/api/v1/crm/contacts/contact-1') {
        if (contactLookupDeferred) return contactLookupDeferred.promise
        return apiResponse({ contact: { id: 'contact-1', name: 'Ava Owner', email: 'ava@example.com' } })
      }
      if (path === '/api/v1/crm/activities' && rawPath.includes('contactId=contact-1') && rawPath.includes('limit=20')) {
        return apiResponse({ activities: [] })
      }
      if (path === '/api/v1/portal/settings/team') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ members: [] }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${path}`))
    })
  })

  it('uses an in-page confirmation before archiving a deal', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false)

    render(<DealDetailPage />)

    expect(await screen.findByRole('heading', { name: 'Enterprise rollout' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Archive Enterprise rollout' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(
      await screen.findByRole('alertdialog', { name: 'Archive deal "Enterprise rollout"?' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'This hides the revenue record from active pipeline views while preserving buyer history, activity, and forecast audit context.',
      ),
    ).toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalledWith('/api/v1/crm/deals/deal-archive-1', { method: 'DELETE' })
    expect(screen.getByRole('button', { name: 'Cancel archive Enterprise rollout' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm archive Enterprise rollout' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/deals/deal-archive-1', { method: 'DELETE' })
    })
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/portal/deals'))
    expect(refreshMock).toHaveBeenCalled()

    confirmSpy.mockRestore()
  })

  it('turns next best action cards into deal editing and forecast commands', async () => {
    mockDealOverrides = {
      contactId: '',
      companyId: '',
      companyName: '',
      expectedCloseDate: '',
      lineItems: [],
    }

    render(<DealDetailPage />)

    expect(await screen.findByRole('heading', { name: 'Enterprise rollout' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Link a decision-maker for Enterprise rollout' }))
    expect(screen.getByRole('dialog', { name: 'Edit Deal' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Set close date for Enterprise rollout' }))
    expect(screen.getByLabelText('Set expected close date')).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: 'Add line items for Enterprise rollout' }))
    expect(screen.getByRole('dialog', { name: 'Edit Deal' })).toBeInTheDocument()
  })

  it('preserves CRM company workspace scope across deal detail data, navigation, and activity actions', async () => {
    mockSearchParams = new URLSearchParams({
      orgId: 'org-1',
      orgSlug: 'lumen-speeds',
      sourceCompanyId: 'company-1',
      sourceCompanyName: 'Lumen',
    })

    render(<DealDetailPage />)

    expect(await screen.findByRole('heading', { name: 'Enterprise rollout' })).toBeInTheDocument()

    const scope = 'orgId=org-1&orgSlug=lumen-speeds&sourceCompanyId=company-1&sourceCompanyName=Lumen'
    expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/deals/deal-archive-1?orgId=org-1')
    expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/pipelines/pipeline-1?orgId=org-1')
    expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/contacts/contact-1?orgId=org-1')
    expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/activities?contactId=contact-1&limit=20&orgId=org-1')
    expect(global.fetch).toHaveBeenCalledWith('/api/v1/portal/settings/team?orgId=org-1')

    expect(screen.getByRole('link', { name: /Deals/ }))
      .toHaveAttribute('href', `/portal/deals?${scope}`)
    expect(screen.getByRole('link', { name: /Contact/ }))
      .toHaveAttribute('href', `/portal/contacts/contact-1?${scope}`)
    expect(screen.getByRole('link', { name: /Company/ }))
      .toHaveAttribute('href', `/portal/companies/company-1?${scope}`)
    expect(await screen.findByRole('link', { name: 'Ava Owner' }))
      .toHaveAttribute('href', `/portal/contacts/contact-1?${scope}`)
    expect(screen.getByRole('link', { name: 'Acme Board' }))
      .toHaveAttribute('href', `/portal/companies/company-1?${scope}`)

    fireEvent.click(screen.getByRole('button', { name: 'Log first activity for Enterprise rollout' }))
    expect(pushMock).toHaveBeenCalledWith(`/portal/contacts/contact-1?activity=note&${scope}`)

    fireEvent.click(screen.getByRole('button', { name: 'Archive Enterprise rollout' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm archive Enterprise rollout' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/deals/deal-archive-1?orgId=org-1', { method: 'DELETE' })
    })
    expect(pushMock).toHaveBeenCalledWith(`/portal/deals?${scope}`)
  })

  it('keeps next best action cards readable in the deal side rail', async () => {
    render(<DealDetailPage />)

    expect(await screen.findByRole('heading', { name: 'Enterprise rollout' })).toBeInTheDocument()

    const actionsRegion = screen.getByRole('region', { name: 'Next best actions' })
    const actionCards = within(actionsRegion).getAllByTestId('deal-next-best-action')

    expect(actionCards).toHaveLength(3)
    expect(actionCards[0]).toHaveClass('min-w-0')
    expect(actionCards[0]).not.toHaveClass('sm:flex-row')
    expect(within(actionCards[0]).getByRole('button', { name: 'Open contact for Enterprise rollout' })).toHaveClass('self-start')
  })

  it('resolves nested pipeline API responses into readable detail labels', async () => {
    mockPipelineResponse = {
      pipeline: {
        id: 'pipeline-1',
        name: 'Growth pipeline',
        stages: [{ id: 'proposal', label: 'Proposal', kind: 'open', order: 1, probability: 70 }],
      },
    }

    render(<DealDetailPage />)

    expect(await screen.findByRole('heading', { name: 'Enterprise rollout' })).toBeInTheDocument()
    expect(await screen.findAllByText('Growth pipeline')).toHaveLength(2)
    expect(screen.queryByText('pipeline-1')).not.toBeInTheDocument()
  })

  it('uses pipeline stage labels in stage movement history', async () => {
    mockDealOverrides = {
      stageHistory: [
        {
          pipelineId: 'pipeline-1',
          stageId: 'proposal',
          enteredAt: '2026-06-01T08:00:00.000Z',
          enteredByRef: { uid: 'owner-1', displayName: 'Mandy Manager', kind: 'human' },
        },
      ],
    }

    render(<DealDetailPage />)

    expect(await screen.findByRole('heading', { name: 'Enterprise rollout' })).toBeInTheDocument()
    expect(await screen.findAllByText('Proposal')).toHaveLength(2)
    expect(screen.queryByText('proposal')).not.toBeInTheDocument()
  })

  it('turns command summary tiles into direct deal editing and forecast actions', async () => {
    render(<DealDetailPage />)

    expect(await screen.findByRole('heading', { name: 'Enterprise rollout' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Edit deal value for Enterprise rollout from command summary' }))
    expect(screen.getByRole('dialog', { name: 'Edit Deal' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Update weighted forecast for Enterprise rollout from command summary' }))
    expect(screen.getByLabelText('Update forecast probability')).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: 'Update close timing for Enterprise rollout from command summary' }))
    expect(screen.getByLabelText('Set expected close date')).toHaveFocus()
  })

  it('turns deal detail owner and close date rows into direct cleanup actions', async () => {
    mockDealOverrides = {
      ownerRef: undefined,
      ownerUid: '',
      expectedCloseDate: '',
    }

    render(<DealDetailPage />)

    expect(await screen.findByRole('heading', { name: 'Enterprise rollout' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Assign owner for Enterprise rollout from deal details' }))
    expect(screen.getByLabelText('Assign deal owner')).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: 'Set close date for Enterprise rollout from deal details' }))
    expect(screen.getByLabelText('Set expected close date')).toHaveFocus()
  })

  it('summarizes revenue risk with direct leadership actions', async () => {
    mockDealOverrides = {
      ownerRef: undefined,
      ownerUid: '',
      contactId: '',
      companyId: '',
      companyName: '',
      expectedCloseDate: '',
      lineItems: [],
      probability: 25,
    }

    render(<DealDetailPage />)

    expect(await screen.findByRole('heading', { name: 'Enterprise rollout' })).toBeInTheDocument()

    const brief = screen.getByRole('region', { name: 'Revenue risk brief' })
    expect(within(brief).getByRole('heading', { name: 'Revenue risk brief' })).toBeInTheDocument()
    expect(within(brief).getByText('7 revenue risks need leadership attention before Enterprise rollout is forecast-ready.')).toBeInTheDocument()
    expect(within(brief).getByText('No deal owner')).toBeInTheDocument()
    expect(within(brief).getByText('No decision-maker linked')).toBeInTheDocument()
    expect(within(brief).getByText('No company linked')).toBeInTheDocument()
    expect(within(brief).getByText('Close date missing')).toBeInTheDocument()
    expect(within(brief).getByText('No line items')).toBeInTheDocument()
    expect(within(brief).getByText('No activity logged')).toBeInTheDocument()
    expect(within(brief).getByText('Forecast confidence low')).toBeInTheDocument()

    fireEvent.click(within(brief).getByRole('button', { name: 'Assign owner for Enterprise rollout from revenue risk brief' }))
    expect(screen.getByLabelText('Assign deal owner')).toHaveFocus()

    fireEvent.click(within(brief).getByRole('button', { name: 'Link decision-maker for Enterprise rollout from revenue risk brief' }))
    expect(screen.getByRole('dialog', { name: 'Edit Deal' })).toBeInTheDocument()

    fireEvent.click(within(brief).getByRole('button', { name: 'Link company for Enterprise rollout from revenue risk brief' }))
    expect(screen.getByRole('dialog', { name: 'Edit Deal' })).toBeInTheDocument()

    fireEvent.click(within(brief).getByRole('button', { name: 'Set close date for Enterprise rollout from revenue risk brief' }))
    expect(screen.getByLabelText('Set expected close date')).toHaveFocus()

    fireEvent.click(within(brief).getByRole('button', { name: 'Add line items for Enterprise rollout from revenue risk brief' }))
    expect(screen.getByRole('dialog', { name: 'Edit Deal' })).toBeInTheDocument()

    fireEvent.click(within(brief).getByRole('button', { name: 'Log activity for Enterprise rollout from revenue risk brief' }))
    expect(screen.getByRole('dialog', { name: 'Edit Deal' })).toBeInTheDocument()

    fireEvent.click(within(brief).getByRole('button', { name: 'Update forecast confidence for Enterprise rollout from revenue risk brief' }))
    expect(screen.getByLabelText('Update forecast probability')).toHaveFocus()
  })

  it('shows a resolving contact identity state before secondary contact details finish loading', async () => {
    let resolveContactLookup: DeferredResponse['resolve'] = () => undefined
    contactLookupDeferred = {
      promise: new Promise<Response>((resolve) => {
        resolveContactLookup = resolve
      }),
      resolve: (response) => resolveContactLookup(response),
    }

    render(<DealDetailPage />)

    expect(await screen.findByRole('heading', { name: 'Enterprise rollout' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Resolving contact identity...' })).toHaveAttribute('href', '/portal/contacts/contact-1')
    expect(screen.queryByText('Contact identity missing')).not.toBeInTheDocument()

    contactLookupDeferred.resolve(await apiResponse({ contact: { id: 'contact-1', name: 'Ava Owner', email: 'ava@example.com' } }))

    expect(await screen.findByRole('link', { name: 'Ava Owner' })).toHaveAttribute('href', '/portal/contacts/contact-1')
  })

  it('uses contact-aware activity empty state actions for linked deals', async () => {
    render(<DealDetailPage />)

    expect(await screen.findByRole('heading', { name: 'Enterprise rollout' })).toBeInTheDocument()
    expect(await screen.findByText('Log the first note, call, email, or meeting so every employee can see who owns the conversation and what happened next.')).toBeInTheDocument()
    expect(screen.queryByText('Link a contact before the first note, email, call, or meeting so every employee can see who owns the conversation and what happened next.')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Log first activity for Enterprise rollout' }))

    expect(pushMock).toHaveBeenCalledWith('/portal/contacts/contact-1?activity=note')
  })
})
