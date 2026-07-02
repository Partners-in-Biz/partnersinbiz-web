import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { AdminTwoFactorGate } from '@/components/admin/AdminTwoFactorGate'

const replace = jest.fn()

jest.mock('next/navigation', () => ({
  usePathname: () => '/admin/dashboard',
  useRouter: () => ({ replace }),
}))

jest.mock('@/components/settings/TwoFactorGate', () => ({
  TwoFactorGate: () => <div data-testid="two-factor-gate" />,
}))

describe('AdminTwoFactorGate', () => {
  beforeEach(() => {
    replace.mockClear()
  })

  it('does not redirect to 2FA setup when 2FA is disabled by platform policy', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({ data: { enabled: false, disabledByPolicy: true } }),
    }) as jest.Mock

    render(<AdminTwoFactorGate />)

    expect(await screen.findByTestId('two-factor-gate')).toBeInTheDocument()
    expect(replace).not.toHaveBeenCalled()
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/v1/account/2fa/status', { cache: 'no-store' }))
  })

  it('does not redirect away from admin pages when 2FA is disabled for the account', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({ data: { enabled: false, backupCodesRemaining: 0 } }),
    }) as jest.Mock

    render(<AdminTwoFactorGate />)

    expect(await screen.findByTestId('two-factor-gate')).toBeInTheDocument()
    expect(replace).not.toHaveBeenCalled()
  })
})
