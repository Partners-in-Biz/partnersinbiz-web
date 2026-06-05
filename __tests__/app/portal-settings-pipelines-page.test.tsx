import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import PipelinesPage from '@/app/(portal)/portal/settings/pipelines/page'
import type { Pipeline } from '@/lib/pipelines/types'

let pipelines: Pipeline[] = []
let mockSearchParams = new URLSearchParams()

jest.mock('@/components/crm/PipelineDefinitionsList', () => ({
  PipelineDefinitionsList: ({
    pipelines: visiblePipelines,
    onArchive,
    onDelete,
    onEdit,
    onSetDefault,
  }: {
    pipelines: Pipeline[]
    onArchive: (pipeline: Pipeline) => void
    onDelete: (pipeline: Pipeline) => void
    onEdit: (pipeline: Pipeline) => void
    onSetDefault: (pipeline: Pipeline) => void
  }) => (
    <div>
      {visiblePipelines.map((pipeline) => (
        <article key={pipeline.id} aria-label={`Pipeline ${pipeline.name?.trim() || 'Pipeline name missing'}`}>
          {pipeline.name?.trim() || 'Pipeline name missing'}
          <button type="button" onClick={() => onEdit(pipeline)}>
            Edit {pipeline.name?.trim() || 'Pipeline name missing'}
          </button>
          <button type="button" onClick={() => onSetDefault(pipeline)}>
            Set {pipeline.name?.trim() || 'Pipeline name missing'} as default
          </button>
          <button type="button" onClick={() => onArchive(pipeline)}>
            Archive {pipeline.name?.trim() || 'Pipeline name missing'}
          </button>
          <button type="button" onClick={() => onDelete(pipeline)}>
            Delete {pipeline.name?.trim() || 'Pipeline name missing'}
          </button>
        </article>
      ))}
    </div>
  ),
}))

jest.mock('@/components/crm/PipelineDrawer', () => ({
  PipelineDrawer: ({
    open,
    mode,
    onSave,
  }: {
    open: boolean
    mode: string
    onSave: (data: Partial<Pipeline>) => Promise<void>
  }) => (
    open ? (
      <div role="dialog" aria-label={mode === 'create' ? 'New pipeline' : 'Edit pipeline'}>
        <button type="button" onClick={() => onSave({ name: 'Expansion pipeline' })}>
          Save pipeline from drawer
        </button>
      </div>
    ) : null
  ),
}))

jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}))

