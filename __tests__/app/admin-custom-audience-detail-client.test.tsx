/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { CustomAudienceDetailClient } from '@/app/(admin)/admin/org/[slug]/ads/audiences/[id]/CustomAudienceDetailClient'

const push = jest.fn()
const refresh = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
}))

beforeEach(() => {
  jest.restoreAllMocks()
  push.mockClear()
  refresh.mockClear()
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true }),
  }) as unknown as typeof fetch
})

describe('CustomAudienceDetailClient', () => {
  it('confirms custom audience deletes inside the page', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false)

    render(
      <CustomAudienceDetailClient
        orgId="org_1"
        orgSlug="acme"
        caId="ca_1"
        currentStatus="ready"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Delete custom audience ca_1 for acme' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
    expect(
      screen.getByRole('alertdialog', { name: 'Delete custom audience ca_1 for acme?' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('This removes the audience from PiB and requests best-effort removal from connected ad platforms. Campaign history stays in PiB.'),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete custom audience ca_1 for acme' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/ads/custom-audiences/ca_1', {
        method: 'DELETE',
        headers: { 'X-Org-Id': 'org_1' },
      })
    })
    expect(push).toHaveBeenCalledWith('/admin/org/acme/ads/audiences')
  })
})
