import React from 'react'
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react'
import ProjectsPage from '@/app/(portal)/portal/projects/page'

let snapshotCallback: ((snap: { docChanges: () => Array<{ type: 'added' | 'modified' | 'removed'; doc: { id: string; data: () => Record<string, unknown> } }> }) => void) | null = null
const unsubscribe = jest.fn()

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

jest.mock('@/components/projects/CrossProjectBoard', () => ({
  CrossProjectBoard: ({ tasks, loading }: { tasks: Array<{ id: string; title: string; projectName?: string }>; loading: boolean }) => (
    <div data-testid="cross-project-board" data-loading={loading ? 'true' : 'false'}>
      {tasks.map(task => <div key={task.id}>{task.title} — {task.projectName}</div>)}
    </div>
  ),
}))

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

describe('Portal projects board live data', () => {
  beforeEach(() => {
    snapshotCallback = null
    unsubscribe.mockClear()
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/projects') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: [{ id: 'project-1', name: 'Launch Site', status: 'development' }] }),
        } as Response)
      }
      if (url === '/api/v1/projects/project-1/tasks') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: [] }),
        } as Response)
      }
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response)
    }) as jest.Mock
  })

  it('updates the cross-project kanban board when Firestore task snapshots change', async () => {
    render(<ProjectsPage />)

    await waitFor(() => expect(screen.getByRole('button', { name: /board/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /board/i }))

    await waitFor(() => expect(snapshotCallback).toBeTruthy())

    mockSnapshotChange('added', 'task-live-1', {
      title: 'Live task from Firestore',
      columnId: 'todo',
      order: 1,
      projectId: 'project-1',
    })

    expect(screen.getByText('Live task from Firestore — Launch Site')).toBeInTheDocument()
  })
})
