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

  it('turns a missing operating note into an admin edit action', () => {
    const onEdit = jest.fn()

    renderList({ pipelines: [pipeline({ description: '' })], onEdit })

    expect(screen.getByText(/No operating note yet/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Add operating note for New sales/i }))
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'pipeline-1' }))
  })

  it('turns missing stages into an admin setup action', () => {
    const onEdit = jest.fn()

    renderList({ pipelines: [pipeline({ stages: [] })], onEdit })

    expect(screen.getByText(/No stages configured/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Add stages for New sales/i }))
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'pipeline-1' }))
  })

  it('names sparse pipeline rows instead of crashing or exposing blank actions', () => {
    const onEdit = jest.fn()

    renderList({
      pipelines: [pipeline({
        name: '',
        description: '',
        stages: undefined,
      } as Partial<Pipeline>) as unknown as Pipeline],
      onEdit,
    })

    expect(screen.getByText('Pipeline name missing')).toBeInTheDocument()
    expect(screen.getByText(/No stages configured/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Add stages for Pipeline name missing/i }))
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'pipeline-1' }))
    expect(screen.queryByRole('button', { name: /Edit\s*$/i })).not.toBeInTheDocument()
  })

  it('keeps row setup gap actions hidden from non-admin users', () => {
    renderList({ pipelines: [pipeline({ description: '', stages: [] })], isAdmin: false })

    expect(screen.getByText(/No operating note yet/i)).toBeInTheDocument()
    expect(screen.getByText(/No stages configured/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Add operating note for New sales/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Add stages for New sales/i })).not.toBeInTheDocument()
  })
})
