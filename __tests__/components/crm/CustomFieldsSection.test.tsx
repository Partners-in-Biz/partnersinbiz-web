import { fireEvent, render, screen } from '@testing-library/react'
import { CustomFieldsSection } from '@/components/crm/CustomFieldsSection'
import type { CustomFieldDefinition } from '@/lib/customFields/types'

function definition(overrides: Partial<CustomFieldDefinition> = {}): CustomFieldDefinition {
  return {
    id: 'field-1',
    orgId: 'org-1',
    resource: 'company',
    key: 'decision_role',
    label: 'Decision role',
    type: 'text',
    required: false,
    order: 0,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  }
}

describe('CustomFieldsSection', () => {
  it('turns empty custom field values into a supplied capture action', () => {
    const onCapture = jest.fn()

    render(
      <CustomFieldsSection
        definitions={[definition()]}
        values={{}}
        mode="read"
        emptyAction={{
          label: 'Capture fields',
          ariaLabel: 'Capture custom fields for Acme Studio',
          onClick: onCapture,
        }}
      />,
    )

    expect(screen.getByText('No custom fields set.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Capture custom fields for Acme Studio' }))

    expect(onCapture).toHaveBeenCalledTimes(1)
  })
})
