import { fireEvent, render, screen } from '@testing-library/react'
import PipelinesPage from '@/app/(portal)/portal/settings/pipelines/page'
import type { Pipeline } from '@/lib/pipelines/types'

let pipelines: Pipeline[] = []

jest.mock('@/components/crm/PipelineDefinitionsList', () => ({
  PipelineDefinitionsList: ({ pipelines: visiblePipelines }: { pipelines: Pipeline[] }) => (
    <div>
      {visiblePipelines.map((pipeline) => (
        <article key={pipeline.id} aria-label={`Pipeline ${pipeline.name}`}>{pipeline.name}</article>
      ))}
    </div>
  ),
}))

jest.mock('@/components/crm/PipelineDrawer', () => ({
  PipelineDrawer: ({ open, mode }: { open: boolean; mode: string }) => (
    open ? <div role="dialog" aria-label={mode === 'create' ? 'New pipeline' : 'Edit pipeline'} /> : null
  ),
}))

describe('Portal settings pipelines page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    pipelines = []
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

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'needs-work' } })

    expect(await screen.findByRole('heading', { name: 'No pipelines match this view.' })).toBeInTheDocument()
    expect(screen.getByText('Clear the pipeline filters to return to every revenue path.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show all pipelines' }))

    expect(await screen.findByRole('article', { name: 'Pipeline Sales pipeline' })).toBeInTheDocument()
  })
})
