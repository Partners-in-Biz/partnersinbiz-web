import React from 'react'
import { render, screen } from '@testing-library/react'
import { DealKanban } from '@/components/crm/DealKanban'
import type { Deal } from '@/lib/crm/types'
import type { PipelineStage } from '@/lib/pipelines/types'

// ── dnd-kit mocks ─────────────────────────────────────────────────────────────

jest.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <div data-testid="dnd-context">{children}</div>,
  DragOverlay: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  closestCorners: jest.fn(),
  PointerSensor: jest.fn(),
  KeyboardSensor: jest.fn(),
  useSensor: jest.fn(),
  useSensors: jest.fn(() => []),
  useDroppable: () => ({ setNodeRef: jest.fn(), isOver: false }),
}))
jest.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  sortableKeyboardCoordinates: jest.fn(),
  verticalListSortingStrategy: jest.fn(),
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: jest.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
}))
jest.mock('@dnd-kit/utilities', () => ({ CSS: { Transform: { toString: () => '' } } }))
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }))

// ── Test pipeline stages (replaces hard-coded DealStage constants) ─────────────

const TEST_STAGES: PipelineStage[] = [
  { id: 'discovery',   label: 'Discovery',   kind: 'open', order: 0, probability: 10 },
  { id: 'proposal',    label: 'Proposal',    kind: 'open', order: 1, probability: 30 },
  { id: 'negotiation', label: 'Negotiation', kind: 'open', order: 2, probability: 70 },
  { id: 'won',         label: 'Won',         kind: 'won',  order: 3, probability: 100 },
  { id: 'lost',        label: 'Lost',        kind: 'lost', order: 4, probability: 0 },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeDeal = (overrides: Partial<Deal> = {}): Deal => ({
  id: 'deal-1',
  orgId: 'org-1',
  contactId: 'contact-1',
  title: 'Test Deal',
  value: 10000,
  currency: 'ZAR',
  // A3 W2-F: pipelineId + stageId replace the old stage field
  pipelineId: 'pl-default',
  stageId: 'discovery',
  expectedCloseDate: null,
  notes: '',
  createdAt: null,
  updatedAt: null,
  ...overrides,
})

const noop = async () => {}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DealKanban', () => {
  it('renders all stage column headers from stages prop', () => {
    render(<DealKanban deals={[]} stages={TEST_STAGES} onStageChange={noop} />)
    for (const stage of TEST_STAGES) {
      expect(screen.getByText(stage.label)).toBeInTheDocument()
    }
  })

  it('places each deal in its correct stage column', () => {
    const deals: Deal[] = [
      makeDeal({ id: 'd1', title: 'Alpha Deal', stageId: 'discovery' }),
      makeDeal({ id: 'd2', title: 'Beta Deal',  stageId: 'proposal' }),
      makeDeal({ id: 'd3', title: 'Gamma Deal', stageId: 'won' }),
    ]
    render(<DealKanban deals={deals} stages={TEST_STAGES} onStageChange={noop} />)
    expect(screen.getByText('Alpha Deal')).toBeInTheDocument()
    expect(screen.getByText('Beta Deal')).toBeInTheDocument()
    expect(screen.getByText('Gamma Deal')).toBeInTheDocument()
  })

  it('renders deal value as formatted currency', () => {
    const deal = makeDeal({ id: 'd1', value: 50000, currency: 'ZAR', stageId: 'proposal' })
    render(<DealKanban deals={[deal]} stages={TEST_STAGES} onStageChange={noop} />)
    // Intl formats 50 000 — accept any digit grouping
    const valueEl = screen.getByText(/50[\s,.]?000/)
    expect(valueEl).toBeInTheDocument()
  })

  it('names missing deal values on kanban cards instead of showing invalid currency', () => {
    const deal = makeDeal({ id: 'd1', title: 'Unpriced board deal', value: undefined, stageId: 'proposal' })

    render(<DealKanban deals={[deal]} stages={TEST_STAGES} onStageChange={noop} />)

    expect(screen.getByText('Unpriced board deal')).toBeInTheDocument()
    expect(screen.getByText('No value captured')).toBeInTheDocument()
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument()
  })

  it('shows "Drop here" placeholder in empty columns', () => {
    // Only discovery has a deal — others should show the drop placeholder
    const deal = makeDeal({ id: 'd1', stageId: 'discovery' })
    render(<DealKanban deals={[deal]} stages={TEST_STAGES} onStageChange={noop} />)
    const dropTargets = screen.getAllByText('Drop here')
    // 4 empty columns (proposal, negotiation, won, lost)
    expect(dropTargets).toHaveLength(4)
  })

  it('shows skeleton cards when loading=true', () => {
    const { container } = render(<DealKanban deals={[]} stages={TEST_STAGES} loading onStageChange={noop} />)
    const skeletons = container.querySelectorAll('.pib-skeleton')
    // 5 columns × 3 skeletons each = 15
    expect(skeletons).toHaveLength(15)
  })

  it('shows no deals when the list is empty and loading=false', () => {
    render(<DealKanban deals={[]} stages={TEST_STAGES} onStageChange={noop} />)
    // All 5 drop placeholders should be visible
    const dropTargets = screen.getAllByText('Drop here')
    expect(dropTargets).toHaveLength(5)
    // No deal titles
    expect(screen.queryByText('Test Deal')).not.toBeInTheDocument()
  })

  it('renders a contact readiness link for deals with contactId', () => {
    const deal = makeDeal({ id: 'd1', contactId: 'c-99', stageId: 'negotiation' })
    render(<DealKanban deals={[deal]} stages={TEST_STAGES} onStageChange={noop} />)
    const link = screen.getByRole('link', { name: 'Contact identity missing' })
    expect(link).toHaveAttribute('href', '/portal/contacts/c-99')
  })

  it('names missing contact snapshots on deal cards instead of showing generic contact chips', () => {
    const deal = makeDeal({ id: 'd1', contactId: 'contact-raw-id', stageId: 'negotiation' })

    render(<DealKanban deals={[deal]} stages={TEST_STAGES} onStageChange={noop} />)

    const link = screen.getByRole('link', { name: 'Contact identity missing' })
    expect(link).toHaveAttribute('href', '/portal/contacts/contact-raw-id')
    expect(screen.queryByRole('link', { name: 'Contact' })).not.toBeInTheDocument()
    expect(screen.queryByText('contact-raw-id')).not.toBeInTheDocument()
  })

  it('uses readable contact labels when provided for deal cards', () => {
    const deal = makeDeal({ id: 'd1', contactId: 'c-99', stageId: 'negotiation' })
    render(
      <DealKanban
        deals={[deal]}
        stages={TEST_STAGES}
        contactLabelsById={{ 'c-99': 'Ava Owner' }}
        onStageChange={noop}
      />,
    )

    const link = screen.getByRole('link', { name: 'Ava Owner' })
    expect(link).toHaveAttribute('href', '/portal/contacts/c-99')
  })

  it('does not render a contact link when contactId is empty', () => {
    const deal = makeDeal({ id: 'd1', contactId: '', stageId: 'negotiation' })
    render(<DealKanban deals={[deal]} stages={TEST_STAGES} onStageChange={noop} />)
    expect(screen.queryByRole('link', { name: 'Contact' })).not.toBeInTheDocument()
  })

  it('renders multiple deals in the same column', () => {
    const deals: Deal[] = [
      makeDeal({ id: 'd1', title: 'Deal One',   stageId: 'proposal' }),
      makeDeal({ id: 'd2', title: 'Deal Two',   stageId: 'proposal' }),
      makeDeal({ id: 'd3', title: 'Deal Three', stageId: 'proposal' }),
    ]
    render(<DealKanban deals={deals} stages={TEST_STAGES} onStageChange={noop} />)
    expect(screen.getByText('Deal One')).toBeInTheDocument()
    expect(screen.getByText('Deal Two')).toBeInTheDocument()
    expect(screen.getByText('Deal Three')).toBeInTheDocument()
  })
})
