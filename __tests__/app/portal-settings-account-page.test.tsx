import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import AccountSettingsPage from '@/app/(portal)/portal/settings/account/page'

const mockAuth = {
  currentUser: {
    email: 'hello@partnersinbiz.online',
  },
}
const sendPasswordResetEmailMock = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}))

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

  it('surfaces the read-only login identity for the signed-in user', () => {
    render(<AccountSettingsPage />)

    const loginPanel = screen.getByTestId('account-login-panel')

    expect(loginPanel).toBeInTheDocument()
    expect(within(loginPanel).getByText('Login identity')).toBeInTheDocument()
    expect(within(loginPanel).getByRole('heading', { name: 'Login email' })).toBeInTheDocument()
    expect(within(loginPanel).getByText('hello@partnersinbiz.online')).toBeInTheDocument()
    expect(within(loginPanel).getByText(/Read-only\. Managed by your account provider/)).toBeInTheDocument()
  })

  it('uses shared PiB section and button primitives for credential controls', () => {
    render(<AccountSettingsPage />)

    expect(screen.getByTestId('account-login-panel')).toHaveClass('pib-card-section')
    expect(screen.getByTestId('account-password-panel')).toHaveClass('pib-card-section')
    expect(screen.getByRole('button', { name: 'Send password reset email' })).toHaveClass('border')
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
