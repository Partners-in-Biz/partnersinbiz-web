import { NextRequest } from 'next/server'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { notifyNewComment } from '@/lib/notifications/notify'
import { logActivity } from '@/lib/activity/log'
import { getProjectForUser } from '@/lib/projects/access'
import { adminProjectTaskLink } from '@/lib/projects/links'
import { resolveContextReferences } from '@/lib/context-references/registry'
import {
  sanitizeContextReferenceSeeds,
  type ContextReference,
  type ContextReferenceSeed,
} from '@/lib/context-references/types'

export const dynamic = 'force-dynamic'

interface Comment {
  id?: string
  text: string
  userId: string
  userName: string
  userRole: 'admin' | 'client' | 'ai'
  createdAt: Timestamp | FieldValue
  agentPickedUp: boolean
  agentPickedUpAt?: Timestamp | null
  contextRefs?: ContextReference[]
}

type RouteContext = { params: Promise<{ projectId: string; taskId: string }> }

function taskContextSeed(args: {
  projectId: string
  taskId: string
  orgId?: string
  title?: string
}): ContextReferenceSeed {
  return {
    type: 'task',
    id: args.taskId,
    ...(args.orgId ? { orgId: args.orgId } : {}),
    ...(args.title ? { label: args.title } : {}),
    origin: 'current_page',
    metadata: { projectId: args.projectId },
  }
}

// GET - List all comments for a task
export const GET = withAuth('client', async (req: NextRequest, user, ctx) => {
  const { projectId, taskId } = await (ctx as RouteContext).params
  const access = await getProjectForUser(projectId, user)
  if (!access.ok) return apiError(access.error, access.status)

  const ref = adminDb.collection('projects').doc(projectId).collection('tasks').doc(taskId)
  const doc = await ref.get()
  if (!doc.exists) return apiError('Task not found', 404)

  const commentsSnap = await ref.collection('comments').orderBy('createdAt', 'asc').get()
  const comments: Comment[] = commentsSnap.docs.map(d => ({
    id: d.id,
    ...(d.data() as Omit<Comment, 'id'>),
  }))

  return apiSuccess(comments)
})

// POST - Create a comment
export const POST = withAuth('client', async (req: NextRequest, user, ctx) => {
  const { projectId, taskId } = await (ctx as RouteContext).params
  const access = await getProjectForUser(projectId, user)
  if (!access.ok) return apiError(access.error, access.status)

  try {
    const body = await req.json()
    const { text } = body

    // Validate text
    if (!text || typeof text !== 'string' || !text.trim()) {
      return apiError('Text is required and must be non-empty', 400)
    }

    // Check task exists
    const taskRef = adminDb.collection('projects').doc(projectId).collection('tasks').doc(taskId)
    const taskDoc = await taskRef.get()
    if (!taskDoc.exists) return apiError('Task not found', 404)
    const taskData = taskDoc.data() ?? {}
    const projectData = access.doc.data() ?? {}
    const orgId = typeof projectData.orgId === 'string' ? projectData.orgId : undefined
    const taskTitle = typeof taskData.title === 'string' && taskData.title.trim() ? taskData.title.trim() : 'a task'

    const contextRefs = await resolveContextReferences(
      [
        taskContextSeed({ projectId, taskId, orgId, title: taskTitle }),
        ...sanitizeContextReferenceSeeds(body.contextRefs),
      ],
      user,
      orgId,
    )

    // Get user info
    let userName = user.uid
    if (user.uid !== 'ai-agent') {
      const userDoc = await adminDb.collection('users').doc(user.uid).get()
      if (userDoc.exists && userDoc.data()?.displayName) {
        userName = userDoc.data()!.displayName
      }
    } else {
      userName = 'AI Agent'
    }

    // Determine user role
    let userRole: 'admin' | 'client' | 'ai' = 'client'
    if (user.role === 'admin') userRole = 'admin'
    else if (user.role === 'ai') userRole = 'ai'

    // Create comment
    const commentData: Omit<Comment, 'id'> = {
      text: text.trim(),
      userId: user.uid,
      userName,
      userRole,
      createdAt: FieldValue.serverTimestamp(),
      agentPickedUp: false,
      agentPickedUpAt: null,
      ...(contextRefs.length > 0 ? { contextRefs } : {}),
    }

    const commentRef = taskRef.collection('comments').doc()
    await commentRef.set(commentData)

    const createdDoc = await commentRef.get()
    const comment: Comment = {
      id: commentRef.id,
      ...(createdDoc.data() as Omit<Comment, 'id'>),
    }

    // Send notification for new comment
    const projectDoc = await adminDb.collection('projects').doc(projectId).get()
    const notificationOrgId = projectDoc.data()?.orgId
    const viewUrl = typeof notificationOrgId === 'string'
      ? await adminProjectTaskLink({ db: adminDb, orgId: notificationOrgId, projectId, taskId })
      : `/portal/projects?projectId=${encodeURIComponent(projectId)}&taskId=${encodeURIComponent(taskId)}`

    notifyNewComment({
      commentText: text.trim(),
      commenterName: userName,
      commenterRole: userRole,
      context: `task "${taskTitle}"`,
      orgId: notificationOrgId,
      viewUrl,
    }).catch(() => {})

    // Log activity event (fire and forget)
    if (notificationOrgId) {
      logActivity({
        orgId: notificationOrgId,
        type: 'comment_added',
        actorId: user.uid,
        actorName: userName,
        actorRole: userRole,
        description: `Added comment on task: "${taskTitle}"`,
        entityId: taskId,
        entityType: 'task',
        entityTitle: taskTitle,
      }).catch(() => {})
    }

    return apiSuccess(comment, 201)
  } catch (err) {
    console.error('Error creating comment:', err)
    return apiError('Failed to create comment', 500)
  }
})
