import { fireEvent, render, screen } from '@testing-library/react'
import { PipelineDefinitionsList } from '@/components/crm/PipelineDefinitionsList'
import type { Pipeline } from '@/lib/pipelines/types'

const noop = jest.fn()

function renderList(props: Partial<React.ComponentProps<typeof PipelineDefinitionsList>> = {}) {
  return render(
    <PipelineDefinitionsList
      pipelines={props.pipelines ?? []}
      isAdmin={props.isAdmin ?? true}
      onCreate={props.onCreate ?? noop}
      onEdit={props.onEdit ?? noop}
      onDelete={props.onDelete ?? noop}
      onSetDefault={props.onSetDefault ?? noop}
      onArchive={props.onArchive ?? noop}
    />,
  )
}

function pipeline(overrides: Partial<Pipeline> = {}): Pipeline {
  return {
    id: 'pipeline-1',
    orgId: 'org-1',
    name: 'New sales',
    description: 'Primary sales flow',
    stages: [
      { id: 'qualified', label: 'Qualified', kind: 'open', order: 0, probability: 25 },
      { id: 'won', label: 'Won', kind: 'won', order: 1, probability: 100 },
      { id: 'lost', label: 'Lost', kind: 'lost', order: 2, probability: 0 },
    ],
    isDefault: true,
    archived: false,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  }
}

describe('PipelineDefinitionsList', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('turns the empty pipeline library into an admin setup command center', () => {
    const onCreate = jest.fn()

    renderList({ onCreate })

    expect(screen.getByText('Launch your first revenue path')).toBeInTheDocument()
    expect(screen.getByText('Deal intake')).toBeInTheDocument()
    expect(screen.getByText('Won exit')).toBeInTheDocument()
    expect(screen.getByText('Lost exit')).toBeInTheDocument()
    expect(screen.getByText('Default route')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /create the first pipeline/i }))
    expect(onCreate).toHaveBeenCalledTimes(1)
  })

  it('keeps the empty pipeline guidance read-only for non-admin users', () => {
    renderList({ isAdmin: false })

    expect(screen.getByText('Launch your first revenue path')).toBeInTheDocument()
    expect(screen.getByText(/Ask an admin to create the first pipeline/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /create the first pipeline/i })).not.toBeInTheDocument()
  })

  it('still renders existing pipeline rows and admin actions', () => {
    renderList({ pipelines: [pipeline()] })

    expect(screen.getByText('New sales')).toBeInTheDocument()
    expect(screen.getByText('default')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Edit New sales/i })).toBeInTheDocument()
  })
})
