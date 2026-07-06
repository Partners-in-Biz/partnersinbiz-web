import { render, screen, waitFor } from '@testing-library/react'
import {
  AdminBookStudioGovernanceWorkspace,
  LifecyclePipelineBoard,
  type LifecyclePipelineProject,
} from '@/components/book-studio/AdminBookStudioGovernanceWorkspace'

describe('LifecyclePipelineBoard', () => {
  it('renders a column per lifecycle state with correct counts', () => {
    const projects: LifecyclePipelineProject[] = [
      { id: 'p1', title: 'Book One', lifecycleState: 'draft' },
      { id: 'p2', title: 'Book Two', lifecycleState: 'rights_cleared' },
      { id: 'p3', title: 'Book Three' }, // no lifecycleState -> defaults to draft
    ]
    render(<LifecyclePipelineBoard projects={projects} />)

    expect(screen.getByTestId('lifecycle-column-draft')).toHaveTextContent('draft (2)')
    expect(screen.getByTestId('lifecycle-column-rights_cleared')).toHaveTextContent('rights cleared (1)')
    expect(screen.getByTestId('lifecycle-column-live')).toHaveTextContent('live (0)')
    expect(screen.getByText('Book One')).toBeInTheDocument()
    expect(screen.getByText('Book Three')).toBeInTheDocument()
  })

  it('renders all 9 lifecycle columns even with zero projects', () => {
    render(<LifecyclePipelineBoard projects={[]} />)
    ;['draft', 'content_complete', 'rights_cleared', 'assembled', 'qa_approved', 'submission_ready', 'submitted', 'live', 'archived']
      .forEach((state) => expect(screen.getByTestId(`lifecycle-column-${state}`)).toBeInTheDocument())
  })

  it('treats an invalid/unknown lifecycleState value as draft', () => {
    const projects: LifecyclePipelineProject[] = [
      { id: 'p4', title: 'Book Four', lifecycleState: 'not-a-real-state' },
    ]
    render(<LifecyclePipelineBoard projects={projects} />)
    expect(screen.getByTestId('lifecycle-column-draft')).toHaveTextContent('draft (1)')
    expect(screen.getByText('Book Four')).toBeInTheDocument()
  })

  it('falls back to "Untitled book project" when a project has no title', () => {
    const projects: LifecyclePipelineProject[] = [{ id: 'p5', lifecycleState: 'live' }]
    render(<LifecyclePipelineBoard projects={projects} />)
    expect(screen.getByText('Untitled book project')).toBeInTheDocument()
  })
})

describe('AdminBookStudioGovernanceWorkspace lifecycle pipeline data', () => {
  function mockFetch() {
    return jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/organizations') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: [{ id: 'org-1', slug: 'partners-in-biz', name: 'Partners in Biz' }] }),
        } as Response)
      }
      if (url === '/api/v1/organizations/org-1') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { settings: {} } }),
        } as Response)
      }
      if (url.startsWith('/api/v1/book-studio/projects?')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              resource: 'projects',
              records: [
                { id: 'book-1', title: 'Proof-led growth handbook', lifecycleState: 'rights_cleared' },
                { id: 'book-2', title: 'Untitled Draft Book', lifecycleState: 'draft' },
              ],
            },
          }),
        } as Response)
      }
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response)
    })
  }

  it('fetches book projects for the org and renders them in the matching lifecycle columns', async () => {
    const fetchMock = mockFetch()
    global.fetch = fetchMock as typeof fetch

    render(<AdminBookStudioGovernanceWorkspace orgSlug="partners-in-biz" />)

    await waitFor(() => {
      expect(screen.getByText('Proof-led growth handbook')).toBeInTheDocument()
    })

    expect(screen.getByTestId('lifecycle-column-rights_cleared')).toHaveTextContent('Proof-led growth handbook')
    expect(screen.getByTestId('lifecycle-column-draft')).toHaveTextContent('Untitled Draft Book')

    const calledProjectsEndpoint = fetchMock.mock.calls.some(([url]) => String(url).startsWith('/api/v1/book-studio/projects?'))
    expect(calledProjectsEndpoint).toBe(true)
  })
})
