import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { IcpProfileEditor } from '@/components/crm/IcpProfileEditor'

describe('IcpProfileEditor', () => {
  it('renders industries input with comma-separated value', () => {
    render(
      <IcpProfileEditor
        value={{ industries: ['SaaS', 'Fintech'] }}
        onChange={jest.fn()}
      />,
    )
    const input = screen.getByPlaceholderText(/e\.g\. SaaS/i)
    expect(input).toHaveValue('SaaS, Fintech')
  })

  it('calls onChange with updated industries array', () => {
    const onChange = jest.fn()
    render(
      <IcpProfileEditor value={{ industries: ['SaaS'] }} onChange={onChange} />,
    )
    const input = screen.getByPlaceholderText(/e\.g\. SaaS/i)
    fireEvent.change(input, { target: { value: 'Healthcare' } })
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ industries: ['Healthcare'] }),
    )
  })

  it('toggles a size button and calls onChange with updated sizes', () => {
    const onChange = jest.fn()
    render(<IcpProfileEditor value={{ sizes: [] }} onChange={onChange} />)
    const btn = screen.getByRole('button', { name: '11-50' })
    fireEvent.click(btn)
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ sizes: ['11-50'] }),
    )
  })

  it('toggles a tier button off and calls onChange with empty tiers', () => {
    const onChange = jest.fn()
    render(<IcpProfileEditor value={{ tiers: ['smb'] }} onChange={onChange} />)
    const btn = screen.getByRole('button', { name: 'smb' })
    fireEvent.click(btn)
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ tiers: [] }),
    )
  })

  it('disables the industries input and size buttons when disabled=true', () => {
    render(
      <IcpProfileEditor
        value={{ industries: ['SaaS'], sizes: [] }}
        onChange={jest.fn()}
        disabled={true}
      />,
    )
    expect(screen.getByPlaceholderText(/e\.g\. SaaS/i)).toBeDisabled()
    expect(screen.getByRole('button', { name: '1-10' })).toBeDisabled()
  })
})
