import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { StageEditor } from '@/components/crm/StageEditor'
import type { PipelineStage } from '@/lib/pipelines/types'

// ── dnd-kit mocks ─────────────────────────────────────────────────────────────

jest.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <div data-testid="dnd-context">{children}</div>,
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

function makeStages(): PipelineStage[] {
  return [
    { id: 'discovery',   label: 'Discovery',   kind: 'open', order: 0, probability: 10 },
    { id: 'proposal',    label: 'Proposal',    kind: 'open', order: 1, probability: 30 },
    { id: 'negotiation', label: 'Negotiation', kind: 'open', order: 2, probability: 60 },
    { id: 'won',         label: 'Won',         kind: 'won',  order: 3, probability: 100 },
    { id: 'lost',        label: 'Lost',        kind: 'lost', order: 4, probability: 0 },
  ]
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('StageEditor', () => {
  it('renders all stage rows', () => {
    const onChange = jest.fn()
    render(<StageEditor stages={makeStages()} onChange={onChange} />)
    // Each stage has a label input
    const inputs = screen.getAllByRole('textbox')
    expect(inputs.length).toBeGreaterThanOrEqual(5)
  })

  it('renders "Add stage" button', () => {
    render(<StageEditor stages={makeStages()} onChange={jest.fn()} />)
    expect(screen.getByRole('button', { name: /Add stage/i })).toBeInTheDocument()
  })

  it('calls onChange with new stage when "Add stage" is clicked', () => {
    const onChange = jest.fn()
    const stages = makeStages()
    render(<StageEditor stages={stages} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /Add stage/i }))
    expect(onChange).toHaveBeenCalledTimes(1)
    const next: PipelineStage[] = onChange.mock.calls[0][0]
    expect(next.length).toBe(stages.length + 1)
    const newStage = next[next.length - 1]
    expect(newStage.kind).toBe('open')
    expect(newStage.probability).toBe(50)
  })

  it('calls onChange with updated label when label input changes', () => {
    const onChange = jest.fn()
    render(<StageEditor stages={makeStages()} onChange={onChange} />)
    const labelInput = screen.getByLabelText('Stage label for discovery')
    fireEvent.change(labelInput, { target: { value: 'Discover More' } })
    expect(onChange).toHaveBeenCalledTimes(1)
    const next: PipelineStage[] = onChange.mock.calls[0][0]
    expect(next.find((s) => s.id === 'discovery')?.label).toBe('Discover More')
  })

  it('calls onChange with updated kind when kind select changes', () => {
    const onChange = jest.fn()
    const stages = makeStages()
    render(<StageEditor stages={stages} onChange={onChange} />)
    const kindSelect = screen.getByLabelText('Stage kind for discovery')
    fireEvent.change(kindSelect, { target: { value: 'won' } })
    expect(onChange).toHaveBeenCalledTimes(1)
    const next: PipelineStage[] = onChange.mock.calls[0][0]
    expect(next.find((s) => s.id === 'discovery')?.kind).toBe('won')
  })

  it('calls onChange with updated probability when slider changes', () => {
    const onChange = jest.fn()
    render(<StageEditor stages={makeStages()} onChange={onChange} />)
    const probInput = screen.getByLabelText('Stage probability for discovery')
    fireEvent.change(probInput, { target: { value: '75' } })
    expect(onChange).toHaveBeenCalledTimes(1)
    const next: PipelineStage[] = onChange.mock.calls[0][0]
    expect(next.find((s) => s.id === 'discovery')?.probability).toBe(75)
  })

  it('calls onChange with stage removed when remove button is clicked', () => {
    const onChange = jest.fn()
    const stages = makeStages()
    render(<StageEditor stages={stages} onChange={onChange} />)
    const removeBtn = screen.getByRole('button', { name: /Remove stage Discovery/i })
    fireEvent.click(removeBtn)
    expect(onChange).toHaveBeenCalledTimes(1)
    const next: PipelineStage[] = onChange.mock.calls[0][0]
    expect(next.length).toBe(stages.length - 1)
    expect(next.find((s) => s.id === 'discovery')).toBeUndefined()
  })

  it('disable remove button when only 1 stage remains', () => {
    const onChange = jest.fn()
    const single = makeStages().slice(0, 1)
    render(<StageEditor stages={single} onChange={onChange} />)
    const removeBtn = screen.getByRole('button', { name: /Remove stage/i })
    expect(removeBtn).toBeDisabled()
  })

  it('shows warning when no won stage exists', () => {
    const stages = makeStages().filter((s) => s.kind !== 'won')
    render(<StageEditor stages={stages} onChange={jest.fn()} />)
    expect(screen.getByText(/At least one Won stage is required/i)).toBeInTheDocument()
  })

  it('shows warning when no lost stage exists', () => {
    const stages = makeStages().filter((s) => s.kind !== 'lost')
    render(<StageEditor stages={stages} onChange={jest.fn()} />)
    expect(screen.getByText(/At least one Lost stage is required/i)).toBeInTheDocument()
  })

  it('shows warning when multiple won stages exist', () => {
    const stages = makeStages().map((s) =>
      s.id === 'discovery' ? { ...s, kind: 'won' as const } : s,
    )
    render(<StageEditor stages={stages} onChange={jest.fn()} />)
    expect(screen.getByText(/Only one Won stage allowed/i)).toBeInTheDocument()
  })

  it('does not show won/lost warnings for a valid stage set', () => {
    render(<StageEditor stages={makeStages()} onChange={jest.fn()} />)
    expect(screen.queryByText(/Won stage/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Lost stage/i)).not.toBeInTheDocument()
  })
})
