import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BulkApproveButton } from '@/app/(portal)/portal/ads/BulkApproveButton'

const refresh = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}))

describe('Portal ads bulk approval button', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/v1/portal/ads/campaigns/bulk-approve' && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              approved: [{ id: 'campaign-1' }, { id: 'campaign-2' }],
              failed: [{ id: 'campaign-3', error: 'Missing creative approval' }],
            },
          }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${String(input)}`))
    }) as jest.Mock
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('uses in-page confirmation and feedback for bulk campaign approvals', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false)
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => undefined)

    render(<BulkApproveButton count={3} />)

    fireEvent.click(screen.getByRole('button', { name: 'Approve all pending campaigns (3)' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(alertSpy).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog', { name: 'Approve 3 pending campaigns?' })).toBeInTheDocument()
    expect(
      screen.getByText('This marks every pending campaign as approved and ready for launch. Review owners will see the refreshed approval state after this action.'),
    ).toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm approve 3 pending campaigns' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/portal/ads/campaigns/bulk-approve', { method: 'POST' })
    })
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Approved 2 campaigns. 1 campaign needs follow-up: campaign-3: Missing creative approval')
    })
    expect(alertSpy).not.toHaveBeenCalled()
    expect(refresh).toHaveBeenCalled()

    confirmSpy.mockRestore()
    alertSpy.mockRestore()
  })
})
