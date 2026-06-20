import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ProjectDetailWorkspace } from '@/components/projects/ProjectDetailWorkspace'

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))

jest.mock('firebase/firestore', () => ({
  collection: jest.fn((...segments: string[]) => segments),
  onSnapshot: jest.fn(() => jest.fn()),
}))

jest.mock('@/lib/firebase/config', () => ({
  getClientDb: jest.fn(() => ({})),
}))

jest.mock('@/components/kanban/KanbanBoard', () => ({
  KanbanBoard: ({ tasks, onAddTask, onTaskClick }: { tasks?: Array<{ id: string; title: string }>; onAddTask: (columnId: string) => void; onTaskClick?: (task: unknown) => void }) => (
    <div>
      <button type="button" onClick={() => onAddTask('todo')}>Mock add task</button>
      {tasks?.map((task) => (
        <button key={task.id} type="button" onClick={() => onTaskClick?.(task)}>{task.title}</button>
      ))}
    </div>
  ),
}))

jest.mock('@/components/kanban/TaskDetailPanel', () => ({
  TaskDetailPanel: ({ task, onUpdate }: { task: { id: string; approvalStatus?: string } | null; onUpdate: (taskId: string, updates: Record<string, unknown>) => Promise<void> }) => task ? (
    <div data-testid="task-detail-panel">
      <span>Approval status: {task.approvalStatus ?? 'none'}</span>
      <button type="button" onClick={() => onUpdate(task.id, { approvalStatus: 'approved', columnId: 'done', reviewStatus: 'approved' }).catch(() => undefined)}>Attempt approval</button>
    </div>
  ) : null,
}))

jest.mock('@/components/kanban/TaskComposer', () => ({
  TaskComposer: ({ open, hideAgentSection }: { open: boolean; hideAgentSection?: boolean }) => open ? (
    <div data-testid="task-composer-agent-visibility">
      {hideAgentSection ? 'agents hidden' : 'agents visible'}
    </div>
  ) : null,
}))

jest.mock('@/components/chat/UnifiedChat', () => ({
  __esModule: true,
  default: () => <div data-testid="unified-chat" />,
}))

const jsonResponse = (data: unknown) => Promise.resolve({ ok: true, json: async () => data } as Response)

describe('ProjectDetailWorkspace portal agent assignment', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/auth/verify') {
        return jsonResponse({ uid: 'super-admin-1', email: 'peet@partnersinbiz.online', role: 'admin', isSuperAdmin: true })
      }
      if (url === '/api/v1/projects/project-1') {
        return jsonResponse({ data: { id: 'project-1', orgId: 'org-acme', name: 'Client Website', status: 'active', columns: [] } })
      }
      if (url === '/api/v1/projects/project-1/docs') return jsonResponse({ data: [] })
      if (url === '/api/v1/projects/project-1/tasks') return jsonResponse({ data: [] })
      if (url === '/api/v1/organizations/org-acme/members') return jsonResponse({ data: [] })
      if (url === '/api/v1/projects/project-1/access') return jsonResponse({ data: { members: [] } })
      if (url === '/api/v1/orgs/org-acme/visible-agents') {
        return jsonResponse({ data: [{ agentId: 'theo', name: 'Theo', enabled: true }] })
      }
      return jsonResponse({ data: [] })
    }) as jest.Mock
  })

  it('keeps agent assignment available when a platform admin creates a task from the client portal', async () => {
    render(<ProjectDetailWorkspace mode="portal" projectId="project-1" orgScope={{ orgSlug: 'acme' }} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Mock add task' }))

    await waitFor(() => {
      expect(screen.getByTestId('task-composer-agent-visibility')).toHaveTextContent('agents visible')
    })
  })

  it('does not keep false local approval state when a task PATCH is rejected', async () => {
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/auth/verify') {
        return jsonResponse({ uid: 'client-1', email: 'client@example.com', role: 'client', isSuperAdmin: false })
      }
      if (url === '/api/v1/projects/project-1') {
        return jsonResponse({ data: { id: 'project-1', orgId: 'org-acme', name: 'Client Website', status: 'active', columns: [] } })
      }
      if (url === '/api/v1/projects/project-1/docs') return jsonResponse({ data: [] })
      if (url === '/api/v1/projects/project-1/tasks' && !init) {
        return jsonResponse({ data: [{ id: 'task-1', title: 'Approval gate', columnId: 'review', order: 1, labels: ['approval-gate'], approvalStatus: 'pending' }] })
      }
      if (url === '/api/v1/projects/project-1/tasks/task-1' && init?.method === 'PATCH') {
        return Promise.resolve({ ok: false, status: 403, json: async () => ({ success: false, error: 'Only an admin approver can change approvalStatus on project tasks' }) } as Response)
      }
      if (url === '/api/v1/organizations/org-acme/members') return jsonResponse({ data: [] })
      if (url === '/api/v1/projects/project-1/access') return jsonResponse({ data: { members: [] } })
      if (url === '/api/v1/orgs/org-acme/visible-agents') return jsonResponse({ data: [] })
      return jsonResponse({ data: [] })
    }) as jest.Mock

    render(<ProjectDetailWorkspace mode="portal" projectId="project-1" orgScope={{ orgSlug: 'acme' }} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Approval gate' }))
    expect(await screen.findByText('Approval status: pending')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Attempt approval' }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/v1/projects/project-1/tasks/task-1', expect.objectContaining({ method: 'PATCH' })))
    expect(screen.getByText('Approval status: pending')).toBeInTheDocument()
    expect(screen.queryByText('Approval status: approved')).not.toBeInTheDocument()
  })
})