describe('Portal settings pipelines page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    pipelines = []
    mockSearchParams = new URLSearchParams()
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/portal/settings/profile') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ profile: { role: 'owner' } }),
        } as Response)
      }
      if (url === '/api/v1/crm/pipelines?archived=false') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { pipelines } }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock
  })

  it('preserves company workspace scope across pipeline list and CRUD operations', async () => {
    mockSearchParams = new URLSearchParams({
      orgId: 'org-1',
      orgSlug: 'lumen-speeds',
      sourceCompanyId: 'company-1',
      sourceCompanyName: 'Lumen',
    })
    pipelines = [{
      id: 'pipeline-1',
      orgId: 'org-1',
      name: 'Sales pipeline',
      description: 'Main sales route',
      stages: [
        { id: 'qualified', label: 'Qualified', kind: 'open', order: 0, probability: 20 },
        { id: 'proposal', label: 'Proposal', kind: 'open', order: 1, probability: 60 },
        { id: 'won', label: 'Won', kind: 'won', order: 2, probability: 100 },
        { id: 'lost', label: 'Lost', kind: 'lost', order: 3, probability: 0 },
      ],
      isDefault: false,
      archived: false,
      createdAt: null,
      updatedAt: null,
    }]

    const fetchMock = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/portal/settings/profile') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ profile: { role: 'owner' } }),
        } as Response)
      }
      if (url === '/api/v1/crm/pipelines?archived=false&orgId=org-1') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { pipelines } }),
        } as Response)
      }
      if (url === '/api/v1/crm/pipelines/pipeline-1/set-default?orgId=org-1' && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true }),
        } as Response)
      }
      if (url === '/api/v1/crm/pipelines/pipeline-1?orgId=org-1' && init?.method === 'PATCH') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true }),
        } as Response)
      }
      if (url === '/api/v1/crm/pipelines?orgId=org-1' && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true }),
        } as Response)
      }
      if (url === '/api/v1/crm/pipelines/pipeline-1?orgId=org-1' && init?.method === 'DELETE') {
        pipelines = []
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    })
    global.fetch = fetchMock as jest.Mock

    render(<PipelinesPage />)

    expect(await screen.findByRole('article', { name: 'Pipeline Sales pipeline' })).toBeInTheDocument()
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/crm/pipelines?archived=false&orgId=org-1')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Set Sales pipeline as default' }))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/crm/pipelines/pipeline-1/set-default?orgId=org-1', { method: 'POST' })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Archive Sales pipeline' }))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/crm/pipelines/pipeline-1?orgId=org-1', expect.objectContaining({
        method: 'PATCH',
      }))
    })

    fireEvent.click(screen.getByRole('button', { name: 'New pipeline' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Save pipeline from drawer' }))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/crm/pipelines?orgId=org-1', expect.objectContaining({
        method: 'POST',
      }))
    })

    fireEvent.click(screen.getByRole('button', { name: 'Delete Sales pipeline' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm delete pipeline Sales pipeline' }))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/crm/pipelines/pipeline-1?orgId=org-1', { method: 'DELETE' })
    })
  })

  it('warns when pipelines fail to load and gives leaders a retry path', async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/portal/settings/profile') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ profile: { role: 'owner' } }),
        } as Response)
      }
      if (url === '/api/v1/crm/pipelines?archived=false') {
        return Promise.resolve({
          ok: false,
          json: async () => ({ error: 'Pipeline definitions unavailable' }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock

    render(<PipelinesPage />)

    expect(await screen.findByRole('heading', { name: 'Pipeline definitions could not load' })).toBeInTheDocument()
    expect(screen.getByText('Pipeline definitions unavailable')).toBeInTheDocument()
    expect(screen.queryByText('Pipeline health')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry loading pipelines' }))

    await waitFor(() => {
      const pipelineRequests = (global.fetch as jest.Mock).mock.calls.filter(([url]) => (
        String(url) === '/api/v1/crm/pipelines?archived=false'
      ))
      expect(pipelineRequests).toHaveLength(2)
    })
  })

  it('treats an empty filtered pipeline view as a reversible revenue-path lens', async () => {
    pipelines = [{
      id: 'pipeline-1',
      orgId: 'org-1',
      name: 'Sales pipeline',
      description: 'Main sales route',
      stages: [
        { id: 'qualified', label: 'Qualified', kind: 'open', order: 0, probability: 20 },
        { id: 'proposal', label: 'Proposal', kind: 'open', order: 1, probability: 60 },
        { id: 'won', label: 'Won', kind: 'won', order: 2, probability: 100 },
        { id: 'lost', label: 'Lost', kind: 'lost', order: 3, probability: 0 },
      ],
      isDefault: true,
      archived: false,
      createdAt: null,
      updatedAt: null,
    }]

    render(<PipelinesPage />)

    expect(await screen.findByRole('article', { name: 'Pipeline Sales pipeline' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New pipeline' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Filter pipelines by health' })).toBeInTheDocument()

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter pipelines by health' }), { target: { value: 'needs-work' } })

    expect(await screen.findByRole('heading', { name: 'No pipelines match this view.' })).toBeInTheDocument()
    expect(screen.getByText('Clear the pipeline filters to return to every revenue path.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show all pipelines' }))

    expect(await screen.findByRole('article', { name: 'Pipeline Sales pipeline' })).toBeInTheDocument()
  })

  it('keeps sparse pipeline rows searchable without crashing the revenue-path lens', async () => {
    pipelines = [{
      id: 'pipeline-sparse',
      orgId: 'org-1',
      description: '',
      isDefault: false,
      archived: false,
      createdAt: null,
      updatedAt: null,
    } as unknown as Pipeline]

    render(<PipelinesPage />)

    expect(await screen.findByRole('article', { name: 'Pipeline Pipeline name missing' })).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Search pipeline, stage, or outcome...'), {
      target: { value: 'missing' },
    })

    expect(screen.getByRole('article', { name: 'Pipeline Pipeline name missing' })).toBeInTheDocument()
    expect(screen.getByText('Pipeline health')).toBeInTheDocument()
    expect(screen.getByText('0/1')).toBeInTheDocument()
  })

  it('flags a missing default route and lets leaders set the ready pipeline', async () => {
    pipelines = [{
      id: 'pipeline-ready',
      orgId: 'org-1',
      name: 'Sales pipeline',
      description: 'Main sales route',
      stages: [
        { id: 'qualified', label: 'Qualified', kind: 'open', order: 0, probability: 20 },
        { id: 'proposal', label: 'Proposal', kind: 'open', order: 1, probability: 60 },
        { id: 'won', label: 'Won', kind: 'won', order: 2, probability: 100 },
        { id: 'lost', label: 'Lost', kind: 'lost', order: 3, probability: 0 },
      ],
      isDefault: false,
      archived: false,
      createdAt: null,
      updatedAt: null,
    }]

    const fetchMock = global.fetch as jest.Mock
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/portal/settings/profile') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ profile: { role: 'owner' } }),
        } as Response)
      }
      if (url === '/api/v1/crm/pipelines?archived=false') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { pipelines } }),
        } as Response)
      }
      if (url === '/api/v1/crm/pipelines/pipeline-ready/set-default' && init?.method === 'POST') {
        pipelines = pipelines.map((pipeline) => ({ ...pipeline, isDefault: pipeline.id === 'pipeline-ready' }))
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    })

    render(<PipelinesPage />)

    expect(await screen.findByRole('article', { name: 'Pipeline Sales pipeline' })).toBeInTheDocument()
    expect(screen.getByText('Missing')).toBeInTheDocument()
    const warning = screen.getByRole('region', { name: 'Default pipeline route review' })
    expect(within(warning).getByRole('heading', { name: 'Default route is missing' })).toBeInTheDocument()
    expect(within(warning).getByText('New deals need a default revenue path before the team scales pipeline entry.')).toBeInTheDocument()

    fireEvent.click(within(warning).getByRole('button', { name: 'Set Sales pipeline as default pipeline route' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/crm/pipelines/pipeline-ready/set-default', { method: 'POST' })
    })
  })

  it('keeps default-route failures inside the pipeline command center', async () => {
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {})
    pipelines = [{
      id: 'pipeline-ready',
      orgId: 'org-1',
      name: 'Sales pipeline',
      description: 'Main sales route',
      stages: [
        { id: 'qualified', label: 'Qualified', kind: 'open', order: 0, probability: 20 },
        { id: 'proposal', label: 'Proposal', kind: 'open', order: 1, probability: 60 },
        { id: 'won', label: 'Won', kind: 'won', order: 2, probability: 100 },
        { id: 'lost', label: 'Lost', kind: 'lost', order: 3, probability: 0 },
      ],
      isDefault: false,
      archived: false,
      createdAt: null,
      updatedAt: null,
    }]

    const fetchMock = global.fetch as jest.Mock
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/portal/settings/profile') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ profile: { role: 'owner' } }),
        } as Response)
      }
      if (url === '/api/v1/crm/pipelines?archived=false') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { pipelines } }),
        } as Response)
      }
      if (url === '/api/v1/crm/pipelines/pipeline-ready/set-default' && init?.method === 'POST') {
        return Promise.resolve({
          ok: false,
          json: async () => ({ error: 'Default route is locked by policy' }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    })

    render(<PipelinesPage />)

    expect(await screen.findByRole('article', { name: 'Pipeline Sales pipeline' })).toBeInTheDocument()
    const warning = screen.getByRole('region', { name: 'Default pipeline route review' })

    fireEvent.click(within(warning).getByRole('button', { name: 'Set Sales pipeline as default pipeline route' }))

    const actionError = await screen.findByRole('status', { name: 'Pipeline action failed' })
    expect(actionError).toHaveTextContent('Default route is locked by policy')
    expect(actionError).toHaveTextContent('No pipeline changes were applied. Review permissions or retry the action from this workspace.')
    expect(alertSpy).not.toHaveBeenCalled()

    alertSpy.mockRestore()
  })

  it('routes smoke-test default candidates into setup review instead of promotion', async () => {
    pipelines = [{
      id: 'pipeline-smoke',
      orgId: 'org-1',
      name: 'Smoke delete pipeline 1780236200000',
      description: 'Temporary setup path',
      stages: [
        { id: 'qualified', label: 'Qualified', kind: 'open', order: 0, probability: 20 },
        { id: 'proposal', label: 'Proposal', kind: 'open', order: 1, probability: 60 },
        { id: 'won', label: 'Won', kind: 'won', order: 2, probability: 100 },
        { id: 'lost', label: 'Lost', kind: 'lost', order: 3, probability: 0 },
      ],
      isDefault: false,
      archived: false,
      createdAt: null,
      updatedAt: null,
    }]

    render(<PipelinesPage />)

    expect(await screen.findByRole('article', { name: 'Pipeline Smoke delete pipeline 1780236200000' })).toBeInTheDocument()
    const warning = screen.getByRole('region', { name: 'Default pipeline route review' })
    expect(within(warning).getByText('Needs setup before it can carry new deals confidently.')).toBeInTheDocument()
    expect(within(warning).getByRole('button', { name: 'Review Smoke delete pipeline 1780236200000 before setting a default pipeline route' })).toBeInTheDocument()
    expect(within(warning).queryByRole('button', { name: 'Set Smoke delete pipeline 1780236200000 as default pipeline route' })).not.toBeInTheDocument()
  })

  it('uses an in-page confirmation before deleting a revenue pipeline', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false)
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {})
    pipelines = [{
      id: 'pipeline-delete',
      orgId: 'org-1',
      name: 'Enterprise sales',
      description: 'High-touch enterprise path',
      stages: [
        { id: 'qualified', label: 'Qualified', kind: 'open', order: 0, probability: 20 },
        { id: 'proposal', label: 'Proposal', kind: 'open', order: 1, probability: 60 },
        { id: 'won', label: 'Won', kind: 'won', order: 2, probability: 100 },
        { id: 'lost', label: 'Lost', kind: 'lost', order: 3, probability: 0 },
      ],
      isDefault: false,
      archived: false,
      createdAt: null,
      updatedAt: null,
    }]

    const fetchMock = global.fetch as jest.Mock
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/portal/settings/profile') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ profile: { role: 'owner' } }),
        } as Response)
      }
      if (url === '/api/v1/crm/pipelines?archived=false') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { pipelines } }),
        } as Response)
      }
      if (url === '/api/v1/crm/pipelines/pipeline-delete' && init?.method === 'DELETE') {
        pipelines = []
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    })

    render(<PipelinesPage />)

    expect(await screen.findByRole('article', { name: 'Pipeline Enterprise sales' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Delete Enterprise sales' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(alertSpy).not.toHaveBeenCalled()
    expect(await screen.findByRole('alertdialog', { name: 'Delete pipeline "Enterprise sales"?' })).toBeInTheDocument()
    expect(screen.getByText('This removes the revenue path with 4 stages. Existing deal history stays available for audit.')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalledWith('/api/v1/crm/pipelines/pipeline-delete', { method: 'DELETE' })
    expect(screen.getByRole('button', { name: 'Cancel delete pipeline Enterprise sales' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete pipeline Enterprise sales' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/crm/pipelines/pipeline-delete', { method: 'DELETE' })
    })
    await waitFor(() => {
      expect(screen.queryByRole('article', { name: 'Pipeline Enterprise sales' })).not.toBeInTheDocument()
    })

    confirmSpy.mockRestore()
    alertSpy.mockRestore()
  })
})
