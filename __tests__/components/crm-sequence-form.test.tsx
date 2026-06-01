import { render, screen } from '@testing-library/react'
import { SequenceForm } from '@/components/crm/SequenceForm'

describe('SequenceForm', () => {
  it('names the sequence builder controls and first journey step actions', () => {
    render(<SequenceForm onSave={jest.fn()} onCancel={jest.fn()} />)

    expect(screen.getByRole('textbox', { name: 'Sequence name' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Sequence description' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Sequence status' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Move step 1 up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move step 1 down' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remove step 1' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Step 1 channel' })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Step 1 send delay in days' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Step 1 email subject' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Step 1 email body' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add step' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create sequence' })).toBeInTheDocument()
  })
})
