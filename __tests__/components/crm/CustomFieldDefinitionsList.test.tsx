import { fireEvent, render, screen } from '@testing-library/react'
import { CustomFieldDefinitionsList } from '@/components/crm/CustomFieldDefinitionsList'
import type { CustomFieldDefinition } from '@/lib/customFields/types'

const noop = jest.fn()

function definition(overrides: Partial<CustomFieldDefinition> = {}): CustomFieldDefinition {
  return {
    id: 'field-1',
    orgId: 'org-1',
    resource: 'contact',
    key: 'decision_role',
    label: 'Decision role',
    type: 'text',
    required: false,
    group: 'Qualification',
    order: 0,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  }
}

function renderList(props: Partial<React.ComponentProps<typeof CustomFieldDefinitionsList>> = {}) {
  return render(
    <CustomFieldDefinitionsList
      definitions={props.definitions ?? [definition()]}
      isAdmin={props.isAdmin ?? true}
      canReorder={props.canReorder ?? false}
      onEdit={props.onEdit ?? noop}
      onDelete={props.onDelete ?? noop}
      onReorder={props.onReorder ?? noop}
    />,
  )
}

describe('CustomFieldDefinitionsList', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('turns missing help text into an admin edit action', () => {
    const onEdit = jest.fn()

    renderList({ onEdit })

    expect(screen.getByText(/No help text yet/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Add help text for Decision role/i }))
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'field-1' }))
  })

  it('turns missing dropdown options into an admin edit action', () => {
    const onEdit = jest.fn()

    renderList({
      onEdit,
      definitions: [definition({ type: 'dropdown', options: [] })],
    })

    expect(screen.getByText('Options missing')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Add options for Decision role/i }))
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'field-1' }))
  })

  it('keeps field setup gap actions hidden from non-admin users', () => {
    renderList({
      isAdmin: false,
      definitions: [definition({ type: 'dropdown', options: [] })],
    })

    expect(screen.getByText(/No help text yet/i)).toBeInTheDocument()
    expect(screen.getByText('Options missing')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Add help text for Decision role/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Add options for Decision role/i })).not.toBeInTheDocument()
  })
})
