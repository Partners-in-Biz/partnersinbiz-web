import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MobileAppsPortalWorkspace } from '@/components/mobile-apps/MobileAppsPortalWorkspace'

describe('MobileAppsPortalWorkspace profile/account linking', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('shows an obvious empty-state action for linking the first mobile app profile/account', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { apps: [] } }),
    } as Response)

    render(<MobileAppsPortalWorkspace />)

    expect(await screen.findByText('No mobile app profile yet')).toBeInTheDocument()
    expect(screen.getByText('Connect or link a profile/account')).toBeInTheDocument()
    expect(screen.getByText(/Link an App Store Connect, Google Play, analytics, or support profile/)).toBeInTheDocument()
  })

  it('creates a first app placeholder and persists the linked profile through the org-scoped portal API', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { apps: [] } }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: 'app-new', created: true } }) } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { apps: [{ id: 'app-new', name: 'Client Android App', platform: 'android', status: 'planned', visibility: { showInClientPortal: true }, profileLinks: [{ id: 'link-1', label: 'Google Play developer account', type: 'developer_account', status: 'linked' }] }] } }),
      } as Response)
    global.fetch = fetchMock

    render(<MobileAppsPortalWorkspace />)

    fireEvent.click(await screen.findByText('Connect or link a profile/account'))
    fireEvent.change(screen.getByLabelText('App name'), { target: { value: 'Client Android App' } })
    fireEvent.change(screen.getByLabelText('Profile/account name'), { target: { value: 'Google Play developer account' } })
    fireEvent.change(screen.getByLabelText('Account/profile ID'), { target: { value: 'dev-123' } })
    fireEvent.click(screen.getByText('Save linked profile'))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/portal/mobile-apps', expect.objectContaining({ method: 'POST' }))
    })
    const [, request] = fetchMock.mock.calls[1]
    expect(JSON.parse(request.body)).toMatchObject({
      appName: 'Client Android App',
      platform: 'android',
      profileLink: {
        label: 'Google Play developer account',
        type: 'developer_account',
        accountId: 'dev-123',
      },
    })
    expect(await screen.findByText('Mobile app profile linked for PiB review.')).toBeInTheDocument()
    expect(await screen.findByText('Google Play developer account')).toBeInTheDocument()
  })
})
