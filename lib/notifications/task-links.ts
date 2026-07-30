/**
 * Task notification deep-links.
 *
 * Project-nested tasks open the project workspace task drawer:
 *   /portal/projects/{projectId}?taskId={taskId}
 *
 * Standalone tasks (no project) open the agent board when we know the org slug,
 * otherwise fall back to the projects list with a taskId query the list page can resolve.
 */

export type TaskNotificationSurface = 'portal' | 'admin'

export function portalProjectTaskLink(projectId: string, taskId: string): string {
  return `/portal/projects/${encodeURIComponent(projectId)}?taskId=${encodeURIComponent(taskId)}`
}

export function adminProjectTaskPath(orgSlug: string, projectId: string, taskId: string): string {
  return `/admin/org/${encodeURIComponent(orgSlug)}/projects/${encodeURIComponent(projectId)}?taskId=${encodeURIComponent(taskId)}`
}

export function adminAgentBoardTaskPath(orgSlug: string, taskId: string): string {
  return `/admin/org/${encodeURIComponent(orgSlug)}/agent/board?taskId=${encodeURIComponent(taskId)}`
}

export function buildTaskNotificationLink(args: {
  taskId: string
  projectId?: string | null
  surface?: TaskNotificationSurface
  orgSlug?: string | null
}): string {
  const taskId = args.taskId.trim()
  const projectId = typeof args.projectId === 'string' ? args.projectId.trim() : ''
  const orgSlug = typeof args.orgSlug === 'string' ? args.orgSlug.trim() : ''
  const surface = args.surface ?? 'portal'

  if (projectId) {
    if (surface === 'admin' && orgSlug) {
      return adminProjectTaskPath(orgSlug, projectId, taskId)
    }
    if (surface === 'admin') {
      return `/admin/projects?projectId=${encodeURIComponent(projectId)}&taskId=${encodeURIComponent(taskId)}`
    }
    return portalProjectTaskLink(projectId, taskId)
  }

  if (surface === 'admin' && orgSlug) {
    return adminAgentBoardTaskPath(orgSlug, taskId)
  }

  // Portal / unknown: keep a resolvable taskId query for the projects list fallback.
  return `/portal/projects?taskId=${encodeURIComponent(taskId)}`
}

export function taskNotificationData(args: {
  taskId: string
  projectId?: string | null
  taskTitle?: string | null
  extra?: Record<string, unknown>
}): Record<string, unknown> {
  return {
    taskId: args.taskId,
    ...(args.projectId ? { projectId: args.projectId } : {}),
    ...(args.taskTitle ? { taskTitle: args.taskTitle } : {}),
    ...(args.extra ?? {}),
  }
}

/** Pull a task id out of legacy `/portal/projects?task=` / `?taskId=` list links. */
export function extractTaskIdFromNotificationLink(link: string | null | undefined): string | null {
  if (!link || typeof link !== 'string') return null
  try {
    const url = new URL(link, 'https://partnersinbiz.local')
    const path = url.pathname.replace(/\/+$/, '') || '/'
    if (path === '/portal/projects') {
      return url.searchParams.get('taskId') ?? url.searchParams.get('task')
    }
    return null
  } catch {
    return null
  }
}

/**
 * Prefer structured data, then a well-formed project path, then legacy list links.
 * Does not hit the database — pair with resolveTaskNotificationHref for live lookups.
 */
export function preferTaskNotificationHref(args: {
  link?: string | null
  data?: Record<string, unknown> | null
  surface?: TaskNotificationSurface
  orgSlug?: string | null
}): string | null {
  const data = args.data ?? null
  const dataTaskId = typeof data?.taskId === 'string' ? data.taskId.trim() : ''
  const dataProjectId = typeof data?.projectId === 'string' ? data.projectId.trim() : ''

  if (dataTaskId && dataProjectId) {
    return buildTaskNotificationLink({
      taskId: dataTaskId,
      projectId: dataProjectId,
      surface: args.surface,
      orgSlug: args.orgSlug,
    })
  }

  const link = typeof args.link === 'string' ? args.link.trim() : ''
  if (link) {
    try {
      const url = new URL(link, 'https://partnersinbiz.local')
      const path = url.pathname.replace(/\/+$/, '') || '/'
      // Already a project detail deep-link — normalise query param name.
      const projectMatch = path.match(/^\/portal\/projects\/([^/]+)$/)
      if (projectMatch) {
        const projectId = decodeURIComponent(projectMatch[1])
        const taskId = url.searchParams.get('taskId') ?? url.searchParams.get('task')
        if (taskId) return portalProjectTaskLink(projectId, taskId)
      }
      const adminMatch = path.match(/^\/admin\/org\/([^/]+)\/projects\/([^/]+)$/)
      if (adminMatch) {
        const orgSlug = decodeURIComponent(adminMatch[1])
        const projectId = decodeURIComponent(adminMatch[2])
        const taskId = url.searchParams.get('taskId') ?? url.searchParams.get('task')
        if (taskId) return adminProjectTaskPath(orgSlug, projectId, taskId)
      }
    } catch {
      // fall through
    }
  }

  const legacyTaskId = dataTaskId || extractTaskIdFromNotificationLink(link)
  if (legacyTaskId) {
    return buildTaskNotificationLink({
      taskId: legacyTaskId,
      projectId: dataProjectId || null,
      surface: args.surface,
      orgSlug: args.orgSlug,
    })
  }

  return link || null
}
