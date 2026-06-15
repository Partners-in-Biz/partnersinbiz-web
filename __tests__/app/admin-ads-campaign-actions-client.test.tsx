/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { AdCampaignAdminActions } from '@/components/ads/AdCampaignAdminActions'

const mockPush = jest.fn()
const mockRefresh = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}))

beforeEach(() => {
  jest.clearAllMocks()
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true }),
  }) as unknown as typeof fetch
})

describe('AdCampaignAdminActions', () => {
  it('shows inline launch failures instead of a native alert', async () => {
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => undefined)
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: false, error: 'Launch blocked by validation' }),
    }) as unknown as typeof fetch

    render(
      <AdCampaignAdminActions
        orgId="org_1"
        orgSlug="acme"
        campaignId="camp_1"
        status="DRAFT"
        reviewState="approved"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Launch campaign camp_1' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Launch blocked by validation')
    expect(alertSpy).not.toHaveBeenCalled()
  })

  it('keeps launch locked until client approval evidence is present', () => {
    render(
      <AdCampaignAdminActions
        orgId="org_1"
        orgSlug="acme"
        campaignId="camp_1"
        status="DRAFT"
      />,
    )

    const launch = screen.getByRole('button', { name: 'Launch campaign camp_1' })
    expect(launch).toBeDisabled()
    expect(screen.getByText(/client approval is recorded/i)).toBeInTheDocument()

    fireEvent.click(launch)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('submits for client review through an in-page confirmation', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockImplementation(() => true)

    render(
      <AdCampaignAdminActions
        orgId="org_1"
        orgSlug="acme"
        campaignId="camp_1"
        status="DRAFT"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Submit campaign camp_1 for client review' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Submit campaign camp_1 for client review?')

    fireEvent.click(screen.getByRole('button', { name: 'Confirm submit campaign camp_1 for client review' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/ads/campaigns/camp_1/submit-for-review', {
        method: 'POST',
        headers: { 'X-Org-Id': 'org_1' },
      })
    })
    expect(mockRefresh).toHaveBeenCalled()
  })

  it('deletes through an in-page confirmation before navigating away', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockImplementation(() => true)

    render(
      <AdCampaignAdminActions
        orgId="org_1"
        orgSlug="acme"
        campaignId="camp_1"
        status="ACTIVE"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Delete campaign camp_1' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Delete campaign camp_1?')

    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete campaign camp_1' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/ads/campaigns/camp_1', {
        method: 'DELETE',
        headers: { 'X-Org-Id': 'org_1' },
      })
    })
    expect(mockPush).toHaveBeenCalledWith('/admin/org/acme/ads/campaigns')
  })
})
