import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TaskComposer } from '@/components/kanban/TaskComposer'

jest.mock('@/components/chat/VoiceInputButton', () => ({
  __esModule: true,
  default: () => <button type="button" aria-label="Dictate task description">Mock mic</button>,
}))

const contextRef = {
  type: 'contact',
  id: 'contact-1',
  orgId: 'org-1',
  label: 'Jane Client',
  origin: 'mention',
  href: '/admin/crm/contacts/contact-1',
  summary: 'email: jane@example.com',
}

beforeEach(() => {
  jest.clearAllMocks()
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.startsWith('/api/v1/context-references/search')) {
      return {
        ok: true,
        json: async () => ({ success: true, data: { refs: [contextRef] } }),
      } as Response
    }
    if (url === '/api/v1/projects/project-1/tasks' && init?.method === 'POST') {
      return {
        ok: true,
        json: async () => ({ success: true, data: { id: 'task-1' } }),
      } as Response
    }
    throw new Error(`Unexpected fetch ${url}`)
  })
})

describe('TaskComposer context references', () => {
  it('attaches selected context refs to the created task payload', async () => {
    const onCreated = jest.fn()
    render(
      <TaskComposer
        open
        column={{ id: 'todo', name: 'To do', color: '#60a5fa', order: 1 }}
        projectId="project-1"
        orgId="org-1"
        members={[]}
        agents={[]}
        existingTasks={[]}
        onClose={jest.fn()}
        onCreated={onCreated}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText('Task title'), { target: { value: 'Follow up with Jane' } })
    fireEvent.change(screen.getByLabelText('Add task context reference'), {
      target: { value: '@contacts:jane' },
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Attach Jane Client' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/v1/projects/project-1/tasks',
      expect.objectContaining({ method: 'POST' }),
    ))
    const createCall = (global.fetch as jest.Mock).mock.calls.find(([url]) => url === '/api/v1/projects/project-1/tasks')
    expect(JSON.parse(createCall[1].body)).toEqual(expect.objectContaining({
      contextRefs: [expect.objectContaining({ type: 'contact', id: 'contact-1', label: 'Jane Client' })],
    }))
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({
      contextRefs: [expect.objectContaining({ type: 'contact', id: 'contact-1' })],
    }))
  })
})
