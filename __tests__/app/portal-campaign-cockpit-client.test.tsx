import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CockpitClient } from '@/app/(portal)/portal/campaigns/[id]/cockpit-client'

const refresh = jest.fn()
const replace = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, replace }),
  useSearchParams: () => new URLSearchParams(),
}))

describe('Portal campaign cockpit client', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/campaigns/campaign-1/approve-all' && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true }),
        } as Response)
      }
      if (url === '/api/v1/campaigns/campaign-1/assets') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              blogs: [],
              videos: [],
              social: [],
              meta: { byStatus: { pending_approval: 0 } },
            },
          }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('uses an in-page confirmation and durable feedback when approving all campaign assets', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false)
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => undefined)

    render(
      <CockpitClient
        campaignId="campaign-1"
        campaign={{
          description: 'June campaign for high-value leads',
          research: { taglines: { master: 'Make every lead count' } },
        }}
        assets={{
          blogs: [],
          videos: [],
          social: [],
          meta: { byStatus: { pending_approval: 3 } },
        }}
        brand={undefined}
        orgName="Acme Growth"
        monthLabel="June 2026"
        shareEnabled={false}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Approve all awaiting assets (3)' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(alertSpy).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog', { name: 'Approve 3 campaign assets?' })).toBeInTheDocument()
    expect(
      screen.getByText(
        'This approves every pending asset in the campaign preview and moves the work out of client review for publishing.',
      ),
    ).toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm approve 3 campaign assets' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/campaigns/campaign-1/approve-all', { method: 'POST' })
    })
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('All campaign assets are approved and ready for publishing.')
    })
    expect(refresh).toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog', { name: 'Approve 3 campaign assets?' })).not.toBeInTheDocument()

    confirmSpy.mockRestore()
    alertSpy.mockRestore()
  })
})
