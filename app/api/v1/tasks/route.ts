/**
 * GET  /api/v1/tasks — list tasks (filterable, paginated)
 * POST /api/v1/tasks — create a new task (idempotent via Idempotency-Key header)
 *
 * Auth: admin (AI/admin)
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { withIdempotency } from '@/lib/api/idempotency'
import { actorFrom } from '@/lib/api/actor'
import { apiSuccess, apiError } from '@/lib/api/response'
import { logActivity } from '@/lib/activity/log'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { cleanAgentEffort, cleanAgentModel, VALID_AGENT_EFFORTS, VALID_AGENT_MODELS } from '@/lib/agents/runRouting'
import {
  VALID_TASK_STATUSES,
  VALID_TASK_PRIORITIES,
  VALID_ASSIGNEE_TYPES,
  VALID_AGENT_IDS,
  VALID_AGENT_STATUSES,
  type Task,
  type TaskInput,
  type TaskStatus,
  type TaskPriority,
  type TaskAssignee,
  type AgentId,
  type AgentStatus,
} from '@/lib/tasks/types'
import {
  applyAgentColumnForCreate,
  applyAgentDispatchDefaultsForStandaloneAssignment,
} from '@/lib/tasks/agentState'
import {
  RESOURCE_RELATIONSHIP_ARRAY_FIELDS,
  RESOURCE_RELATIONSHIP_STRING_FIELDS,
  normalizeResourceRelationshipLinks,
} from '@/lib/client-documents/linkedValidation'

export const dynamic = 'force-dynamic'

function relationshipInputFrom(body: Record<string, unknown>) {
  const value: Record<string, unknown> = {}
  for (const key of RESOURCE_RELATIONSHIP_STRING_FIELDS) {
    if (key in body) value[key] = body[key]
  }
  for (const key of RESOURCE_RELATIONSHIP_ARRAY_FIELDS) {
    if (key in body) value[key] = body[key]
  }
  if ('contextRefs' in body) value.contextRefs = body.contextRefs
  return Object.keys(value).length > 0 ? value : undefined
}

export const GET = withAuth('admin', async (req, user) => {
  const { searchParams } = new URL(req.url)

  const orgId = searchParams.get('orgId')
  if (!orgId) return apiError('orgId is required; pass it as a query param')
  if (!canAccessOrg(user, orgId)) return apiError('Forbidden', 403)

  const status = searchParams.get('status') as TaskStatus | null
  const priority = searchParams.get('priority') as TaskPriority | null
  const assignedToRaw = searchParams.get('assignedTo') // "user:abc" | "agent:xyz"
  const projectId = searchParams.get('projectId')
  const contactId = searchParams.get('contactId')
  const dealId = searchParams.get('dealId')
  const dueBefore = searchParams.get('dueBefore')
  const dueAfter = searchParams.get('dueAfter')
  const tagsParam = searchParams.get('tags')

  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 200)
  const page = Math.max(parseInt(searchParams.get('page') ?? '1'), 1)

  let query: any = adminDb
    .collection('tasks')
    .where('orgId', '==', orgId)
    .orderBy('createdAt', 'desc')

  if (status && VALID_TASK_STATUSES.includes(status)) {
    query = query.where('status', '==', status)
  }
  const priorityFilter = priority && VALID_TASK_PRIORITIES.includes(priority) ? priority : null
  // Priority-only task lookups are common from admin boards. Keep them index-safe by filtering
  // in memory after the tenant/status scoped createdAt query instead of requiring Firestore
  // composites on orgId + priority + createdAt and orgId + status + priority + createdAt.
  let assignedToFilter: TaskAssignee | null = null
  if (assignedToRaw) {
    const [type, ...rest] = assignedToRaw.split(':')
    const id = rest.join(':')
    if (VALID_ASSIGNEE_TYPES.includes(type as TaskAssignee['type']) && id) {
      assignedToFilter = { type: type as TaskAssignee['type'], id }
      if (assignedToFilter.type === 'user') {
        query = query
          .where('assignedTo.type', '==', assignedToFilter.type)
          .where('assignedTo.id', '==', assignedToFilter.id)
      }
    }
  }
  if (projectId) query = query.where('projectId', '==', projectId)
  // Contact task lookups are commonly used from CRM contact pages. Keep them index-safe by
  // filtering in memory after the tenant-scoped createdAt query instead of requiring a
  // Firestore composite index on orgId + contactId + createdAt.
  if (dealId) query = query.where('dealId', '==', dealId)
  if (dueBefore) query = query.where('dueDate', '<=', dueBefore)
  if (dueAfter) query = query.where('dueDate', '>=', dueAfter)

  if (tagsParam) {
    const tags = tagsParam
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 10)
    if (tags.length > 0) {
      query = query.where('tags', 'array-contains-any', tags)
    }
  }

  const needsAgentAssigneeInMemoryFilter = assignedToFilter?.type === 'agent'
  const needsContactInMemoryFilter = Boolean(contactId)
  const needsPriorityInMemoryFilter = Boolean(priorityFilter)
  const needsInMemoryFilter = needsAgentAssigneeInMemoryFilter || needsContactInMemoryFilter || needsPriorityInMemoryFilter
  const queryLimit = needsInMemoryFilter
    ? Math.min(Math.max(limit * page, 500), 1000)
    : limit

  let pagedQuery = query.limit(queryLimit)
  if (!needsInMemoryFilter) {
    pagedQuery = pagedQuery.offset((page - 1) * limit)
  }

  const snapshot = await pagedQuery.get()

  let tasks: Task[] = snapshot.docs
    .map((doc: any) => ({ id: doc.id, ...doc.data() }))
    .filter((t: Task) => t.deleted !== true)

  if (needsContactInMemoryFilter && contactId) {
    tasks = tasks.filter((t: Task) => t.contactId === contactId)
  }

  if (needsPriorityInMemoryFilter && priorityFilter) {
    tasks = tasks.filter((t: Task) => t.priority === priorityFilter)
  }

  if (needsAgentAssigneeInMemoryFilter && assignedToFilter) {
    tasks = tasks.filter((t: Task) => {
      const assignee = t.assignedTo
      return t.assigneeAgentId === assignedToFilter.id || (
        assignee?.type === 'agent' && assignee.id === assignedToFilter.id
      )
    })
  }

  const total = tasks.length
  if (needsInMemoryFilter) {
    tasks = tasks.slice((page - 1) * limit, page * limit)
  }

  return apiSuccess(tasks, 200, { total, page, limit })
})

export const POST = withAuth(
  'admin',
  withIdempotency(async (req, user) => {
    const body = (await req.json()) as TaskInput & { orgId?: string }

    if (!body.orgId?.trim()) return apiError('orgId is required')
    if (!body.title?.trim()) return apiError('Title is required')
    if (!canAccessOrg(user, body.orgId.trim())) return apiError('Forbidden', 403)

    if (body.status && !VALID_TASK_STATUSES.includes(body.status)) {
      return apiError('Invalid status; expected todo | in_progress | done | cancelled')
    }
    if (body.priority && !VALID_TASK_PRIORITIES.includes(body.priority)) {
      return apiError('Invalid priority; expected low | normal | high | urgent')
    }
    if (
      body.assignedTo &&
      !VALID_ASSIGNEE_TYPES.includes(body.assignedTo.type)
    ) {
      return apiError("Invalid assignedTo.type; expected 'user' or 'agent'")
    }

    // Agent dispatch field validation (treat body as untyped record for these new fields)
    const raw = body as unknown as Record<string, unknown>
    let assigneeAgentId: AgentId | null = null
    const rawAgent = raw.assigneeAgentId
    if (rawAgent !== undefined && rawAgent !== null && rawAgent !== '') {
      if (typeof rawAgent !== 'string' || !VALID_AGENT_IDS.includes(rawAgent as AgentId)) {
        return apiError(`Invalid assigneeAgentId; expected one of ${VALID_AGENT_IDS.join(' | ')}`)
      }
      assigneeAgentId = rawAgent as AgentId
    }
    let agentStatusValue: AgentStatus | null = assigneeAgentId ? 'pending' : null
    const rawStatus = raw.agentStatus
    if (rawStatus !== undefined && rawStatus !== null) {
      if (typeof rawStatus !== 'string' || !VALID_AGENT_STATUSES.includes(rawStatus as AgentStatus)) {
        return apiError(`Invalid agentStatus; expected one of ${VALID_AGENT_STATUSES.join(' | ')}`)
      }
      agentStatusValue = rawStatus as AgentStatus
    }
    const agentEffortValue = raw.agentEffort === undefined || raw.agentEffort === null || raw.agentEffort === ''
      ? null
      : cleanAgentEffort(raw.agentEffort)
    if (raw.agentEffort !== undefined && raw.agentEffort !== null && raw.agentEffort !== '' && !agentEffortValue) {
      return apiError(`Invalid agentEffort; expected one of ${VALID_AGENT_EFFORTS.join(' | ')}`)
    }
    const agentModelValue = raw.agentModel === undefined || raw.agentModel === null || raw.agentModel === ''
      ? null
      : cleanAgentModel(raw.agentModel)
    if (raw.agentModel !== undefined && raw.agentModel !== null && raw.agentModel !== '' && !agentModelValue) {
      return apiError(`Invalid agentModel; expected one of ${VALID_AGENT_MODELS.join(' | ')}`)
    }
    let agentInputValue: { spec: string; context?: Record<string, unknown>; constraints?: string[] } | null = null
    const rawInput = raw.agentInput
    if (rawInput !== undefined && rawInput !== null) {
      if (typeof rawInput !== 'object' || Array.isArray(rawInput)) return apiError('agentInput must be an object')
      const ai = rawInput as Record<string, unknown>
      const spec = typeof ai.spec === 'string' ? ai.spec.trim() : ''
      if (!spec) return apiError('agentInput.spec is required when agentInput is set')
      agentInputValue = { spec }
      if (ai.context && typeof ai.context === 'object' && !Array.isArray(ai.context)) {
        agentInputValue.context = ai.context as Record<string, unknown>
      }
      if (Array.isArray(ai.constraints)) {
        agentInputValue.constraints = ai.constraints
          .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
          .map((c: string) => c.trim())
      }
    }
    let dependsOnValue: string[] = []
    const rawDeps = raw.dependsOn
    if (rawDeps !== undefined && rawDeps !== null) {
      if (!Array.isArray(rawDeps)) return apiError('dependsOn must be an array of task IDs')
      dependsOnValue = Array.from(new Set(
        rawDeps
          .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
          .map((id: string) => id.trim())
      ))
    }

    const status = body.status ?? 'todo'
    const priority = body.priority ?? 'normal'
    const title = body.title.trim()
    const description = body.description?.trim() ?? ''
    const dueDate = body.dueDate ?? null
    const assignedTo = body.assignedTo ?? null

    const relationshipInput = relationshipInputFrom(body as unknown as Record<string, unknown>)
    const relationships = relationshipInput
      ? normalizeResourceRelationshipLinks(relationshipInput)
      : { ok: true as const, value: {} }
    if (!relationships.ok) return apiError(relationships.error, 400)

    const docData: Record<string, unknown> = {
      orgId: body.orgId.trim(),
      title,
      description,
      status,
      priority,
      dueDate,
      assignedTo,
      projectId: body.projectId ?? null,
      contactId: body.contactId ?? null,
      dealId: body.dealId ?? null,
      ...relationships.value,
      tags: body.tags ?? [],
      columnId: typeof body.columnId === 'string' && body.columnId.trim() ? body.columnId.trim() : 'todo',
      ...actorFrom(user),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      completedAt: null,
      deleted: false,
    }
    if (assigneeAgentId) docData.assigneeAgentId = assigneeAgentId
    if (agentStatusValue) docData.agentStatus = agentStatusValue
    if (agentEffortValue) docData.agentEffort = agentEffortValue
    if (agentModelValue) docData.agentModel = agentModelValue
    applyAgentColumnForCreate(docData, raw)
    if (agentInputValue) docData.agentInput = agentInputValue
    if (dependsOnValue.length > 0) docData.dependsOn = dependsOnValue
    applyAgentDispatchDefaultsForStandaloneAssignment(docData, raw)

    const docRef = await adminDb.collection('tasks').add(docData)

    logActivity({
      orgId: body.orgId.trim(),
      type: 'task_created',
      actorId: user.uid,
      actorName: user.uid,
      actorRole: user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client',
      description: `Created task: "${title}"`,
      entityId: docRef.id,
      entityType: 'task',
      entityTitle: title,
    }).catch(() => {})

    // Notify assignee if provided.
    if (assignedTo) {
      await adminDb.collection('notifications').add({
        orgId: body.orgId.trim(),
        userId: assignedTo.type === 'user' ? assignedTo.id : null,
        agentId: assignedTo.type === 'agent' ? assignedTo.id : null,
        type: 'task.assigned',
        title: 'Task assigned to you',
        body: `"${title}" — due ${dueDate ?? 'no date'}`,
        link: `/portal/projects?task=${docRef.id}`,
        status: 'unread',
        priority,
        createdAt: FieldValue.serverTimestamp(),
      })
    }

    return apiSuccess({ id: docRef.id }, 201)
  }),
)
