import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import MigrateCompaniesPage, { ExistingCompanyReviewLink } from '@/app/(portal)/portal/companies/migrate/page'

let mockSearchParams = new URLSearchParams()

jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}))

describe('portal companies migration review', () => {
  const fetchMock = jest.fn()

  beforeAll(() => {
    Object.defineProperty(global, 'fetch', {
      configurable: true,
      value: fetchMock,
    })
  })

  beforeEach(() => {
    fetchMock.mockReset()
    mockSearchParams = new URLSearchParams()
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { matches: [] } }),
    })
  })

  it('labels existing-company actions with the account name being reused', () => {
    render(
      <ExistingCompanyReviewLink
        companyId="company-1"
        companyName="Zenith Group"
      />,
    )

    const link = screen.getByRole('link', { name: /open zenith group/i })
    expect(link).toHaveAttribute('href', '/portal/companies/company-1')
    expect(screen.queryByRole('link', { name: /^view$/i })).not.toBeInTheDocument()
  })

  it('treats an empty migration preview as clean account data with account-governance actions', async () => {
    render(<MigrateCompaniesPage />)

    expect(await screen.findByRole('heading', { name: 'No contact company strings need migration.' })).toBeInTheDocument()
    expect(screen.getByText('Every visible contact company value is already grouped or ready for first-class account work.')).toBeInTheDocument()

    const companyLink = screen.getByRole('link', { name: 'Review companies' })
    expect(companyLink).toHaveAttribute('href', '/portal/companies')

    const contactLink = screen.getByRole('link', { name: 'Review contacts' })
    expect(contactLink).toHaveAttribute('href', '/portal/contacts')

    expect(screen.queryByRole('button', { name: /apply selected/i })).not.toBeInTheDocument()
  })

  it('preserves workspace scope through preview, apply, and migration review links', async () => {
    const scope = 'orgId=org-1&orgSlug=lumen-speeds&sourceCompanyId=source-company&sourceCompanyName=Lumen'
    mockSearchParams = new URLSearchParams(scope)
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/crm/companies/migrate-from-contacts?orgId=org-1' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body))
        if (body.mode === 'preview') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                matches: [
                  {
                    normalizedKey: 'lumen',
                    rawValues: ['Lumen'],
                    contactIds: ['contact-1', 'contact-2'],
                    suggestedCompanyName: 'Lumen',
                    existingCompanyId: 'company-existing',
                  },
                ],
              },
            }),
          } as Response)
        }
        if (body.mode === 'apply') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                summary: { created: 0, linked: 1, failed: 0 },
                results: [
                  {
                    normalizedKey: 'lumen',
                    status: 'linked',
                    companyId: 'company-existing',
                    contactsUpdated: 2,
                  },
                ],
              },
            }),
          } as Response)
        }
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    })

    render(<MigrateCompaniesPage />)

    expect(await screen.findByDisplayValue('Lumen')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/crm/companies/migrate-from-contacts?orgId=org-1', expect.objectContaining({ method: 'POST' }))
    expect(screen.getByRole('link', { name: 'arrow_back Companies' })).toHaveAttribute('href', `/portal/companies?${scope}`)
    expect(screen.getByRole('link', { name: 'Open Lumen' })).toHaveAttribute('href', `/portal/companies/company-existing?${scope}`)

    fireEvent.click(screen.getAllByRole('button', { name: /apply selected/i })[0])

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/crm/companies/migrate-from-contacts?orgId=org-1',
        expect.objectContaining({ method: 'POST', body: expect.stringContaining('"mode":"apply"') }),
      )
    })
    expect(await screen.findByText(/Migration complete/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'company-existing' })).toHaveAttribute('href', `/portal/companies/company-existing?${scope}`)
  })
})
