import { render, screen } from '@testing-library/react'
import AutomationsPage from '@/app/(portal)/portal/settings/automations/page'

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

describe('Portal settings automations page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/crm/automations') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { rules: [] } }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock
  })

  it('turns the empty automation library into a CRM safety-net command center', async () => {
    render(<AutomationsPage />)

    expect(await screen.findByText('Launch your first CRM safety net')).toBeInTheDocument()
    expect(screen.getByText('Trigger')).toBeInTheDocument()
    expect(screen.getByText('Action')).toBeInTheDocument()
    expect(screen.getByText('Owner handoff')).toBeInTheDocument()
    expect(screen.getByText('Audit trail')).toBeInTheDocument()

    expect(screen.getByRole('link', { name: /create the first automation/i })).toHaveAttribute(
      'href',
      '/portal/settings/automations/new',
    )
  })
})
