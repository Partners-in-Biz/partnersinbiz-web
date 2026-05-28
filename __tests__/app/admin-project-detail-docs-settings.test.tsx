import React from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import ProjectDetailPage from '@/app/(admin)/admin/org/[slug]/projects/[projectId]/page'

let snapshotCallback: ((snap: { docChanges: () => Array<{ type: 'added' | 'modified' | 'removed'; doc: { id: string; data: () => Record<string, unknown> } }> }) => void) | null = null
const unsubscribe = jest.fn()

jest.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'acme-client', projectId: 'project-1' }),
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => ({ get: jest.fn(() => null) }),
}))

jest.mock('firebase/firestore', () => ({
  collection: jest.fn((...segments: string[]) => segments),
  onSnapshot: jest.fn((_ref, onNext) => {
    snapshotCallback = onNext
    return unsubscribe
  }),
}))

jest.mock('@/lib/firebase/config', () => ({
  getClientDb: jest.fn(() => ({})),
}))

jest.mock('@/components/kanban/KanbanBoard', () => ({
  KanbanBoard: ({ tasks }: { tasks: Array<{ id: string; title: string; columnId?: string }> }) => (
    <div data-testid="kanban-board">
      {tasks.map(task => <div key={`${task.id}-${task.columnId ?? 'none'}`} data-testid="kanban-task">{task.title}</div>)}
    </div>
  ),
}))

jest.mock('@/components/kanban/TaskDetailPanel', () => ({
  TaskDetailPanel: () => <div data-testid="task-detail-panel" />,
}))

jest.mock('@/components/kanban/TaskComposer', () => ({
  TaskComposer: ({ open, onCreated }: { open: boolean; onCreated: (task: { id: string; title: string; columnId: string; order: number }) => void }) => open ? (
    <button
      type="button"
      data-testid="task-composer"
      onClick={() => onCreated({ id: 'task-live-duplicate', title: 'Live-created task', columnId: 'todo', order: 1 })}
    >
      Mock create task
    </button>
  ) : null,
}))

jest.mock('@/components/hermes/Chat', () => ({
  __esModule: true,
  default: () => <div data-testid="agent-chat" />,
}))

const longDocContent = `Intro ${'context '.repeat(40)}Unique full ending`


function mockSnapshotChange(type: 'added' | 'modified' | 'removed', id: string, data: Record<string, unknown>) {
  act(() => {
    snapshotCallback?.({
      docChanges: () => [
        {
          type,
          doc: { id, data: () => data },
        },
      ],
    })
  })
}

