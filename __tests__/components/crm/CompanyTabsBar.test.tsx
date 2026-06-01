import { fireEvent, render, screen, within } from '@testing-library/react'
import { CompanyTabsBar } from '@/components/crm/CompanyTabsBar'

describe('CompanyTabsBar', () => {
  it('keeps the primary company destinations visible and moves secondary modules into More', () => {
    render(<CompanyTabsBar activeTab="overview" onChange={jest.fn()} counts={{ contacts: 2, documents: 1, analytics: 4 }} />)

    const tablist = screen.getByRole('tablist', { name: 'Company detail tabs' })
    expect(within(tablist).getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
    expect(within(tablist).getByRole('tab', { name: /Contacts/ })).toBeInTheDocument()
    expect(within(tablist).getByRole('tab', { name: /Deals/ })).toBeInTheDocument()
    expect(within(tablist).getByRole('tab', { name: /Projects/ })).toBeInTheDocument()
    expect(within(tablist).getByRole('tab', { name: /Documents/ })).toBeInTheDocument()
    expect(within(tablist).queryByRole('tab', { name: /Analytics/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'More company sections' }))

    const menu = screen.getByRole('menu', { name: 'More company sections' })
    expect(menu.className).toContain('bg-[var(--color-pib-surface)]')
    expect(within(menu).getByText('Commercial')).toBeInTheDocument()
    expect(within(menu).getByText('Delivery')).toBeInTheDocument()
    expect(within(menu).getByText('Relationship')).toBeInTheDocument()
    expect(within(menu).getByText('Insight')).toBeInTheDocument()
    expect(within(menu).getByRole('menuitemradio', { name: /Analytics/ })).toBeInTheDocument()
    expect(within(menu).getByText('4')).toHaveClass('pib-tabs-badge')
  })

  it('pins the active overflow tab into the visible row and still exposes the rest under More', () => {
    render(<CompanyTabsBar activeTab="analytics" onChange={jest.fn()} counts={{ analytics: 4 }} />)

    const tablist = screen.getByRole('tablist', { name: 'Company detail tabs' })
    expect(within(tablist).getByRole('tab', { name: /Analytics/ })).toHaveAttribute('aria-selected', 'true')
    expect(within(tablist).getByText('4')).toHaveClass('pib-tabs-badge')

    fireEvent.click(screen.getByRole('button', { name: 'More company sections' }))

    const menu = screen.getByRole('menu', { name: 'More company sections' })
    expect(within(menu).getByRole('menuitemradio', { name: /Invoices/ })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitemradio', { name: /Activity/ })).toBeInTheDocument()
  })

  it('changes tabs from the visible row and grouped More menu', () => {
    const onChange = jest.fn()
    render(<CompanyTabsBar activeTab="overview" onChange={onChange} />)

    fireEvent.click(screen.getByRole('tab', { name: 'Deals' }))
    fireEvent.click(screen.getByRole('button', { name: 'More company sections' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Invoices' }))

    expect(onChange).toHaveBeenCalledWith('deals')
    expect(onChange).toHaveBeenCalledWith('invoices')
  })
})
