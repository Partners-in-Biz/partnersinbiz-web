import React from 'react'
import { render, screen } from '@testing-library/react'
import NotificationsPage from '@/app/(portal)/portal/settings/notifications/page'

jest.mock('@/components/pwa/PushNotificationsToggle', () => ({
  PushNotificationsToggle: () => <div data-testid="push-notifications-toggle">Push notifications device toggle</div>,
}))

describe('Portal notifications settings page', () => {
  it('frames notification setup as a CRM readiness command center', () => {
    render(<NotificationsPage />)

    expect(
      screen.getByRole('region', { name: 'CRM notification command center' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Notification command center' })).toBeInTheDocument()
    expect(screen.getByText('4 CRM signals')).toBeInTheDocument()
    expect(screen.getByText('1 device channel')).toBeInTheDocument()
    expect(screen.getByText('Team accountability')).toBeInTheDocument()
    expect(screen.getByTestId('push-notifications-toggle')).toBeInTheDocument()
    expect(screen.getByText('Follow-ups due')).toBeInTheDocument()
    expect(screen.getByText('Approvals waiting')).toBeInTheDocument()
    expect(screen.getByText('Invoices and billing')).toBeInTheDocument()
    expect(screen.getByText('Messages from clients')).toBeInTheDocument()
  })
})
