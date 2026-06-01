import { fireEvent, render, screen } from '@testing-library/react'
import { AutomationRuleForm } from '@/components/crm/AutomationRuleForm'

describe('AutomationRuleForm', () => {
  it('names every primary automation builder control with CRM language', () => {
    render(<AutomationRuleForm onSave={jest.fn()} onCancel={jest.fn()} />)

    expect(screen.getByRole('textbox', { name: 'Name the business outcome' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Choose the CRM moment' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Immediately' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'After delay' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Enabled' })).toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: 'Add action' }))

    expect(screen.getByRole('combobox', { name: 'Action 1 type' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Action 1 notification recipient' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Action 1 notification message' })).toBeInTheDocument()
  })
})
