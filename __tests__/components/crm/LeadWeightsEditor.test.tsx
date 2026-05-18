import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { LeadWeightsEditor } from '@/components/crm/LeadWeightsEditor'

describe('LeadWeightsEditor', () => {
  it('renders all 6 weight inputs', () => {
    render(<LeadWeightsEditor value={{}} onChange={jest.fn()} />)
    expect(screen.getByRole('spinbutton', { name: 'Email opens' })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Email clicks' })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Email replies' })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Sequence completed' })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Recent contact (within 7d)' })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Form submission' })).toBeInTheDocument()
  })

  it('shows default value of 2 for Email opens when field is undefined', () => {
    render(<LeadWeightsEditor value={{}} onChange={jest.fn()} />)
    const input = screen.getByRole('spinbutton', { name: 'Email opens' })
    expect(input).toHaveValue(2)
  })

  it('calls onChange with value clamped to 100 when input exceeds max', () => {
    const onChange = jest.fn()
    render(<LeadWeightsEditor value={{}} onChange={onChange} />)
    const input = screen.getByRole('spinbutton', { name: 'Email opens' })
    fireEvent.change(input, { target: { value: '150' } })
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ emailOpens: 100 }),
    )
  })

  it('disables all inputs when disabled=true', () => {
    render(<LeadWeightsEditor value={{}} onChange={jest.fn()} disabled={true} />)
    expect(screen.getByRole('spinbutton', { name: 'Email opens' })).toBeDisabled()
  })
})
