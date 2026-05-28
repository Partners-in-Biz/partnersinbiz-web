import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  CompaniesBulkCommandBar,
  type CompanyBulkActionKey,
} from '@/components/crm/CompaniesBulkCommandBar'

describe('CompaniesBulkCommandBar', () => {
  it('renders account bulk analytics and emits operation changes', () => {
    const onActionChange = jest.fn()
    const onApply = jest.fn()
    const onClear = jest.fn()

    render(
      <CompaniesBulkCommandBar
        selectedCount={4}
        totalCount={20}
        bulkAction="lifecycleStage"
        bulkPending={false}
        lifecycleStage="customer"
        tier="enterprise"
        size="51-200"
        industry="SaaS"
        tagsInput="priority, retained"
        accountManagerUid="uid-owner"
        onActionChange={onActionChange}
        onLifecycleStageChange={jest.fn()}
        onTierChange={jest.fn()}
        onSizeChange={jest.fn()}
        onIndustryChange={jest.fn()}
        onTagsInputChange={jest.fn()}
        onAccountManagerUidChange={jest.fn()}
        onClear={onClear}
        onApply={onApply}
      />,
    )

    expect(screen.getByText('Account bulk command center')).toBeInTheDocument()
    expect(screen.getByText('4 selected')).toBeInTheDocument()
    expect(screen.getByText('20%')).toBeInTheDocument()
    expect(screen.getAllByText('Lifecycle stage').length).toBeGreaterThan(0)
    expect(screen.getByText('No destructive action in this panel.')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Company bulk action'), {
      target: { value: 'tier' satisfies CompanyBulkActionKey },
    })
    expect(onActionChange).toHaveBeenCalledWith('tier')

    fireEvent.click(screen.getByRole('button', { name: /clear selected companies/i }))
    expect(onClear).toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /apply company bulk updates/i }))
    expect(onApply).toHaveBeenCalled()
  })
})
