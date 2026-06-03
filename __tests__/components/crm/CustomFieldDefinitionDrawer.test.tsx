import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CustomFieldDefinitionDrawer } from '@/components/crm/CustomFieldDefinitionDrawer'
import type { CustomFieldDefinition } from '@/lib/customFields/types'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeDef(overrides: Partial<CustomFieldDefinition> = {}): Partial<CustomFieldDefinition> {
  return {
    id: 'def-1',
    orgId: 'org-1',
    resource: 'contact',
    key: 'my_field',
    label: 'My Field',
    type: 'text',
    required: false,
    order: 0,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CustomFieldDefinitionDrawer', () => {
  const noopClose = jest.fn()
  const noopSave = jest.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders all 12 type options in the type select', () => {
    render(
      <CustomFieldDefinitionDrawer
        mode="create"
        resource="contact"
        open
        onSave={noopSave}
        onClose={noopClose}
      />,
    )
    const select = screen.getByLabelText(/Field type/i) as HTMLSelectElement
    const optionTexts = Array.from(select.options).map((o) => o.text)
    const expectedTypes = ['Text', 'Long Text', 'Number', 'Currency', 'Date', 'Date & Time', 'Dropdown', 'Multi-select', 'Checkbox', 'URL', 'Email', 'Phone']
    for (const label of expectedTypes) {
      expect(optionTexts).toContain(label)
    }
    expect(optionTexts.length).toBe(12)
  })

  it('disables the type select in edit mode', () => {
    render(
      <CustomFieldDefinitionDrawer
        definition={makeDef()}
        mode="edit"
        resource="contact"
        open
        onSave={noopSave}
        onClose={noopClose}
      />,
    )
    const select = screen.getByLabelText(/Field type/i) as HTMLSelectElement
    expect(select).toBeDisabled()
  })

  it('type select is NOT disabled in create mode', () => {
    render(
      <CustomFieldDefinitionDrawer
        mode="create"
        resource="contact"
        open
        onSave={noopSave}
        onClose={noopClose}
      />,
    )
    const select = screen.getByLabelText(/Field type/i) as HTMLSelectElement
    expect(select).not.toBeDisabled()
  })

  it('shows options editor when type is switched to dropdown', async () => {
    render(
      <CustomFieldDefinitionDrawer
        mode="create"
        resource="contact"
        open
        onSave={noopSave}
        onClose={noopClose}
      />,
    )
    const typeSelect = screen.getByLabelText(/Field type/i)
    fireEvent.change(typeSelect, { target: { value: 'dropdown' } })
    await waitFor(() => {
      expect(screen.getByText('Add option')).toBeInTheDocument()
    })
  })

  it('shows options editor when type is multi_select', async () => {
    render(
      <CustomFieldDefinitionDrawer
        mode="create"
        resource="contact"
        open
        onSave={noopSave}
        onClose={noopClose}
      />,
    )
    fireEvent.change(screen.getByLabelText(/Field type/i), { target: { value: 'multi_select' } })
    await waitFor(() => {
      expect(screen.getByText('Add option')).toBeInTheDocument()
    })
  })

  it('auto-derives key from label on first keystroke', () => {
    render(
      <CustomFieldDefinitionDrawer
        mode="create"
        resource="contact"
        open
        onSave={noopSave}
        onClose={noopClose}
      />,
    )
    const labelInput = screen.getByLabelText(/^Label/i)
    fireEvent.change(labelInput, { target: { value: 'Contract Start Date' } })
    const keyInput = screen.getByLabelText(/^Key/i) as HTMLInputElement
    expect(keyInput.value).toBe('contract_start_date')
  })

  it('does not override key once user has manually edited it', () => {
    render(
      <CustomFieldDefinitionDrawer
        mode="create"
        resource="contact"
        open
        onSave={noopSave}
        onClose={noopClose}
      />,
    )
    const keyInput = screen.getByLabelText(/^Key/i)
    fireEvent.change(keyInput, { target: { value: 'my_custom_key' } })

    const labelInput = screen.getByLabelText(/^Label/i)
    fireEvent.change(labelInput, { target: { value: 'Something Else' } })

    expect((keyInput as HTMLInputElement).value).toBe('my_custom_key')
  })

  it('calls onSave with form state when submitted with valid data', async () => {
    render(
      <CustomFieldDefinitionDrawer
        mode="create"
        resource="deal"
        open
        onSave={noopSave}
        onClose={noopClose}
      />,
    )
    fireEvent.change(screen.getByLabelText(/^Label/i), { target: { value: 'Budget' } })
    // key is auto-derived to 'budget'
    fireEvent.click(screen.getByRole('button', { name: /Save field/i }))
    await waitFor(() => {
      expect(noopSave).toHaveBeenCalledWith(
        expect.objectContaining({
          label: 'Budget',
          key: 'budget',
          resource: 'deal',
        }),
      )
    })
  })

  it('shows validation errors when label and key are empty', async () => {
    render(
      <CustomFieldDefinitionDrawer
        mode="create"
        resource="contact"
        open
        onSave={noopSave}
        onClose={noopClose}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Save field/i }))
    await waitFor(() => {
      expect(screen.getByText(/Label is required/i)).toBeInTheDocument()
    })
    expect(noopSave).not.toHaveBeenCalled()
  })

  it('shows key format validation error for invalid key', async () => {
    render(
      <CustomFieldDefinitionDrawer
        mode="create"
        resource="contact"
        open
        onSave={noopSave}
        onClose={noopClose}
      />,
    )
    fireEvent.change(screen.getByLabelText(/^Label/i), { target: { value: 'Test' } })
    // Override the auto-derived key with an invalid one
    const keyInput = screen.getByLabelText(/^Key/i)
    fireEvent.change(keyInput, { target: { value: '123-invalid' } })
    fireEvent.click(screen.getByRole('button', { name: /Save field/i }))
    await waitFor(() => {
      expect(screen.getByText('Start with a letter, then use lowercase letters, numbers, or underscores. Keep it under 40 characters.')).toBeInTheDocument()
    })
    expect(screen.queryByText(/\^\[a-z\]/i)).not.toBeInTheDocument()
    expect(noopSave).not.toHaveBeenCalled()
  })

  it('calls onClose when the cancel button is clicked', () => {
    render(
      <CustomFieldDefinitionDrawer
        mode="create"
        resource="contact"
        open
        onSave={noopSave}
        onClose={noopClose}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel New contact field' }))
    expect(noopClose).toHaveBeenCalled()
  })

  it('names close and cancel actions by the active custom field drawer context', () => {
    render(
      <CustomFieldDefinitionDrawer
        mode="create"
        resource="contact"
        open
        onSave={noopSave}
        onClose={noopClose}
      />,
    )

    expect(screen.getByRole('button', { name: 'Close New contact field drawer' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel New contact field' })).toBeInTheDocument()
  })

  it('does not render when open is false', () => {
    render(
      <CustomFieldDefinitionDrawer
        mode="create"
        resource="contact"
        open={false}
        onSave={noopSave}
        onClose={noopClose}
      />,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('pre-fills form in edit mode', () => {
    render(
      <CustomFieldDefinitionDrawer
        definition={makeDef({ label: 'Existing Field', key: 'existing_field', type: 'number' })}
        mode="edit"
        resource="contact"
        open
        onSave={noopSave}
        onClose={noopClose}
      />,
    )
    expect((screen.getByLabelText(/^Label/i) as HTMLInputElement).value).toBe('Existing Field')
    expect((screen.getByLabelText(/^Key/i) as HTMLInputElement).value).toBe('existing_field')
  })
})
