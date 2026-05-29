import { render, screen } from '@testing-library/react'
import { ExistingCompanyReviewLink } from '@/app/(portal)/portal/companies/migrate/page'

describe('portal companies migration review', () => {
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
})
