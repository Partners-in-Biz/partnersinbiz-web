import { render } from '@testing-library/react'
import { CustomFieldDefinitionsList } from '@/components/crm/CustomFieldDefinitionsList'
import type { CustomFieldDefinition } from '@/lib/customFields/types'

const dndContextSpy = jest.fn()

jest.mock('@dnd-kit/core', () => ({
  DndContext: ({ children, sensors }: { children: React.ReactNode; sensors?: unknown }) => {
    dndContextSpy(sensors)
    return <div data-testid="dnd-context">{children}</div>
  },
  closestCenter: jest.fn(),
  PointerSensor: function PointerSensor() {},
  useSensor: (sensor: unknown) => ({ sensor }),
  useSensors: (...sensors: unknown[]) => sensors,
}))

jest.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: jest.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
  verticalListSortingStrategy: jest.fn(),
  arrayMove: (items: unknown[], oldIndex: number, newIndex: number) => {
    const next = [...items]
    const [moved] = next.splice(oldIndex, 1)
    next.splice(newIndex, 0, moved)
    return next
  },
}))

jest.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => '' } },
}))

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

describe('CustomFieldDefinitionsList DnD sensors', () => {
  beforeEach(() => {
    dndContextSpy.mockClear()
  })

  it('passes an explicit stable sensor list even before reorder controls are enabled', () => {
    render(
      <CustomFieldDefinitionsList
        definitions={[definition()]}
        isAdmin={false}
        canReorder={false}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
        onReorder={jest.fn()}
      />,
    )

    expect(dndContextSpy).toHaveBeenCalledWith(expect.any(Array))
    expect(dndContextSpy).not.toHaveBeenCalledWith(undefined)
  })
})
