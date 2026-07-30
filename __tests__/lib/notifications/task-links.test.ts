import {
  buildTaskNotificationLink,
  extractTaskIdFromNotificationLink,
  preferTaskNotificationHref,
  portalProjectTaskLink,
} from '@/lib/notifications/task-links'

describe('task notification links', () => {
  it('builds a portal project task deep-link', () => {
    expect(portalProjectTaskLink('project-1', 'task-1')).toBe(
      '/portal/projects/project-1?taskId=task-1',
    )
    expect(buildTaskNotificationLink({ taskId: 'task-1', projectId: 'project-1' })).toBe(
      '/portal/projects/project-1?taskId=task-1',
    )
  })

  it('falls back to a resolvable list link when there is no project', () => {
    expect(buildTaskNotificationLink({ taskId: 'task-9' })).toBe(
      '/portal/projects?taskId=task-9',
    )
  })

  it('builds admin project and agent-board destinations', () => {
    expect(buildTaskNotificationLink({
      taskId: 'task-1',
      projectId: 'project-1',
      surface: 'admin',
      orgSlug: 'partners-in-biz',
    })).toBe('/admin/org/partners-in-biz/projects/project-1?taskId=task-1')

    expect(buildTaskNotificationLink({
      taskId: 'task-1',
      surface: 'admin',
      orgSlug: 'partners-in-biz',
    })).toBe('/admin/org/partners-in-biz/agent/board?taskId=task-1')
  })

  it('extracts task ids from legacy list links', () => {
    expect(extractTaskIdFromNotificationLink('/portal/projects?task=abc')).toBe('abc')
    expect(extractTaskIdFromNotificationLink('/portal/projects?taskId=xyz')).toBe('xyz')
    expect(extractTaskIdFromNotificationLink('/portal/projects/project-1?taskId=t1')).toBeNull()
  })

  it('prefers structured data over a bad legacy list link', () => {
    expect(preferTaskNotificationHref({
      link: '/portal/projects?task=old',
      data: { taskId: 'task-1', projectId: 'project-1' },
    })).toBe('/portal/projects/project-1?taskId=task-1')
  })

  it('normalises portal project paths that still use ?task=', () => {
    expect(preferTaskNotificationHref({
      link: '/portal/projects/project-1?task=task-1',
    })).toBe('/portal/projects/project-1?taskId=task-1')
  })
})
