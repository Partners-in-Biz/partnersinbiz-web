import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import DealDetailPage from '@/app/(portal)/portal/deals/[id]/page'

const pushMock = jest.fn()
const refreshMock = jest.fn()

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'deal-archive-1' }),
  useRouter: () => ({
    push: pushMock,
    refresh: refreshMock,
  }),
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

jest.mock('@/components/crm/DealDrawer', () => ({
  DealDrawer: () => <div data-testid="deal-drawer" />,
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
    global.fetch = jest.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url)
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
          },
        })
      }
      if (path === '/api/v1/crm/pipelines/pipeline-1') {
        return apiResponse({
          id: 'pipeline-1',
          name: 'Growth pipeline',
          stages: [{ id: 'proposal', label: 'Proposal', kind: 'open', order: 1, probability: 70 }],
        })
      }
      if (path === '/api/v1/crm/contacts/contact-1') {
        return apiResponse({ contact: { id: 'contact-1', name: 'Ava Owner', email: 'ava@example.com' } })
      }
      if (path === '/api/v1/crm/activities?contactId=contact-1&limit=20') {
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

    fireEvent.click(screen.getByRole('button', { name: 'Confirm archive Enterprise rollout' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/deals/deal-archive-1', { method: 'DELETE' })
    })
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/portal/deals'))
    expect(refreshMock).toHaveBeenCalled()

    confirmSpy.mockRestore()
  })
})
