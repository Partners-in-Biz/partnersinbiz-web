import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import CompaniesPage from '@/app/(portal)/portal/companies/page'

const mockPush = jest.fn()
const mockReplace = jest.fn()
let mockSearchParams = new URLSearchParams()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useSearchParams: () => mockSearchParams,
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
    mockSearchParams = new URLSearchParams()
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
                  website: 'https://managed.example',
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

  it('counts CRM owner references as account-manager coverage for imported client companies', async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/v1/crm/companies?')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              companies: [
                {
                  id: 'company-imported',
                  orgId: 'org-1',
                  name: 'Imported Client',
                  lifecycleStage: 'customer',
                  ownerUid: 'agent:pip',
                  ownerRef: { uid: 'agent:pip', displayName: 'Pip', kind: 'agent' },
                  tags: ['client-org'],
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

    render(<CompaniesPage />)

    expect(await screen.findByText('Imported Client')).toBeInTheDocument()
    expect(screen.getByText('100%')).toBeInTheDocument()
    expect(screen.getByText('0 unmanaged')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit owner for Imported Client' })).toHaveTextContent('Pip')
    expect(screen.queryByText('Unassigned')).not.toBeInTheDocument()
  })

  it('warns when companies fail to load and gives leaders a retry path', async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/v1/crm/companies?')) {
        return Promise.resolve({
          ok: false,
          json: async () => ({ error: 'Companies index unavailable' }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock

    render(<CompaniesPage />)

    expect(await screen.findByRole('heading', { name: 'Companies could not load' })).toBeInTheDocument()
    expect(screen.getByText('Companies index unavailable')).toBeInTheDocument()
    expect(screen.queryByText('Managed Account')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry loading companies' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2)
    })
  })

  it('names the company creation command without decorative icon text', async () => {
    render(<CompaniesPage />)

    expect(await screen.findByText('Managed Account')).toBeInTheDocument()

    expect(screen.getByRole('link', { name: 'New company' })).toHaveAttribute('href', '/portal/companies/new')
    expect(screen.queryByRole('link', { name: 'add New company' })).not.toBeInTheDocument()
  })

  it('treats an empty unmanaged-company lens as clean account accountability', async () => {
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
              ],
            },
          }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock

    render(<CompaniesPage />)

    expect(await screen.findByText('Managed Account')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show unmanaged companies needing an account manager' }))

    expect(await screen.findByRole('heading', { name: 'No unmanaged companies.' })).toBeInTheDocument()
    expect(screen.getByText('Every visible company already has an account manager.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show all companies' }))

    expect(await screen.findByText('Managed Account')).toBeInTheDocument()
  })

  it('treats an empty filtered company search as a reversible no-results view', async () => {
    mockSearchParams = new URLSearchParams('industry=Healthcare')
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('industry=Healthcare')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { companies: [] } }),
        } as Response)
      }
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
              ],
            },
          }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock

    render(<CompaniesPage />)

    expect(await screen.findByRole('heading', { name: 'No companies match this view.' })).toBeInTheDocument()
    expect(screen.getByText('Clear the filters to return to the full account list.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))

    expect(mockReplace).toHaveBeenCalledWith('/portal/companies', { scroll: false })
    expect(await screen.findByText('Managed Account')).toBeInTheDocument()
  })

  it('routes sparse company rows directly to profile setup', async () => {
    render(<CompaniesPage />)

    await waitFor(() => {
      expect(screen.getByText('Unmanaged Account')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Complete account profile for Unmanaged Account' }))

    expect(mockPush).toHaveBeenCalledWith('/portal/companies/company-unmanaged?edit=profile')
  })

  it('turns missing company revenue into a profile value action', async () => {
    render(<CompaniesPage />)

    await waitFor(() => {
      expect(screen.getByText('Managed Account')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add annual revenue for Managed Account' }))

    expect(mockPush).toHaveBeenCalledWith('/portal/companies/company-managed?edit=profile')
  })

  it('turns company lifecycle chips into profile edit actions', async () => {
    render(<CompaniesPage />)

    await waitFor(() => {
      expect(screen.getByText('Managed Account')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Edit lifecycle for Managed Account' }))

    expect(mockPush).toHaveBeenCalledWith('/portal/companies/company-managed?edit=profile')
  })

  it('turns company owner cells into profile ownership actions', async () => {
    render(<CompaniesPage />)

    await waitFor(() => {
      expect(screen.getByText('Unmanaged Account')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Assign owner for Unmanaged Account' }))

    expect(mockPush).toHaveBeenCalledWith('/portal/companies/company-unmanaged?edit=profile')
  })

  it('turns company health scores into profile cleanup actions', async () => {
    render(<CompaniesPage />)

    await waitFor(() => {
      expect(screen.getByText('Unmanaged Account')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Improve profile health for Unmanaged Account' }))

    expect(mockPush).toHaveBeenCalledWith('/portal/companies/company-unmanaged?edit=profile')
  })

  it('turns company profile cells into profile edit actions', async () => {
    render(<CompaniesPage />)

    await waitFor(() => {
      expect(screen.getByText('Managed Account')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Edit profile for Managed Account' }))

    expect(mockPush).toHaveBeenCalledWith('/portal/companies/company-managed?edit=profile')
  })

  it('turns company row websites into direct website actions', async () => {
    render(<CompaniesPage />)

    await waitFor(() => {
      expect(screen.getByText('Managed Account')).toBeInTheDocument()
    })

    const websiteLink = screen.getByRole('link', { name: 'Open website for Managed Account' })

    expect(websiteLink).toHaveAttribute('href', 'https://managed.example')
    expect(websiteLink).toHaveAttribute('target', '_blank')

    fireEvent.click(websiteLink)

    expect(mockPush).not.toHaveBeenCalled()
  })
})
