import { projectRoutineActivity } from '@/lib/chat-context/adapters/project'

it('maps routine project task states into generic context activity', () => {
  const tasks = [
    { id: 'run', title: 'Draft copy', state: 'running', updatedAt: '2026-07-13T08:00:00Z' },
    { id: 'wait', title: 'Wait for review', state: 'waiting', updatedAt: '2026-07-13T08:01:00Z' },
    { id: 'done', title: 'Published', state: 'complete', updatedAt: '2026-07-13T08:02:00Z' },
  ]
  expect(projectRoutineActivity(tasks as never)).toEqual([
    expect.objectContaining({ id: 'project-task:run', type: 'running', label: 'Draft copy' }),
    expect.objectContaining({ id: 'project-task:wait', type: 'waiting', label: 'Wait for review' }),
  ])
})
