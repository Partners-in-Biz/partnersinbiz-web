import { fireEvent, render, screen } from '@testing-library/react'
import { CompanyHeader } from '@/components/crm/CompanyHeader'
import type { Company } from '@/lib/companies/types'

function company(overrides: Partial<Company> = {}): Company {
  return {
    id: 'company-1',
    orgId: 'org-1',
    name: 'Acme Studio',
    tags: [],
    notes: '',
    createdAt: null,
    updatedAt: null,
    ...overrides,
  }
}

describe('CompanyHeader', () => {
  it('turns missing domain and industry into company profile actions', () => {
    const onEdit = jest.fn()

    render(<CompanyHeader company={company()} onEdit={onEdit} />)

    expect(screen.getByText(/No domain captured/)).toBeInTheDocument()
    expect(screen.getByText(/Industry not set/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add domain for Acme Studio' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add industry for Acme Studio' }))

    expect(onEdit).toHaveBeenCalledTimes(2)
  })

  it('turns missing company size into a profile action', () => {
    const onEdit = jest.fn()

    render(<CompanyHeader company={company()} onEdit={onEdit} />)

    expect(screen.getByText(/No size data/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add company size for Acme Studio' }))

    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  it('keeps captured identity fields as read-only signals without setup prompts', () => {
    render(
      <CompanyHeader
        company={company({
          domain: 'acme.example',
          industry: 'Creative services',
          employeeCount: 24,
        })}
        onEdit={jest.fn()}
      />,
    )

    expect(screen.getByText(/acme\.example/)).toBeInTheDocument()
    expect(screen.getByText(/Creative services/)).toBeInTheDocument()
    expect(screen.getByText(/24 people/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Add domain/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Add industry/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Add company size/i })).not.toBeInTheDocument()
  })
})
