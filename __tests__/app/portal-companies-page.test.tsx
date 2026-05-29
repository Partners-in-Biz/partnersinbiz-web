import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import CompaniesPage from '@/app/(portal)/portal/companies/page'

const mockPush = jest.fn()
const mockReplace = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

describe('Portal companies page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/v1/crm/companies?')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              companies: [
                {
                  id: 'company-managed',
                  orgId: 'org-1',
                  name: 'Managed Account',
                  industry: 'SaaS',
                  lifecycleStage: 'customer',
                  accountManagerUid: 'uid-1',
                  accountManagerRef: { uid: 'uid-1', displayName: 'Ava Owner' },
                  tags: [],
                  notes: 'Managed relationship',
                  createdAt: null,
                  updatedAt: null,
                },
                {
                  id: 'company-unmanaged',
                  orgId: 'org-1',
                  name: 'Unmanaged Account',
                  industry: 'Retail',
                  lifecycleStage: 'prospect',
                  tags: [],
                  notes: '',
                  createdAt: null,
                  updatedAt: null,
                },
              ],
            },
          }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock
  })

  it('surfaces unmanaged accounts as a company accountability lens', async () => {
    render(<CompaniesPage />)

    await waitFor(() => {
      expect(screen.getByText('Managed Account')).toBeInTheDocument()
    })
    expect(screen.getByText('Unmanaged Account')).toBeInTheDocument()

    expect(screen.getByText('Manager coverage')).toBeInTheDocument()
    expect(screen.getByText('1 unmanaged')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show unmanaged companies needing an account manager' }))

    expect(screen.queryByText('Managed Account')).not.toBeInTheDocument()
    expect(screen.getByText('Unmanaged Account')).toBeInTheDocument()
    expect(screen.getByText('Unassigned')).toBeInTheDocument()
  })

  it('routes sparse company rows directly to profile setup', async () => {
    render(<CompaniesPage />)

    await waitFor(() => {
      expect(screen.getByText('Unmanaged Account')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Complete account profile for Unmanaged Account' }))

    expect(mockPush).toHaveBeenCalledWith('/portal/companies/company-unmanaged?edit=profile')
  })
})
