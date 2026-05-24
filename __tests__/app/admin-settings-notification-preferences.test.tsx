import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import SettingsPage from '@/app/(admin)/admin/settings/page'

jest.mock('@/lib/contexts/OrgContext', () => ({
  useOrg: () => ({
    selectedOrgId: 'pib-platform-owner',
    orgName: 'Partners in Biz',
    orgs: [],
    setOrg: jest.fn(),
    clearOrg: jest.fn(),
    orgId: 'pib-platform-owner',
  }),
}))

jest.mock('@/components/pwa/PushNotificationsToggle', () => ({
  PushNotificationsToggle: () => <div data-testid="push-notifications-toggle">Push notifications device toggle</div>,
}))

describe('SettingsPage admin notification preferences', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/auth/verify') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ uid: 'admin-1', email: 'admin@partnersinbiz.online', role: 'admin', isSuperAdmin: true }),
        } as Response)
      }
      if (url === '/api/v1/organizations') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: [
              { id: 'pib-platform-owner', name: 'Partners in Biz', type: 'platform_owner', status: 'active' },
              { id: 'org-acme', name: 'Acme Client', type: 'client', status: 'active' },
              { id: 'org-beta', name: 'Beta Client', type: 'client', status: 'onboarding' },
            ],
          }),
        } as Response)
      }
      if (url === '/api/v1/admin/notification-preferences?orgId=org-acme' && !init) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { preference: { orgId: 'org-acme', channels: { inApp: true, push: true, email: false } } } }),
        } as Response)
      }
      if (url === '/api/v1/admin/notification-preferences?orgId=org-beta' && !init) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { preference: { orgId: 'org-beta', channels: { inApp: false, push: false, email: true } } } }),
        } as Response)
      }
      if (url === '/api/v1/admin/notification-preferences?orgId=org-acme' && init?.method === 'PATCH') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { preference: { orgId: 'org-acme', channels: { inApp: true, push: true, email: true } } } }),
        } as Response)
      }
      return Promise.resolve({ ok: true, json: async () => ({ data: {} }) } as Response)
    }) as jest.Mock
  })

  it('shows per-client in-app/push and email toggles with saved-state feedback', async () => {
    render(<SettingsPage />)

    await waitFor(() => expect(screen.getByText('Client notification preferences')).toBeInTheDocument())
    expect(await screen.findByText('Acme Client')).toBeInTheDocument()
    expect(screen.getByText('Beta Client')).toBeInTheDocument()
    expect(screen.getByTestId('push-notifications-toggle')).toBeInTheDocument()

    const acmeEmail = await screen.findByRole('switch', { name: 'Email notifications for Acme Client' })
    expect(acmeEmail).not.toBeChecked()

    fireEvent.click(acmeEmail)

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/admin/notification-preferences?orgId=org-acme',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ channels: { inApp: true, push: true, email: true } }),
        }),
      )
    })
    await waitFor(() => expect(screen.getByText('Saved Acme Client preferences')).toBeInTheDocument())
  })
})
