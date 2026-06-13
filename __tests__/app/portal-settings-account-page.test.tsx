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

  it('summarizes account access readiness before credential controls', () => {
    render(<AccountSettingsPage />)

    const accountOverview = screen.getByRole('region', { name: 'Account access overview' })

    expect(accountOverview).toBeInTheDocument()
    expect(within(accountOverview).getByRole('heading', { name: 'Account access overview' })).toBeInTheDocument()
    expect(within(accountOverview).getByText('hello@partnersinbiz.online')).toBeInTheDocument()
    expect(within(accountOverview).getByText('Password recovery ready')).toBeInTheDocument()
    expect(within(accountOverview).getAllByText('Workspace independent')).toHaveLength(2)
    expect(within(accountOverview).getAllByText('Ready')).toHaveLength(2)
    expect(within(accountOverview).getByTestId('account-readiness-login-email')).toHaveClass('pib-card-section-row')
    expect(within(accountOverview).getByTestId('account-readiness-recovery')).toHaveClass('pib-card-section-row')
    expect(within(accountOverview).getByTestId('account-readiness-scope')).toHaveClass('pib-card-section-row')
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
