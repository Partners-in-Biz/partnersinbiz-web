import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import PortalEmailDomainsPage from '@/app/(portal)/portal/email-domains/page'
import type { EmailDomain } from '@/lib/email/domains'

const domain: EmailDomain = {
  id: 'domain-1',
  orgId: 'org-1',
  name: 'growth.example.com',
  resendDomainId: 'resend-domain-1',
  status: 'pending',
  region: 'eu-west-1',
  dnsRecords: [
    {
      record: 'TXT',
      name: '_spf.growth.example.com',
      type: 'SPF',
      value: 'v=spf1 include:amazonses.com ~all',
      status: 'pending',
    },
  ],
  createdAt: null,
  updatedAt: null,
  lastSyncedAt: null,
}

describe('Portal email domains page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/email/domains') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: [domain] }),
        } as Response)
      }
      if (url === '/api/v1/email/domains/domain-1' && init?.method === 'DELETE') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('uses an in-page confirmation before removing a sender domain', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false)

    render(<PortalEmailDomainsPage />)

    expect(await screen.findByText('growth.example.com')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Delete sender domain growth.example.com' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog', { name: 'Remove sender domain "growth.example.com"?' })).toBeInTheDocument()
    expect(
      screen.getByText(
        'This removes branded sending for campaigns and unverifies the domain in Resend. Existing campaign history stays available for audit.',
      ),
    ).toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalledWith('/api/v1/email/domains/domain-1', expect.any(Object))

    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove sender domain growth.example.com' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/email/domains/domain-1', { method: 'DELETE' })
    })
    expect(screen.queryByText('growth.example.com')).not.toBeInTheDocument()

    confirmSpy.mockRestore()
  })
})
