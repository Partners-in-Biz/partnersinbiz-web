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
  KanbanBoard: ({ onAddTask }: { onAddTask: (columnId: string) => void }) => (
    <button type="button" onClick={() => onAddTask('todo')}>Mock add task</button>
  ),
}))

jest.mock('@/components/kanban/TaskDetailPanel', () => ({
  TaskDetailPanel: () => <div data-testid="task-detail-panel" />,
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
})
