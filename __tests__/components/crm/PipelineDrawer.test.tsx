import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PipelineDrawer } from '@/components/crm/PipelineDrawer'
import type { Pipeline } from '@/lib/pipelines/types'

// ── dnd-kit mocks (StageEditor uses them) ────────────────────────────────────

jest.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  closestCenter: jest.fn(),
  PointerSensor: jest.fn(),
  useSensor: jest.fn(),
  useSensors: jest.fn(() => []),
}))

jest.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  verticalListSortingStrategy: jest.fn(),
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: jest.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
  arrayMove: (arr: unknown[], from: number, to: number) => {
    const result = [...arr]
    const [removed] = result.splice(from, 1)
    result.splice(to, 0, removed)
    return result
  },
}))

jest.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => '' } },
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makePipeline(overrides: Partial<Pipeline> = {}): Partial<Pipeline> {
  return {
    id: 'pipe-1',
    orgId: 'org-1',
    name: 'Sales',
    description: 'Main sales pipeline',
    isDefault: false,
    archived: false,
    stages: [
      { id: 'discovery',   label: 'Discovery',   kind: 'open', order: 0, probability: 10 },
      { id: 'proposal',    label: 'Proposal',    kind: 'open', order: 1, probability: 30 },
      { id: 'won',         label: 'Won',         kind: 'won',  order: 2, probability: 100 },
      { id: 'lost',        label: 'Lost',        kind: 'lost', order: 3, probability: 0 },
    ],
    createdAt: null,
    updatedAt: null,
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PipelineDrawer', () => {
  const noopClose = jest.fn()
  const noopSave  = jest.fn().mockResolvedValue(undefined)

  beforeEach(() => jest.clearAllMocks())

  it('does not render when open is false', () => {
    render(
      <PipelineDrawer mode="create" open={false} onSave={noopSave} onClose={noopClose} />,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders the drawer with create title when open in create mode', () => {
    render(
      <PipelineDrawer mode="create" open onSave={noopSave} onClose={noopClose} />,
    )
    expect(screen.getByRole('dialog', { name: /New pipeline/i })).toBeInTheDocument()
  })

  it('renders name and description inputs', () => {
    render(
      <PipelineDrawer mode="create" open onSave={noopSave} onClose={noopClose} />,
    )
    expect(screen.getByLabelText(/^Name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Description/i)).toBeInTheDocument()
  })

  it('renders with edit title and pre-fills fields in edit mode', () => {
    render(
      <PipelineDrawer
        pipeline={makePipeline({ name: 'Renewals', description: 'For renewals' })}
        mode="edit"
        open
        onSave={noopSave}
        onClose={noopClose}
      />,
    )
    expect(screen.getByRole('dialog', { name: /Edit pipeline/i })).toBeInTheDocument()
    expect((screen.getByLabelText(/^Name/i) as HTMLInputElement).value).toBe('Renewals')
    expect((screen.getByLabelText(/^Description/i) as HTMLTextAreaElement).value).toBe('For renewals')
  })

  it('mounts StageEditor (renders "Add stage" button)', () => {
    render(
      <PipelineDrawer mode="create" open onSave={noopSave} onClose={noopClose} />,
    )
    expect(screen.getByRole('button', { name: /Add stage/i })).toBeInTheDocument()
  })

  it('shows validation error when name is empty on submit', async () => {
    render(
      <PipelineDrawer mode="create" open onSave={noopSave} onClose={noopClose} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Save pipeline/i }))
    await waitFor(() => {
      expect(screen.getByText(/Name is required/i)).toBeInTheDocument()
    })
    expect(noopSave).not.toHaveBeenCalled()
  })

  it('calls onSave with form state when submitted with valid name', async () => {
    render(
      <PipelineDrawer mode="create" open onSave={noopSave} onClose={noopClose} />,
    )
    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: 'New Pipeline' } })
    fireEvent.click(screen.getByRole('button', { name: /Save pipeline/i }))
    await waitFor(() => {
      expect(noopSave).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'New Pipeline' }),
      )
    })
  })

  it('includes stages in the onSave payload', async () => {
    render(
      <PipelineDrawer mode="create" open onSave={noopSave} onClose={noopClose} />,
    )
    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: 'X' } })
    fireEvent.click(screen.getByRole('button', { name: /Save pipeline/i }))
    await waitFor(() => {
      expect(noopSave).toHaveBeenCalled()
    })
    const payload = noopSave.mock.calls[0][0] as Partial<Pipeline>
    expect(Array.isArray(payload.stages)).toBe(true)
    expect((payload.stages ?? []).length).toBeGreaterThan(0)
  })

  it('hides isDefault toggle in create mode', () => {
    render(
      <PipelineDrawer mode="create" open onSave={noopSave} onClose={noopClose} />,
    )
    expect(screen.queryByLabelText(/Set as default pipeline/i)).not.toBeInTheDocument()
  })

  it('shows isDefault toggle in edit mode', () => {
    render(
      <PipelineDrawer
        pipeline={makePipeline()}
        mode="edit"
        open
        onSave={noopSave}
        onClose={noopClose}
      />,
    )
    expect(screen.getByLabelText(/Set as default pipeline/i)).toBeInTheDocument()
  })

  it('includes isDefault in onSave payload in edit mode', async () => {
    render(
      <PipelineDrawer
        pipeline={makePipeline({ name: 'Sales', isDefault: false })}
        mode="edit"
        open
        onSave={noopSave}
        onClose={noopClose}
      />,
    )
    // Toggle isDefault on
    fireEvent.click(screen.getByLabelText(/Set as default pipeline/i))
    fireEvent.click(screen.getByRole('button', { name: /Save pipeline/i }))
    await waitFor(() => {
      expect(noopSave).toHaveBeenCalledWith(
        expect.objectContaining({ isDefault: true }),
      )
    })
  })

  it('calls onClose when cancel button is clicked', () => {
    render(
      <PipelineDrawer mode="create" open onSave={noopSave} onClose={noopClose} />,
    )
    const cancelBtns = screen.getAllByRole('button', { name: /Cancel/i })
    fireEvent.click(cancelBtns[0])
    expect(noopClose).toHaveBeenCalled()
  })
})