function mockFetch() {
  global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url === '/api/v1/projects/project-1') {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          data: {
            id: 'project-1',
            orgId: 'org-acme',
            name: 'Client Website',
            description: 'Initial board description',
            brief: 'Existing project brief',
            status: 'development',
            columns: [],
          },
        }),
      } as Response)
    }
    if (url === '/api/v1/projects/project-1/docs') {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          data: [
            {
              id: 'doc-1',
              title: 'Delivery Plan',
              content: longDocContent,
              type: 'requirements',
              createdBy: 'theo',
              updatedAt: '2026-05-22T10:00:00.000Z',
            },
            {
              id: 'doc-legacy-empty',
              title: 'Legacy Empty Doc',
              type: 'notes',
              createdBy: 'theo',
              updatedAt: '2026-05-22T11:00:00.000Z',
            },
          ],
        }),
      } as Response)
    }
    if (url === '/api/v1/projects/project-1/tasks') {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          data: [
            {
              id: 'task-1',
              title: 'Tighten mobile project board',
              columnId: 'todo',
              order: 1,
              priority: 'high',
              dueDate: '2026-05-25T00:00:00.000Z',
              createdAt: '2026-05-20T09:00:00.000Z',
              estimateMinutes: 45,
              assigneeIds: [],
              attachments: [{ id: 'file-1' }],
            },
            {
              id: 'task-2',
              title: 'Latest task should float up',
              columnId: 'review',
              agentStatus: 'done',
              order: 2,
              priority: 'medium',
              dueDate: '2026-06-01T00:00:00.000Z',
              createdAt: '2026-05-23T09:00:00.000Z',
              estimateMinutes: 30,
              assigneeIds: [],
              attachments: [],
            },
            {
              id: 'task-3',
              title: 'Resolve production blocker',
              columnId: 'blocked',
              order: 3,
              priority: 'high',
              createdAt: '2026-05-24T09:00:00.000Z',
              assigneeIds: [],
              attachments: [],
            },
            {
              id: 'task-4',
              title: 'Completed task with stale blocked label',
              columnId: 'done',
              order: 4,
              priority: 'medium',
              createdAt: '2026-05-24T10:00:00.000Z',
              labels: ['blocked'],
              assigneeIds: [],
              attachments: [],
            },
          ],
        }),
      } as Response)
    }
    if (url === '/api/v1/projects/project-1/access') {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          data: {
            members: [
              { id: 'project-1_owner-1', uid: 'owner-1', displayName: 'Peet Stander', role: 'owner', status: 'active' },
            ],
            memberCandidates: [
              { uid: 'team-2', displayName: 'Taylor Team', email: 'taylor@partners.example', role: 'member' },
            ],
            organizations: [
              { id: 'project-1_partner-org', recipientCompanyName: 'Partner Org', role: 'reviewer', status: 'active' },
            ],
            invites: [
              { id: 'project-1_pending', recipientEmail: 'pending@example.com', status: 'pending' },
            ],
          },
        }),
      } as Response)
    }
    if (url === '/api/v1/projects/project-1/suite') {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          data: {
            health: { level: 'at_risk', score: 52, blockedTasks: 1, overdueTasks: 2, waitingApprovals: 1, milestoneDrift: 1 },
            milestones: [{ id: 'milestone-1', title: 'Launch readiness', dueDate: '2026-06-01', status: 'active' }],
            approvals: [{ id: 'approval-1', title: 'Homepage approval', status: 'pending' }],
            risks: [{ id: 'risk-1', title: 'Scope drift', severity: 'high', status: 'open' }],
            decisions: [{ id: 'decision-1', title: 'Use staged launch', status: 'accepted' }],
            baselines: [{ id: 'baseline-1', title: 'Website launch baseline', status: 'active' }],
            playbooks: [{ id: 'playbook-1', title: 'Weekly client report', status: 'active' }],
            automations: [{ id: 'automation-1', title: 'Notify when milestone slips', status: 'active' }],
            permissions: [{ id: 'permission-1', title: 'Client-visible tasks only', visibility: 'external' }],
            audit: [{ id: 'audit-1', title: 'Project created', actorName: 'Peet Stander', createdAt: '2026-05-20T09:00:00.000Z' }],
            notificationSettings: [{ id: 'notification-1', title: 'Approval reminders', channel: 'email', status: 'active' }],
            timeline: {
              driftCount: 1,
              items: [
                { id: 'timeline-1', kind: 'milestone', title: 'Design sprint', startDate: '2026-05-20', dueDate: '2026-06-01', baselineDriftDays: 4, dependencies: ['task-1'] },
              ],
            },
            workload: {
              assignees: [
                { uid: 'owner-1', name: 'Peet Stander', assignedTasks: 2, estimateMinutes: 75, capacityMinutes: 300, utilizationPercent: 25 },
              ],
            },
            reports: {
              tasks: { total: 4, done: 2, blocked: 1, overdue: 2 },
              approvals: { waiting: 1 },
              revenue: { trackedAmount: 12000, currency: 'ZAR' },
            },
          },
        }),
      } as Response)
    }
    if (url === '/api/v1/crm/companies?search=partner&limit=8') {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          data: {
            companies: [
              { id: 'company-1', name: 'Partner Org', email: 'hello@partner.example' },
            ],
          },
        }),
      } as Response)
    }
    if (url === '/api/v1/crm/companies?search=New%20Partner&limit=8') {
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: { companies: [] } }),
      } as Response)
    }
    if (url === '/api/v1/crm/companies' && method === 'POST') {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          data: {
            company: { id: 'company-new', name: 'New Partner' },
          },
        }),
      } as Response)
    }
    if (url === '/api/v1/crm/companies/company-1/contacts?limit=20') {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          data: {
            contacts: [
              { id: 'contact-1', name: 'Priya Contact', email: 'priya@partner.example' },
            ],
          },
        }),
      } as Response)
    }
    if (url === '/api/v1/crm/companies/company-new/contacts?limit=20') {
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: { contacts: [] } }),
      } as Response)
    }
    if (url === '/api/v1/crm/contacts' && method === 'POST') {
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: { id: 'contact-new' } }),
      } as Response)
    }
    return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response)
  }) as jest.Mock
}

