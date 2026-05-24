/**
 * GET /api/v1/agent/project/[projectId] — returns full project context for an AI agent
 *
 * Returns:
 * {
 *   project: { name, status, description, brief, orgId },
 *   documents: [ { title, content, type } ],
 *   tasks: [ { id, orgId, projectId, title, description, priority, columnId, status, assigneeAgentId, agentStatus, agentInput, agentOutput, dependsOn, labels, reviewStatus, agentConversationId, agentHeartbeatAt, attachments } ],
 *   recentComments: [ ... ] // latest 10 comments across all tasks
 * }
 */
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ projectId: string }> }
type RecentTaskComment = {
  taskId: string
  text: string
  userId: string
  userName: string
  createdAt?: unknown
}

function timestampMillis(value: unknown): number {
  if (typeof value !== 'object' || value === null) return 0
  const maybeTimestamp = value as { toMillis?: unknown }
  return typeof maybeTimestamp.toMillis === 'function' ? (maybeTimestamp.toMillis as () => number)() : 0
}

export const GET = withAuth('admin', async (req: NextRequest, user, ctx) => {
  const { projectId } = await (ctx as RouteContext).params

  // Get project
  const projectDoc = await adminDb.collection('projects').doc(projectId).get()
  if (!projectDoc.exists) return apiError('Project not found', 404)

  const projectData = projectDoc.data()
  const project = {
    name: projectData?.name ?? '',
    status: projectData?.status ?? '',
    description: projectData?.description ?? '',
    brief: projectData?.brief ?? '',
    orgId: projectData?.orgId ?? '',
  }

  // Get documents
  const docsSnapshot = await adminDb
    .collection('projects')
    .doc(projectId)
    .collection('docs')
    .orderBy('createdAt', 'desc')
    .get()

  const documents = docsSnapshot.docs.map(doc => {
    const data = doc.data()
    return {
      title: data.title ?? '',
      content: data.content ?? '',
      type: data.type ?? 'notes',
    }
  })

  // Get tasks
  const tasksSnapshot = await adminDb
    .collection('projects')
    .doc(projectId)
    .collection('tasks')
    .orderBy('order', 'asc')
    .get()

  const tasks = tasksSnapshot.docs.map(doc => {
    const data = doc.data()
    return {
      id: doc.id,
      orgId: data.orgId ?? project.orgId,
      projectId: data.projectId ?? projectId,
      title: data.title ?? '',
      description: data.description ?? '',
      priority: data.priority ?? 'medium',
      columnId: data.columnId ?? '',
      status: data.status ?? data.columnId ?? '',
      assigneeAgentId: data.assigneeAgentId ?? null,
      agentStatus: data.agentStatus ?? null,
      agentInput: data.agentInput ?? null,
      agentOutput: data.agentOutput ?? null,
      dependsOn: Array.isArray(data.dependsOn) ? data.dependsOn : [],
      labels: Array.isArray(data.labels) ? data.labels : [],
      reviewStatus: data.reviewStatus ?? null,
      agentConversationId: data.agentConversationId ?? null,
      agentHeartbeatAt: data.agentHeartbeatAt ?? null,
      attachments: data.attachments ?? [],
    }
  })

  // Get recent comments (latest 10 across all tasks)
  const recentComments: RecentTaskComment[] = []
  for (const taskDoc of tasksSnapshot.docs) {
    const commentsSnapshot = await adminDb
      .collection('projects')
      .doc(projectId)
      .collection('tasks')
      .doc(taskDoc.id)
      .collection('comments')
      .orderBy('createdAt', 'desc')
      .limit(5)
      .get()

    commentsSnapshot.docs.forEach(commentDoc => {
      const data = commentDoc.data()
      recentComments.push({
        taskId: taskDoc.id,
        text: data.text ?? '',
        userId: data.userId ?? '',
        userName: data.userName ?? '',
        createdAt: data.createdAt,
      })
    })
  }

  // Sort and take top 10
  recentComments.sort((a, b) => {
    const aTime = timestampMillis(a.createdAt)
    const bTime = timestampMillis(b.createdAt)
    return bTime - aTime
  })
  const topComments = recentComments.slice(0, 10)

  return apiSuccess({
    project,
    documents,
    tasks,
    recentComments: topComments,
  })
})
