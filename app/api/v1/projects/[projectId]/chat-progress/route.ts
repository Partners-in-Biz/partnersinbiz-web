import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { getProjectForUser } from '@/lib/projects/access'
import { buildProjectChatProgress, type ProjectChatTaskSource } from '@/lib/projects/chatProgress'
import { filterProjectItemsForAccess } from '@/lib/projects/collaboration'
import { taskOrderMillis } from '@/lib/projects/taskPayload'
import { getProjectTaskReadModel, seedProjectTaskReadModel } from '@/lib/projects/taskReadModelStore'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ projectId: string }> }

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export const GET = withAuth('client', async (_req: NextRequest, user, ctx) => {
  const { projectId } = await (ctx as RouteContext).params
  const access = await getProjectForUser(projectId, user)
  if (!access.ok) return apiError(access.error, access.status)

  const projectData = access.doc.data() ?? {}
  const cachedModel = await getProjectTaskReadModel(projectId)
  const sourceTasks = cachedModel?.tasks ?? await (async () => {
    const snapshot = await adminDb.collection('projects').doc(projectId).collection('tasks').get()
    const tasks = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
    await seedProjectTaskReadModel(projectId, tasks)
    return tasks
  })()
  const visibleTasks = filterProjectItemsForAccess(
    sourceTasks,
    { projectAccess: access.projectAccess, user },
  ).sort((left, right) => taskOrderMillis((left as Record<string, unknown>).order) - taskOrderMillis((right as Record<string, unknown>).order)) as ProjectChatTaskSource[]

  const progress = buildProjectChatProgress({
    project: {
      id: projectId,
      name: cleanString(projectData.name) || cleanString(projectData.title) || 'Untitled project',
      status: cleanString(projectData.status) || undefined,
    },
    tasks: visibleTasks,
  })

  return apiSuccess({ ...progress, asOf: new Date().toISOString() })
})
