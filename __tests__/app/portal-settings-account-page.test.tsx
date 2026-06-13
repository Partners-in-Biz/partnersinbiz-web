import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import AccountSettingsPage from '@/app/(portal)/portal/settings/account/page'

const mockAuth = {
  currentUser: {
    email: 'hello@partnersinbiz.online',
  },
}
const sendPasswordResetEmailMock = jest.fn()

jest.mock('@/lib/firebase/config', () => ({
  getClientAuth: () => mockAuth,
}))

jest.mock('firebase/auth', () => ({
  sendPasswordResetEmail: (...args: unknown[]) => sendPasswordResetEmailMock(...args),
}))

describe('Portal account settings page', () => {
  beforeEach(() => {
    sendPasswordResetEmailMock.mockReset()
  })

  it('summarizes account security readiness before credential controls', () => {
    render(<AccountSettingsPage />)

    const commandCenter = screen.getByRole('region', { name: 'Account security command center' })

    expect(commandCenter).toBeInTheDocument()
    expect(within(commandCenter).getByRole('heading', { name: 'Account security command center' })).toBeInTheDocument()
    expect(within(commandCenter).getByText('Login verified')).toBeInTheDocument()
    expect(within(commandCenter).getByText('Password recovery ready')).toBeInTheDocument()
    expect(within(commandCenter).getAllByText('Workspace independent')).toHaveLength(2)
    expect(within(commandCenter).getByText(/hello@partnersinbiz\.online/)).toBeInTheDocument()
    expect(within(commandCenter).getByTestId('account-readiness-login-email')).toHaveClass('pib-stat-card')
    expect(within(commandCenter).getByTestId('account-readiness-recovery')).toHaveClass('pib-stat-card')
    expect(within(commandCenter).getByTestId('account-readiness-scope')).toHaveClass('pib-stat-card')
  })

  it('uses shared PiB section and button primitives for credential controls', () => {
    render(<AccountSettingsPage />)

    expect(screen.getByTestId('account-login-panel')).toHaveClass('pib-card-section')
    expect(screen.getByTestId('account-password-panel')).toHaveClass('pib-card-section')
    expect(screen.getByRole('button', { name: 'Send password reset email' })).toHaveClass('pib-btn-primary')
  })

  it('sends password reset email through Firebase auth', async () => {
    sendPasswordResetEmailMock.mockResolvedValue(undefined)

    render(<AccountSettingsPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Send password reset email' }))

    await waitFor(() => {
      expect(sendPasswordResetEmailMock).toHaveBeenCalledWith(mockAuth, 'hello@partnersinbiz.online')
    })
    expect(await screen.findByText('Password reset email sent to hello@partnersinbiz.online.')).toBeInTheDocument()
  })
})
