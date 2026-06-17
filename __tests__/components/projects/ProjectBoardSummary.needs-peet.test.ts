import { getProjectBoardSummary } from '@/components/projects/ProjectBoardSummary'
import type { Task } from '@/components/kanban/types'

describe('ProjectBoardSummary Needs Peet visibility', () => {
  it('labels blocked awaiting-input agent work as Needs Peet instead of silent blocked work', () => {
    const summary = getProjectBoardSummary([
      { id: 'task-1', title: 'Waiting on approval', columnId: 'blocked', agentStatus: 'awaiting-input', order: 1 } as Task,
      { id: 'task-2', title: 'Implementation', columnId: 'in_progress', agentStatus: 'in-progress', order: 2 } as Task,
    ])

    expect(summary.blocked).toBe(1)
    expect(summary.stats).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'blocked', label: 'Needs Peet', helper: expect.stringContaining('approval/input') }),
    ]))
  })
})
