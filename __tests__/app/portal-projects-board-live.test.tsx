import React from 'react'
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react'
import ProjectsPage from '@/app/(portal)/portal/projects/page'

let mockSearchParams = new URLSearchParams()

jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}))

jest.mock('@/components/projects/CrossProjectBoard', () => ({
  CrossProjectBoard: ({ tasks, loading }: { tasks: Array<{ id: string; title: string; projectName?: string }>; loading: boolean }) => (
    <div data-testid="cross-project-board" data-loading={loading ? 'true' : 'false'}>
      {tasks.map(task => <div key={task.id}>{task.title} — {task.projectName}</div>)}
    </div>
  ),
}))

describe('Portal projects board live data', () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams()
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/projects?view=received') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: [{ id: 'project-1', name: 'Launch Site', status: 'development' }] }),
        } as Response)
      }
      if (url === '/api/v1/projects/project-1/tasks') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: [{ id: 'task-api-1', title: 'Task from project API', columnId: 'todo', order: 1 }],
          }),
        } as Response)
      }
      if (url === '/api/v1/projects/reporting') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              summary: { totalProjects: 1, openTasks: 3, blockedTasks: 0, waitingApprovals: 1, highRisks: 0, trackedRevenue: 12000, currency: 'ZAR' },
              clients: [{ clientOrgId: 'client-org', companyId: 'company-client', clientName: 'Client workspace', projectCount: 1, trackedRevenue: 12000, openTasks: 3, blockedTasks: 0, highRisks: 0 }],
              people: [{ uid: 'contact-1', name: 'Client Contact', assignedTasks: 2, estimateMinutes: 180, capacityMinutes: 360, utilizationPercent: 50, overCapacity: false }],
              projects: [{ id: 'project-1', name: 'Launch Site', companyId: 'company-client', status: 'development', health: { status: 'healthy', score: 92 }, timeline: { driftCount: 0, dependencyCount: 1 }, reports: { tasks: { open: 3, blocked: 0 }, risks: { high: 0 }, revenue: { trackedAmount: 12000, currency: 'ZAR' } } }],
            },
          }),
        } as Response)
      }
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response)
    }) as jest.Mock
  })

  it('shows portfolio reporting in the client project workspace', async () => {
    render(<ProjectsPage />)

    await waitFor(() => expect(screen.getByRole('tab', { name: /portfolio report/i })).toBeInTheDocument())
    expect(screen.getByRole('tab', { name: /^projects$/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: /request project/i })).toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalledWith('/api/v1/projects/reporting', expect.any(Object))

    fireEvent.click(screen.getByRole('tab', { name: /portfolio report/i }))

    expect(global.fetch).toHaveBeenCalledWith('/api/v1/projects/reporting', expect.any(Object))
    await waitFor(() => expect(screen.getByText('Client workspace')).toBeInTheDocument())
    expect(screen.getByText('Client Contact')).toBeInTheDocument()
    expect(screen.getByText('Approvals')).toBeInTheDocument()
    expect(screen.getByText('Client or internal decisions waiting.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open company Client workspace' })).toHaveAttribute('href', '/portal/companies/company-client')
    expect(screen.getByRole('link', { name: 'Open project Launch Site' })).toHaveAttribute('href', '/portal/projects/project-1')
  })

  it('loads projects for the company-scoped portal org when opened from CRM workspace', async () => {
    mockSearchParams = new URLSearchParams({ orgId: 'lumen-org', orgSlug: 'lumen-speeds' })
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/projects?view=received&orgId=lumen-org') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: [{ id: 'lumen-project', name: 'Lumen website', status: 'development' }] }),
        } as Response)
      }
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response)
    }) as jest.Mock

    render(<ProjectsPage />)

    await waitFor(() => expect(screen.getByText('Lumen website')).toBeInTheDocument())
    expect(global.fetch).toHaveBeenCalledWith('/api/v1/projects?view=received&orgId=lumen-org')
  })

  it('loads the cross-project kanban board through the scoped project task API', async () => {
    render(<ProjectsPage />)

    await waitFor(() => expect(screen.getByRole('button', { name: /board/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /board/i }))

    expect(await screen.findByText('Task from project API — Launch Site')).toBeInTheDocument()
    expect(global.fetch).toHaveBeenCalledWith('/api/v1/projects/project-1/tasks')
    await waitFor(() => expect(screen.getByRole('button', { name: /manual order/i })).toBeInTheDocument())
    const boardButton = screen.getByRole('button', { name: /view_kanban\s+board/i })
    const manualOrderButton = screen.getByRole('button', { name: /manual order/i })
    const toolbar = boardButton.parentElement?.parentElement
    expect(toolbar).toHaveClass('justify-between')
    expect(toolbar).toHaveClass('gap-3')
    expect(toolbar).toContainElement(manualOrderButton)
  })

  it('loads completed project history separately from the active portal workspace', async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/projects?view=received') {
        return Promise.resolve({ ok: true, json: async () => ({ data: [{ id: 'project-1', name: 'Active Launch', status: 'development' }] }) } as Response)
      }
      if (url === '/api/v1/projects?view=received&archive=only') {
        return Promise.resolve({ ok: true, json: async () => ({ data: [{ id: 'project-done', name: 'Signed Off Launch', status: 'completed' }] }) } as Response)
      }
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response)
    }) as jest.Mock

    render(<ProjectsPage />)
    await waitFor(() => expect(screen.getByText('Active Launch')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('tab', { name: /archive/i }))

    expect(global.fetch).toHaveBeenCalledWith('/api/v1/projects?view=received&archive=only')
    await waitFor(() => expect(screen.getByText('Signed Off Launch')).toBeInTheDocument())
    expect(screen.queryByText('Active Launch')).not.toBeInTheDocument()
  })

  it('renders a task after an in-flight API refresh completes', async () => {
    let resolveTasks: (response: Response) => void = () => {}
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/projects?view=received') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: [{ id: 'project-1', name: 'Launch Site', status: 'development' }] }),
        } as Response)
      }
      if (url === '/api/v1/projects/project-1/tasks') {
        return new Promise<Response>(resolve => { resolveTasks = resolve })
      }
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response)
    }) as jest.Mock

    render(<ProjectsPage />)

    await waitFor(() => expect(screen.getByRole('button', { name: /board/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /board/i }))

    await act(async () => {
      resolveTasks({
        ok: true,
        json: async () => ({
          data: [{ id: 'task-rest-1', title: 'Task after refresh', columnId: 'todo', order: 1 }],
        }),
      } as Response)
    })

    expect(await screen.findByText('Task after refresh — Launch Site')).toBeInTheDocument()
  })
})
