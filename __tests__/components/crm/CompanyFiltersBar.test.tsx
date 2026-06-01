import { render, screen, fireEvent } from '@testing-library/react'
import { CompanyFiltersBar } from '@/components/crm/CompanyFiltersBar'

describe('CompanyFiltersBar', () => {
  it('renders selected tier and lifecycle filters as readable account labels', () => {
    render(
      <CompanyFiltersBar
        value={{ orgId: 'org-1', tier: 'mid-market', lifecycleStage: 'customer' }}
        onChange={jest.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: /Tier: Mid market/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Lifecycle: Customer/i })).toBeInTheDocument()
    expect(screen.queryByText(/mid-market/)).not.toBeInTheDocument()
    expect(screen.queryByText(/customer/)).not.toBeInTheDocument()
  })

  it('renders tier and lifecycle dropdown choices as readable account labels while keeping saved values', () => {
    const handleChange = jest.fn()

    render(
      <CompanyFiltersBar
        value={{ orgId: 'org-1' }}
        onChange={handleChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Tier' }))
    expect(screen.getByRole('button', { name: 'Mid market' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Mid market' }))
    expect(handleChange).toHaveBeenCalledWith({ orgId: 'org-1', tier: 'mid-market' })

    fireEvent.click(screen.getByRole('button', { name: 'Lifecycle' }))
    expect(screen.getByRole('button', { name: 'Customer' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Customer' }))
    expect(handleChange).toHaveBeenCalledWith({ orgId: 'org-1', lifecycleStage: 'customer' })
  })
})
