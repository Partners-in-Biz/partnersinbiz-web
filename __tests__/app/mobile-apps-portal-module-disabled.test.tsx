import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { MobileAppsPortalWorkspace } from '@/components/mobile-apps/MobileAppsPortalWorkspace'

describe('MobileAppsPortalWorkspace module availability', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({
        success: false,
        error: 'Mobile Apps module is disabled for this client portal',
        moduleDisabled: true,
        module: 'mobileApps',
      }),
    } as Response)
  })

  it('shows a disabled-module message instead of an empty app list', async () => {
    render(<MobileAppsPortalWorkspace />)

    await waitFor(() => {
      expect(screen.getByText('Mobile Apps is not enabled for this portal.')).toBeInTheDocument()
    })
    expect(screen.queryByText('No mobile app profile yet')).not.toBeInTheDocument()
  })
})
