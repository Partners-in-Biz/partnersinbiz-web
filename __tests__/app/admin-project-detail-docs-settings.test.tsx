import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ProjectDetailPage from '@/app/(admin)/admin/org/[slug]/projects/[projectId]/page'

const unsubscribe = jest.fn()

jest.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'acme-client', projectId: 'project-1' }),
}))

jest.mock('firebase/firestore', () => ({
  collection: jest.fn((...segments: string[]) => segments),
  onSnapshot: jest.fn((_ref, _onNext, _onError) => unsubscribe),
}))

jest.mock('@/lib/firebase/config', () => ({
  getClientDb: jest.fn(() => ({})),
}))

jest.mock('@/components/kanban/KanbanBoard', () => ({
  KanbanBoard: () => <div data-testid="kanban-board" />,
}))

jest.mock('@/components/kanban/TaskDetailPanel', () => ({
  TaskDetailPanel: () => <div data-testid="task-detail-panel" />,
}))

jest.mock('@/components/kanban/TaskComposer', () => ({
  TaskComposer: () => <div data-testid="task-composer" />,
}))

jest.mock('@/components/hermes/Chat', () => ({
  __esModule: true,
  default: () => <div data-testid="agent-chat" />,
}))

const longDocContent = `Intro ${'context '.repeat(40)}Unique full ending`

function mockFetch() {
  global.fetch = jest.fn((input: RequestInfo | URL) => {
    const url = String(input)
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
              estimateMinutes: 45,
              assigneeIds: [],
              attachments: [{ id: 'file-1' }],
            },
          ],
        }),
      } as Response)
    }
    return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response)
  }) as jest.Mock
}

describe('Admin project docs and settings tabs', () => {
  beforeEach(() => {
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

    fireEvent.click(screen.getByRole('button', { name: 'Docs' }))

    await waitFor(() => expect(screen.getByText('Delivery Plan')).toBeInTheDocument())
    expect(screen.getByText('Select a document')).toBeInTheDocument()
    expect(screen.queryByText(/Unique full ending/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Preview Delivery Plan' }))

    expect(screen.getByText(/Unique full ending/)).toBeInTheDocument()
  })

  it('renders settings with the refreshed board-style surface', async () => {
    render(<ProjectDetailPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))

    await waitFor(() => expect(screen.getByText('Manage this board')).toBeInTheDocument())
    expect(screen.getByLabelText('Project Name')).toHaveValue('Client Website')
    expect(screen.getByText('Current board')).toBeInTheDocument()
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

})

