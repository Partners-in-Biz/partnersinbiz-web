/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { PixelConfigPanel } from '@/components/ads/PixelConfigPanel'
import type { AdPixelConfig } from '@/lib/ads/types'

const PIXEL_CONFIG: AdPixelConfig = {
  id: 'pxc_1',
  orgId: 'org_1',
  name: 'Main Pixel',
  propertyId: 'prop_1',
  meta: { pixelId: '123456789' },
  eventMappings: [],
  createdBy: 'u1',
  createdAt: null,
  updatedAt: null,
}

beforeEach(() => {
  jest.restoreAllMocks()
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true }),
  }) as unknown as typeof fetch
})

describe('PixelConfigPanel', () => {
  it('confirms pixel config deletes inside the page', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false)

    render(
      <PixelConfigPanel
        orgId="org_1"
        orgSlug="acme"
        initialConfigs={[PIXEL_CONFIG]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Delete pixel config Main Pixel for acme' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
    expect(
      screen.getByRole('alertdialog', { name: 'Delete pixel config Main Pixel for acme?' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('This removes the conversion tracking configuration for this workspace. Existing campaign history stays in PiB.'),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete pixel config Main Pixel for acme' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/ads/pixel-configs/pxc_1', {
        method: 'DELETE',
        headers: { 'X-Org-Id': 'org_1' },
      })
    })

    expect(await screen.findByText('Pixel config Main Pixel deleted.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Pixel config Main Pixel')).not.toBeInTheDocument()
  })
})