describe('Admin project docs and settings tabs', () => {
  beforeEach(() => {
    snapshotCallback = null
    unsubscribe.mockClear()
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: jest.fn().mockImplementation(query => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      })),
    })
    mockFetch()
  })

  it('opens a document preview when an admin clicks a project doc', async () => {
    render(<ProjectDetailPage />)

    fireEvent.click(screen.getByRole('tab', { name: 'Docs' }))

    await waitFor(() => expect(screen.getByText('Delivery Plan')).toBeInTheDocument())
    expect(screen.getByText('Legacy Empty Doc')).toBeInTheDocument()
    expect(screen.getByText('No preview content yet.')).toBeInTheDocument()
    expect(screen.getByText('Select a document')).toBeInTheDocument()
    expect(screen.queryByText(/Unique full ending/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Preview Delivery Plan' }))

    expect(screen.getByText(/Unique full ending/)).toBeInTheDocument()
  })

  it('renders settings with the refreshed board-style surface', async () => {
    render(<ProjectDetailPage />)

    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }))

    await waitFor(() => expect(screen.getByText('Manage this board')).toBeInTheDocument())
    expect(screen.getByLabelText('Project Name')).toHaveValue('Client Website')
    expect(screen.getByText('Current board')).toBeInTheDocument()
  })

  it('shows project People & Access controls in settings', async () => {
    render(<ProjectDetailPage />)

    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }))

    await waitFor(() => expect(screen.getByText('People & Access')).toBeInTheDocument())
    expect(screen.getByText('Internal members')).toBeInTheDocument()
    expect(screen.getByText('External organisations')).toBeInTheDocument()
    expect(screen.getByText('Access audit')).toBeInTheDocument()
    expect(screen.getAllByText('Peet Stander').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Partner Org').length).toBeGreaterThan(0)
    expect(screen.getByText('pending@example.com')).toBeInTheDocument()
  })

  it('adds internal project members from a searchable team picker instead of raw user IDs', async () => {
    render(<ProjectDetailPage />)

    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }))

    await waitFor(() => expect(screen.getByLabelText('Search team member')).toBeInTheDocument())
    expect(screen.queryByLabelText('Member user ID')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Search team member'), { target: { value: 'taylor' } })
    fireEvent.click(screen.getByRole('button', { name: 'Select Taylor Team' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add member' }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/v1/projects/project-1/access',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ action: 'add_member', uid: 'team-2', role: 'contributor' }),
      }),
    ))
  })

  it('searches CRM companies and contacts when inviting external organisations', async () => {
    render(<ProjectDetailPage />)

    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }))

    await waitFor(() => expect(screen.getByLabelText('Search CRM company')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Search CRM company'), { target: { value: 'partner' } })

    await waitFor(() => expect(screen.getByRole('button', { name: 'Select Partner Org' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Select Partner Org' }))

    await waitFor(() => expect(screen.getByText('Priya Contact')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Select Priya Contact' }))

    expect(screen.getByText('Selected company: Partner Org')).toBeInTheDocument()
    expect(screen.getByText('Selected contact: Priya Contact')).toBeInTheDocument()
  })

  it('creates missing CRM companies and contacts before inviting an external organisation', async () => {
    render(<ProjectDetailPage />)

    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }))

    await waitFor(() => expect(screen.getByLabelText('Search CRM company')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Search CRM company'), { target: { value: 'New Partner' } })

    await waitFor(() => expect(screen.getByRole('button', { name: 'Create CRM company' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Create CRM company' }))

    await waitFor(() => expect(screen.getByText('Selected company: New Partner')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('New contact name'), { target: { value: 'Nova Buyer' } })
    fireEvent.change(screen.getByLabelText('New contact email'), { target: { value: 'nova@newpartner.example' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create contact' }))

    await waitFor(() => expect(screen.getByText('Selected contact: Nova Buyer')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Invite' }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/v1/projects/project-1/access',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          action: 'invite_organizations',
          invites: [{ companyId: 'company-new', contactId: 'contact-new', role: 'reviewer' }],
        }),
      }),
    ))
    expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/companies', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ name: 'New Partner' }),
    }))
    expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/contacts', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        name: 'Nova Buyer',
        email: 'nova@newpartner.example',
        companyId: 'company-new',
        company: 'New Partner',
        source: 'manual',
        type: 'prospect',
        stage: 'new',
      }),
    }))
  })

  it('shows project health, timeline, workload, automations, controls, and reports in the Plan tab', async () => {
    render(<ProjectDetailPage />)

    fireEvent.click(screen.getByRole('tab', { name: 'Plan' }))

    await waitFor(() => expect(screen.getByText('Project health')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByText('52')).toBeInTheDocument())
    expect(screen.getByText('Launch readiness')).toBeInTheDocument()
    expect(screen.getByText('Homepage approval')).toBeInTheDocument()
    expect(screen.getByText('Scope drift')).toBeInTheDocument()
    expect(screen.getByText('Use staged launch')).toBeInTheDocument()
    expect(screen.getByText('Timeline')).toBeInTheDocument()
    expect(screen.getByText('Baseline drift')).toBeInTheDocument()
    expect(screen.getAllByText('Design sprint').length).toBeGreaterThan(0)
    expect(screen.getByText('Website launch baseline')).toBeInTheDocument()
    expect(screen.getByText('Workload')).toBeInTheDocument()
    expect(screen.getByText('Capacity')).toBeInTheDocument()
    expect(screen.getAllByText('Peet Stander').length).toBeGreaterThan(0)
    expect(screen.getByText('Project reports')).toBeInTheDocument()
    expect(screen.getByText('Revenue')).toBeInTheDocument()
    expect(screen.getByText('ZAR 12,000')).toBeInTheDocument()
    expect(screen.getByText('Playbooks')).toBeInTheDocument()
    expect(screen.getByText('Weekly client report')).toBeInTheDocument()
    expect(screen.getByText('Automations')).toBeInTheDocument()
    expect(screen.getByText('Notify when milestone slips')).toBeInTheDocument()
    expect(screen.getByText('Access controls')).toBeInTheDocument()
    expect(screen.getByText('Client-visible tasks only')).toBeInTheDocument()
    expect(screen.getByText('Audit timeline')).toBeInTheDocument()
    expect(screen.getByText('Project created')).toBeInTheDocument()
    expect(screen.getByText('Notifications')).toBeInTheDocument()
    expect(screen.getByText('Approval reminders')).toBeInTheDocument()
  })

  it('shows the board-progress summary with done and active blocker counts', async () => {
    render(<ProjectDetailPage />)

    await waitFor(() => expect(screen.getByText('Resolve production blocker')).toBeInTheDocument())

    expect(screen.getAllByText('Actually done').length).toBeGreaterThan(0)
    expect(screen.getByLabelText('Done task progress')).toHaveTextContent('2 / 4')
    expect(screen.getByLabelText('Open task count')).toHaveTextContent('2')
    expect(screen.getByLabelText('Done task count')).toHaveTextContent('2')
    expect(screen.getByLabelText('Blocked task count')).toHaveTextContent('1')
    expect(screen.queryByText('Done / blocked')).not.toBeInTheDocument()
  })

  it('keeps project tabs visually consistent without a lone agent icon', async () => {
    render(<ProjectDetailPage />)

    const tabBar = screen.getByRole('tab', { name: 'Kanban' }).parentElement
    expect(tabBar).toContainElement(screen.getByRole('tab', { name: 'Plan' }))
    expect(tabBar).toContainElement(screen.getByRole('tab', { name: 'Docs' }))
    expect(tabBar).toContainElement(screen.getByRole('tab', { name: 'Agent' }))
    expect(tabBar).toContainElement(screen.getByRole('tab', { name: 'Settings' }))
    expect(within(tabBar as HTMLElement).queryByText('smart_toy')).not.toBeInTheDocument()
  })

  it('keeps board/list and board sort controls spaced on one toolbar row', async () => {
    render(<ProjectDetailPage />)

    await waitFor(() => expect(screen.getByText('Resolve production blocker')).toBeInTheDocument())

    const boardButton = screen.getByRole('button', { name: /view_kanban\s+board/i })
    const listButton = screen.getByRole('button', { name: /view_list\s+list/i })
    const toolbar = boardButton.parentElement?.parentElement
    const manualSort = screen.getByRole('button', { name: /manual order/i })
    expect(toolbar).toHaveClass('gap-3')
    expect(toolbar).toHaveClass('overflow-x-auto')
    expect(toolbar).toHaveClass('justify-between')
    expect(toolbar).toContainElement(manualSort)

    fireEvent.click(manualSort)
    expect(screen.getByRole('button', { name: /latest first/i })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(listButton)

    const latestSort = screen.getByRole('button', { name: /latest first/i })
    expect(toolbar).toContainElement(latestSort)
  })

  it('uses the compact mobile list instead of the wide board by default on phones', async () => {
    ;(window.matchMedia as jest.Mock).mockImplementation(query => ({
      matches: query === '(max-width: 767px)',
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }))

    render(<ProjectDetailPage />)

    await waitFor(() => expect(screen.getAllByText('Tighten mobile project board').length).toBeGreaterThan(0))
    expect(screen.queryByTestId('kanban-board')).not.toBeInTheDocument()
    expect(screen.getAllByText('Due').length).toBeGreaterThan(0)
  })

  it('keeps live kanban task changes that arrive before the REST fallback finishes', async () => {
    let resolveTasks: (response: Response) => void = () => {}
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/projects/project-1') {
        return Promise.resolve({ ok: true, json: async () => ({ data: { id: 'project-1', orgId: 'org-acme', name: 'Client Website', description: 'Initial board description', brief: 'Existing project brief', status: 'development', columns: [] } }) } as Response)
      }
      if (url === '/api/v1/projects/project-1/docs') {
        return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response)
      }
      if (url === '/api/v1/projects/project-1/tasks') {
        return new Promise<Response>(resolve => { resolveTasks = resolve })
      }
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response)
    }) as jest.Mock

    render(<ProjectDetailPage />)

    await waitFor(() => expect(snapshotCallback).toBeTruthy())
    mockSnapshotChange('added', 'task-live-1', {
      title: 'Live kanban task survives fallback',
      columnId: 'todo',
      order: 1,
    })

    await act(async () => {
      resolveTasks({ ok: true, json: async () => ({ data: [] }) } as Response)
    })

    expect(screen.getByText('Live kanban task survives fallback')).toBeInTheDocument()
  })

  it('deduplicates a created task when the Firestore listener wins the race before POST returns', async () => {
    render(<ProjectDetailPage />)

    await waitFor(() => expect(snapshotCallback).toBeTruthy())
    mockSnapshotChange('added', 'task-live-duplicate', {
      title: 'Live-created task',
      columnId: 'todo',
      order: 1,
    })

    fireEvent.click(screen.getByRole('button', { name: /New Task/i }))
    fireEvent.click(screen.getByTestId('task-composer'))

    await waitFor(() => {
      expect(screen.getAllByText('Live-created task')).toHaveLength(1)
    })
  })
  it('defaults task list sorting to latest first and can toggle back to due date', async () => {
    render(<ProjectDetailPage />)

    fireEvent.click(screen.getByRole('button', { name: /list/i }))

    await waitFor(() => expect(screen.getByRole('button', { name: /Latest first/i })).toHaveAttribute('aria-pressed', 'true'))
    await waitFor(() => expect(screen.getAllByText('Latest task should float up').length).toBeGreaterThan(0))
    const table = screen.getByRole('table')
    expect(within(table).getByText('Latest task should float up').compareDocumentPosition(within(table).getByText('Tighten mobile project board'))).toBe(Node.DOCUMENT_POSITION_FOLLOWING)

    fireEvent.click(screen.getByRole('button', { name: /Due date/i }))

    expect(screen.getByRole('button', { name: /Due date/i })).toHaveAttribute('aria-pressed', 'true')
    expect(within(table).getByText('Tighten mobile project board').compareDocumentPosition(within(table).getByText('Latest task should float up'))).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })


})
