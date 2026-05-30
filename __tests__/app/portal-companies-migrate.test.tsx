import { render, screen } from '@testing-library/react'
import MigrateCompaniesPage, { ExistingCompanyReviewLink } from '@/app/(portal)/portal/companies/migrate/page'

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
})
