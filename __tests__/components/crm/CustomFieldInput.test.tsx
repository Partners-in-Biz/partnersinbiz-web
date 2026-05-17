import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { CustomFieldInput } from '@/components/crm/CustomFieldInput'
import type { CustomFieldDefinition } from '@/lib/customFields/types'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeDef(overrides: Partial<CustomFieldDefinition>): CustomFieldDefinition {
  return {
    id: 'def-1',
    orgId: 'org-1',
    resource: 'contact',
    key: 'test_field',
    label: 'Test Field',
    type: 'text',
    required: false,
    order: 0,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CustomFieldInput', () => {
  it('renders a text input for type "text"', () => {
    const onChange = jest.fn()
    render(
      <CustomFieldInput
        definition={makeDef({ type: 'text' })}
        value="hello"
        onChange={onChange}
      />,
    )
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input).toBeInTheDocument()
    expect(input.type).toBe('text')
    expect(input.value).toBe('hello')
  })

  it('renders a number input for type "number"', () => {
    const onChange = jest.fn()
    render(
      <CustomFieldInput
        definition={makeDef({ type: 'number' })}
        value={42}
        onChange={onChange}
      />,
    )
    const input = screen.getByRole('spinbutton') as HTMLInputElement
    expect(input).toBeInTheDocument()
    expect(input.type).toBe('number')
    expect(input.value).toBe('42')
  })

  it('calls onChange with parsed number on number input change', () => {
    const onChange = jest.fn()
    render(
      <CustomFieldInput
        definition={makeDef({ type: 'number' })}
        value={0}
        onChange={onChange}
      />,
    )
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '99' } })
    expect(onChange).toHaveBeenCalledWith(99)
  })

  it('calls onChange with undefined when number input is cleared', () => {
    const onChange = jest.fn()
    render(
      <CustomFieldInput
        definition={makeDef({ type: 'number' })}
        value={5}
        onChange={onChange}
      />,
    )
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '' } })
    expect(onChange).toHaveBeenCalledWith(undefined)
  })

  it('renders a checkbox for type "checkbox"', () => {
    const onChange = jest.fn()
    render(
      <CustomFieldInput
        definition={makeDef({ type: 'checkbox' })}
        value={false}
        onChange={onChange}
      />,
    )
    const cb = screen.getByRole('checkbox') as HTMLInputElement
    expect(cb).toBeInTheDocument()
    expect(cb.checked).toBe(false)
  })

  it('calls onChange with true when checkbox is ticked', () => {
    const onChange = jest.fn()
    render(
      <CustomFieldInput
        definition={makeDef({ type: 'checkbox' })}
        value={false}
        onChange={onChange}
      />,
    )
    fireEvent.click(screen.getByRole('checkbox'))
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('renders a select for type "dropdown" with correct options', () => {
    const onChange = jest.fn()
    render(
      <CustomFieldInput
        definition={makeDef({
          type: 'dropdown',
          options: [
            { value: 'a', label: 'Option A' },
            { value: 'b', label: 'Option B' },
          ],
        })}
        value="a"
        onChange={onChange}
      />,
    )
    expect(screen.getByRole('combobox')).toBeInTheDocument()
    expect(screen.getByText('Option A')).toBeInTheDocument()
    expect(screen.getByText('Option B')).toBeInTheDocument()
  })

  it('renders a date input for type "date"', () => {
    const onChange = jest.fn()
    render(
      <CustomFieldInput
        definition={makeDef({ type: 'date' })}
        value="2026-01-15"
        onChange={onChange}
      />,
    )
    // date inputs don't show in getByRole('textbox') reliably — use container query
    const input = document.querySelector('input[type="date"]') as HTMLInputElement
    expect(input).toBeInTheDocument()
    expect(input.value).toBe('2026-01-15')
  })

  it('renders multi_select chip-toggles and toggles value in array', () => {
    const onChange = jest.fn()
    render(
      <CustomFieldInput
        definition={makeDef({
          type: 'multi_select',
          options: [
            { value: 'x', label: 'X Option' },
            { value: 'y', label: 'Y Option' },
          ],
        })}
        value={['x']}
        onChange={onChange}
      />,
    )
    // 'Y Option' is unselected — clicking it adds it
    fireEvent.click(screen.getByText('Y Option'))
    expect(onChange).toHaveBeenCalledWith(['x', 'y'])
  })

  it('removes a value from multi_select when already-selected chip is clicked', () => {
    const onChange = jest.fn()
    render(
      <CustomFieldInput
        definition={makeDef({
          type: 'multi_select',
          options: [
            { value: 'x', label: 'X Option' },
          ],
        })}
        value={['x']}
        onChange={onChange}
      />,
    )
    fireEvent.click(screen.getByText('X Option'))
    expect(onChange).toHaveBeenCalledWith([])
  })

  it('renders currency inputs with amount and currency code', () => {
    const onChange = jest.fn()
    render(
      <CustomFieldInput
        definition={makeDef({ type: 'currency', currencyCode: 'USD' })}
        value={{ amount: 150, currency: 'USD' }}
        onChange={onChange}
      />,
    )
    expect(screen.getByLabelText('Amount')).toBeInTheDocument()
    expect(screen.getByLabelText('Currency code')).toBeInTheDocument()
  })

  it('updates only currency code when currency input changes', () => {
    const onChange = jest.fn()
    render(
      <CustomFieldInput
        definition={makeDef({ type: 'currency', currencyCode: 'USD' })}
        value={{ amount: 100, currency: 'USD' }}
        onChange={onChange}
      />,
    )
    fireEvent.change(screen.getByLabelText('Currency code'), { target: { value: 'zar' } })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ currency: 'ZAR', amount: 100 }))
  })

  it('shows help text below the input', () => {
    render(
      <CustomFieldInput
        definition={makeDef({ type: 'text', helpText: 'Enter your full name' })}
        value=""
        onChange={jest.fn()}
      />,
    )
    expect(screen.getByText('Enter your full name')).toBeInTheDocument()
  })

  it('disables the input when disabled prop is set', () => {
    render(
      <CustomFieldInput
        definition={makeDef({ type: 'text' })}
        value="val"
        onChange={jest.fn()}
        disabled
      />,
    )
    expect(screen.getByRole('textbox')).toBeDisabled()
  })
})
