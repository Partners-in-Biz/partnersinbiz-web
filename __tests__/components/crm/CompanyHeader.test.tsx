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
  it('names first-viewport account commands without decorative icon text', () => {
    const onEdit = jest.fn()
    const onDelete = jest.fn()

    render(
      <CompanyHeader
        company={company({
          website: 'acme.example',
          billingEmail: 'billing@acme.example',
          phone: '+27110001111',
        })}
        onEdit={onEdit}
        onDelete={onDelete}
      />,
    )

    expect(screen.getByRole('link', { name: 'Open website for Acme Studio' })).toHaveAttribute('href', 'https://acme.example')
    expect(screen.getByRole('link', { name: 'Email billing contact for Acme Studio' })).toHaveAttribute('href', 'mailto:billing@acme.example')
    expect(screen.getByRole('link', { name: 'Call Acme Studio' })).toHaveAttribute('href', 'tel:+27110001111')

    fireEvent.click(screen.getByRole('button', { name: 'Edit account profile for Acme Studio' }))
    fireEvent.click(screen.getByRole('button', { name: 'Archive account Acme Studio' }))

    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('link', { name: /open_in_new/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^edit Edit$/i })).not.toBeInTheDocument()
  })

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

  it('turns a missing account manager into an ownership assignment action', () => {
    const onEdit = jest.fn()

    render(
      <CompanyHeader
        company={company({
          domain: 'acme.example',
          industry: 'Creative services',
          employeeCount: 24,
        })}
        onEdit={onEdit}
      />,
    )

    expect(screen.getByText('Account owner missing')).toBeInTheDocument()
    expect(screen.getByText('Assign account ownership')).toBeInTheDocument()
    expect(
      screen.getByText(
        'No team member owns this account yet. Assign a manager so renewals, escalations, and delivery handoffs stay visible to leadership.',
      ),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Assign account manager for Acme Studio' }))

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

  it('renders lifecycle and tier chips as readable account labels', () => {
    render(
      <CompanyHeader
        company={company({
          lifecycleStage: 'customer',
          tier: 'mid-market',
        })}
        onEdit={jest.fn()}
      />,
    )

    expect(screen.getByText('Customer')).toBeInTheDocument()
    expect(screen.getByText('Mid market')).toBeInTheDocument()
    expect(screen.queryByText('customer')).not.toBeInTheDocument()
    expect(screen.queryByText('mid-market')).not.toBeInTheDocument()
  })

  it('turns captured lifecycle and tier chips into profile edit actions', () => {
    const onEdit = jest.fn()

    render(
      <CompanyHeader
        company={company({
          lifecycleStage: 'customer',
          tier: 'mid-market',
        })}
        onEdit={onEdit}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit lifecycle stage Customer for Acme Studio' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit account tier Mid market for Acme Studio' }))

    expect(onEdit).toHaveBeenCalledTimes(2)
  })
})
