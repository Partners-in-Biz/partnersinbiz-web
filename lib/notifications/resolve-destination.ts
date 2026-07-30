import type { Firestore } from 'firebase-admin/firestore'
import { resolveOrgSlugForLink } from '@/lib/projects/links'
import {
  buildTaskNotificationLink,
  extractTaskIdFromNotificationLink,
  preferTaskNotificationHref,
  type TaskNotificationSurface,
} from '@/lib/notifications/task-links'

type NotificationLike = {
  type?: string
  link?: string | null
  data?: Record<string, unknown> | null
  orgId?: string
}

async function lookupStandaloneTaskProjectId(
  db: Firestore,
  taskId: string,
): Promise<string | null> {
  const snap = await db.collection('tasks').doc(taskId).get()
  if (!snap.exists) return null
  const data = snap.data() as { projectId?: unknown; deleted?: unknown } | undefined
  if (!data || data.deleted === true) return null
  return typeof data.projectId === 'string' && data.projectId.trim()
    ? data.projectId.trim()
    : null
}

/**
 * Resolve the best in-app destination for a notification.
 * Upgrades legacy `/portal/projects?task=` links by reading task.projectId when needed.
 */
export async function resolveNotificationDestination(args: {
  db: Firestore
  notification: NotificationLike
  surface?: TaskNotificationSurface
}): Promise<string | null> {
  const surface = args.surface ?? 'portal'
  const notification = args.notification
  const data = (notification.data && typeof notification.data === 'object')
    ? notification.data
    : null

  let orgSlug: string | null = null
  if (surface === 'admin' && typeof notification.orgId === 'string' && notification.orgId.trim()) {
    orgSlug = await resolveOrgSlugForLink(args.db, notification.orgId).catch(() => null)
  }

  const preferred = preferTaskNotificationHref({
    link: notification.link,
    data,
    surface,
    orgSlug,
  })

  // If we already have a project-scoped deep link, use it.
  if (preferred && /\/projects\/[^/?#]+/.test(preferred) && /[?&]taskId=/.test(preferred)) {
    return preferred
  }
  if (preferred && preferred.includes('/agent/board?taskId=')) {
    return preferred
  }

  const taskId =
    (typeof data?.taskId === 'string' && data.taskId.trim())
    || extractTaskIdFromNotificationLink(notification.link)
    || extractTaskIdFromNotificationLink(preferred)

  if (!taskId) {
    return preferred || (typeof notification.link === 'string' ? notification.link : null)
  }

  const dataProjectId = typeof data?.projectId === 'string' ? data.projectId.trim() : ''
  const projectId = dataProjectId || await lookupStandaloneTaskProjectId(args.db, taskId)

  return buildTaskNotificationLink({
    taskId,
    projectId,
    surface,
    orgSlug,
  })
}
