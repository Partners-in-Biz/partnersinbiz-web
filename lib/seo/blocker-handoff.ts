import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { ApiUser } from '@/lib/api/types'
import { canAccessOrg } from '@/lib/api/platformAdmin'

type SeoTaskRecord = {
  orgId?: string
  sprintId?: string
  title?: string
  description?: string
  taskType?: string
  week?: number
  phase?: string
}

type SeoSprintRecord = {
  orgId?: string
  siteName?: string
  siteUrl?: string
  timezone?: string
}

type SeoOptimizationRecord = Record<string, unknown> & {
  sprintId?: string
  hypothesis?: string
  hypothesisType?: string
  proposedAction?: string
}

type AdminRecipient = {
  id: string
  email?: string
  displayName?: string
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function sprintProjectName(sprint: SeoSprintRecord): string {
  return `${text(sprint.siteName) ?? 'Client'} - SEO 90-day Sprint`
}

function blockerTaskDescription(args: {
  taskId: string
  sprintId: string
  sprint: SeoSprintRecord
  task: SeoTaskRecord
  reason: string
}) {
  const sprintUrl = `/admin/seo/sprints/${args.sprintId}`
  const settingsUrl = `/admin/seo/sprints/${args.sprintId}/settings`
  const taskLabel = text(args.task.title) ?? args.taskId
  const taskType = text(args.task.taskType) ?? 'unknown'
  const siteName = text(args.sprint.siteName) ?? 'Client site'
  const siteUrl = text(args.sprint.siteUrl) ?? 'unknown URL'

  return [
    `SEO blocker for ${siteName}`,
    '',
    `Sprint: ${args.sprintId}`,
    `Site: ${siteUrl}`,
    `SEO task: ${taskLabel}`,
    `Task id: ${args.taskId}`,
    `Task type: ${taskType}`,
    args.task.week != null ? `Week: ${args.task.week}` : null,
    text(args.task.phase) ? `Phase: ${args.task.phase}` : null,
    '',
    'What is wrong:',
    args.reason,
    '',
    'How to fix it:',
    '- Review the blocker above and complete the missing human/admin/client action.',
    '- Attach proof in this task: screenshot, URL, account confirmation, PR, or note from the client.',
    '- Update the SEO sprint task blocker notes if the fix changes the expected next step.',
    '',
    'What to send the agent when done:',
    `"The blocker for SEO task ${args.taskId} in sprint ${args.sprintId} is resolved. Evidence: <paste proof/link>. Please rerun or complete the SEO task and update the sprint."`,
    '',
    'Links:',
    `- Sprint: ${sprintUrl}`,
    `- Sprint settings: ${settingsUrl}`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
}

async function adminRecipientsForOrg(orgId: string): Promise<AdminRecipient[]> {
  const snap = await adminDb.collection('users').where('role', '==', 'admin').get()
  const recipients: AdminRecipient[] = []
  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>
    const allowedOrgIds = Array.isArray(data.allowedOrgIds)
      ? data.allowedOrgIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : undefined
    const orgIds = Array.isArray(data.orgIds)
      ? data.orgIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : undefined
    const user: ApiUser = {
      uid: doc.id,
      role: 'admin',
      orgId: text(data.orgId) ?? undefined,
      orgIds,
      allowedOrgIds,
    }
    if (!canAccessOrg(user, orgId)) continue
    recipients.push({
      id: doc.id,
      email: text(data.email) ?? undefined,
      displayName: text(data.displayName) ?? undefined,
    })
  }
  return recipients
}

export async function ensureSeoProject(args: {
  orgId: string
  sprintId: string
  sprint: SeoSprintRecord
  actor: ApiUser
}) {
  const name = sprintProjectName(args.sprint)
  const existing = await adminDb
    .collection('projects')
    .where('orgId', '==', args.orgId)
    .get()
  const match = existing.docs.find((doc) => doc.data()?.name === name)
  if (match) return match.ref

  const ref = adminDb.collection('projects').doc()
  await ref.set({
    name,
    orgId: args.orgId,
    clientId: args.orgId,
    clientOrgId: args.orgId,
    description: `Human, client, and agent handoffs for the ${text(args.sprint.siteName) ?? 'client'} SEO sprint.`,
    brief: [
      `# ${name}`,
      '',
      `SEO sprint: ${args.sprintId}`,
      `Site URL: ${text(args.sprint.siteUrl) ?? 'unknown'}`,
      '',
      'This project tracks blockers, human/client actions, and agent handoffs related to the SEO sprint. The SEO sprint remains the client-visible progress ledger.',
    ].join('\n'),
    status: 'development',
    startDate: FieldValue.serverTimestamp(),
    targetDate: null,
    createdBy: args.actor.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    source: 'seo-blocker-handoff',
    sourceSprintId: args.sprintId,
  })
  return ref
}

function localDateKey(timezone?: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: text(timezone) ?? 'Africa/Johannesburg',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date())
    const year = parts.find((part) => part.type === 'year')?.value
    const month = parts.find((part) => part.type === 'month')?.value
    const day = parts.find((part) => part.type === 'day')?.value
    if (year && month && day) return `${year}-${month}-${day}`
  } catch {
    // Fall back to UTC if a stored sprint timezone is invalid.
  }
  return new Date().toISOString().slice(0, 10)
}

function queuedAgentTaskDescription(args: {
  sprintId: string
  sprint: SeoSprintRecord
  tasks: Array<SeoTaskRecord & { id: string }>
  runDate: string
}) {
  const sprintUrl = `/admin/seo/sprints/${args.sprintId}`
  const taskLines = args.tasks.map((task, index) => {
    const label = text(task.title) ?? task.id
    const taskType = text(task.taskType) ?? 'unknown'
    return `${index + 1}. ${label} (${task.id}, ${taskType})`
  })

  return [
    `Run today's queued SEO work for ${text(args.sprint.siteName) ?? 'this sprint'}.`,
    '',
    `Sprint: ${args.sprintId}`,
    `Run date: ${args.runDate}`,
    `Site: ${text(args.sprint.siteUrl) ?? 'unknown URL'}`,
    '',
    'Queued SEO tasks:',
    ...taskLines,
    '',
    'Instructions:',
    '- Treat this as the Pip orchestration entrypoint for the SEO sprint run.',
    '- Complete what can be done directly through the PiB SEO APIs and existing tools.',
    '- Break work into specialist subtasks only where it is useful.',
    '- Update the relevant seo_tasks records, artifacts, and notes as work is completed.',
    '- If a task needs human/client/admin input, create or update a project task blocker and keep the SEO sprint as the client-visible ledger.',
    '',
    `Sprint link: ${sprintUrl}`,
  ].join('\n')
}

function optimizationAgentTaskDescription(args: {
  sprintId: string
  sprint: SeoSprintRecord
  optimizations: Array<SeoOptimizationRecord & { id: string }>
  runDate: string
}) {
  const sprintUrl = `/admin/seo/sprints/${args.sprintId}/optimizations`
  const optimizationLines = args.optimizations.map((optimization, index) => {
    const hypothesis = text(optimization.hypothesis) ?? text(optimization.hypothesisType) ?? optimization.id
    const proposedAction = text(optimization.proposedAction)
    return `${index + 1}. ${hypothesis} (${optimization.id})${proposedAction ? ` - ${proposedAction}` : ''}`
  })

  return [
    `Review and orchestrate new SEO optimization proposals for ${text(args.sprint.siteName) ?? 'this sprint'}.`,
    '',
    `Sprint: ${args.sprintId}`,
    `Run date: ${args.runDate}`,
    `Site: ${text(args.sprint.siteUrl) ?? 'unknown URL'}`,
    '',
    'New optimization proposals:',
    ...optimizationLines,
    '',
    'Instructions:',
    '- Treat this as the Pip orchestration entrypoint for Loop C optimization work.',
    '- Review each proposal against the sprint health signal and existing SEO tasks.',
    '- Approve proposals that are useful by calling the optimization approve endpoint, then execute or queue the generated SEO tasks through the sprint run flow.',
    '- Reject weak, duplicate, or unsafe proposals with a clear reason.',
    '- If work needs human/client/admin input, create or update a project blocker task and keep the SEO sprint as the client-visible ledger.',
    '- Report back with optimization ids, generated task ids, completed task ids, blockers, and evidence links.',
    '',
    `Optimizations link: ${sprintUrl}`,
  ].join('\n')
}

export async function ensureSeoQueuedAgentHandoff(args: {
  sprintId: string
  taskIds: string[]
  actor: ApiUser
}) {
  const uniqueTaskIds = Array.from(new Set(args.taskIds.filter((id) => text(id))))
  if (uniqueTaskIds.length === 0) return null

  const sprintSnap = await adminDb.collection('seo_sprints').doc(args.sprintId).get()
  if (!sprintSnap.exists) return null
  const sprint = sprintSnap.data() as SeoSprintRecord
  const orgId = text(sprint.orgId)
  if (!orgId) return null

  const taskSnaps = await Promise.all(
    uniqueTaskIds.map((taskId) => adminDb.collection('seo_tasks').doc(taskId).get())
  )
  const tasks = taskSnaps
    .filter((snap) => snap.exists)
    .map((snap) => ({ id: snap.id, ...(snap.data() as SeoTaskRecord) }))
    .filter((task) => text(task.sprintId) === args.sprintId)
  if (tasks.length === 0) return null

  const projectRef = await ensureSeoProject({ orgId, sprintId: args.sprintId, sprint, actor: args.actor })
  const runDate = localDateKey(sprint.timezone)
  const projectTaskRef = projectRef.collection('tasks').doc(`seo-run-${args.sprintId}-${runDate}`)
  const existingProjectTask = await projectTaskRef.get()
  const existingProjectTaskData = existingProjectTask.exists
    ? existingProjectTask.data() as Record<string, unknown>
    : null
  const currentAgentStatus = text(existingProjectTaskData?.agentStatus)
  const shouldQueueAgent = !currentAgentStatus || currentAgentStatus === 'done' || currentAgentStatus === 'blocked'
  const title = `Pip orchestration: today's SEO run - ${text(sprint.siteName) ?? args.sprintId}`
  const description = queuedAgentTaskDescription({
    sprintId: args.sprintId,
    sprint,
    tasks,
    runDate,
  })

  const projectTaskData: Record<string, unknown> = {
    orgId,
    projectId: projectRef.id,
    columnId: 'in_progress',
    title,
    description,
    priority: 'high',
    assigneeId: null,
    assigneeIds: [],
    mentionIds: [],
    labels: [
      'seo',
      'seo-run',
      'agent-orchestration',
      `seo-sprint:${args.sprintId}`,
      `run-date:${runDate}`,
    ],
    checklist: tasks.map((task) => ({
      id: `seo-${task.id}`,
      text: text(task.title) ?? task.id,
      done: false,
    })),
    dueDate: null,
    startDate: null,
    estimateMinutes: null,
    order: Date.now(),
    source: 'seo-run-orchestration',
    sourceSprintId: args.sprintId,
    sourceSeoTaskIds: tasks.map((task) => task.id),
    reporterId: args.actor.uid,
    createdBy: args.actor.uid,
    updatedAt: FieldValue.serverTimestamp(),
    assigneeAgentId: 'pip',
    agentInput: {
      spec: description,
      context: {
        assignmentMode: 'orchestration',
        orchestrationMode: 'pip-orchestrator',
        source: 'seo-sprint-run',
        sprintId: args.sprintId,
        orgId,
        runDate,
        queuedSeoTaskIds: tasks.map((task) => task.id),
        requestedAgentIds: ['theo', 'maya', 'sage', 'nora'],
      },
      constraints: [
        'Pip owns orchestration for this SEO sprint run.',
        'Keep seo_tasks and the sprint progress ledger updated as work is completed.',
        'Create blocker handoffs for any task that needs human, client, admin, or credential input.',
      ],
    },
  }
  if (!existingProjectTask.exists) projectTaskData.createdAt = FieldValue.serverTimestamp()
  if (shouldQueueAgent) projectTaskData.agentStatus = 'pending'
  await projectTaskRef.set(projectTaskData, { merge: true })

  await adminDb.collection('seo_agent_handoffs').doc(`${args.sprintId}_${runDate}`).set({
    orgId,
    sprintId: args.sprintId,
    runDate,
    status: shouldQueueAgent ? 'queued' : currentAgentStatus,
    projectId: projectRef.id,
    projectTaskId: projectTaskRef.id,
    seoTaskIds: tasks.map((task) => task.id),
    updatedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
  }, { merge: true })

  await Promise.all(tasks.map((task) => adminDb.collection('seo_tasks').doc(task.id).set({
    agentProjectId: projectRef.id,
    agentProjectTaskId: projectTaskRef.id,
    agentQueuedAt: FieldValue.serverTimestamp(),
  }, { merge: true })))

  return {
    projectId: projectRef.id,
    projectTaskId: projectTaskRef.id,
    taskIds: tasks.map((task) => task.id),
  }
}

export async function ensureSeoOptimizationAgentHandoff(args: {
  sprintId: string
  optimizationIds: string[]
  actor: ApiUser
}) {
  const uniqueOptimizationIds = Array.from(new Set(args.optimizationIds.filter((id) => text(id))))
  if (uniqueOptimizationIds.length === 0) return null

  const sprintSnap = await adminDb.collection('seo_sprints').doc(args.sprintId).get()
  if (!sprintSnap.exists) return null
  const sprint = sprintSnap.data() as SeoSprintRecord
  const orgId = text(sprint.orgId)
  if (!orgId) return null

  const optimizationSnaps = await Promise.all(
    uniqueOptimizationIds.map((optimizationId) => adminDb.collection('seo_optimizations').doc(optimizationId).get())
  )
  const optimizations = optimizationSnaps
    .filter((snap) => snap.exists)
    .map((snap) => ({ id: snap.id, ...(snap.data() as SeoOptimizationRecord) }))
    .filter((optimization) => text(optimization.sprintId) === args.sprintId)
  if (optimizations.length === 0) return null

  const projectRef = await ensureSeoProject({ orgId, sprintId: args.sprintId, sprint, actor: args.actor })
  const runDate = localDateKey(sprint.timezone)
  const projectTaskRef = projectRef.collection('tasks').doc(`seo-optimization-${args.sprintId}-${runDate}`)
  const existingProjectTask = await projectTaskRef.get()
  const existingProjectTaskData = existingProjectTask.exists
    ? existingProjectTask.data() as Record<string, unknown>
    : null
  const currentAgentStatus = text(existingProjectTaskData?.agentStatus)
  const shouldQueueAgent = !currentAgentStatus || currentAgentStatus === 'done' || currentAgentStatus === 'blocked'
  const title = `Pip optimization: SEO autoresearch - ${text(sprint.siteName) ?? args.sprintId}`
  const description = optimizationAgentTaskDescription({
    sprintId: args.sprintId,
    sprint,
    optimizations,
    runDate,
  })

  const projectTaskData: Record<string, unknown> = {
    orgId,
    projectId: projectRef.id,
    columnId: 'in_progress',
    title,
    description,
    priority: 'high',
    assigneeId: null,
    assigneeIds: [],
    mentionIds: [],
    labels: [
      'seo',
      'seo-optimization',
      'agent-orchestration',
      `seo-sprint:${args.sprintId}`,
      `run-date:${runDate}`,
    ],
    checklist: optimizations.map((optimization) => ({
      id: `seo-opt-${optimization.id}`,
      text: text(optimization.hypothesis) ?? text(optimization.hypothesisType) ?? optimization.id,
      done: false,
    })),
    dueDate: null,
    startDate: null,
    estimateMinutes: null,
    order: Date.now(),
    source: 'seo-optimization-orchestration',
    sourceSprintId: args.sprintId,
    sourceOptimizationIds: optimizations.map((optimization) => optimization.id),
    reporterId: args.actor.uid,
    createdBy: args.actor.uid,
    updatedAt: FieldValue.serverTimestamp(),
    assigneeAgentId: 'pip',
    agentInput: {
      spec: description,
      context: {
        assignmentMode: 'orchestration',
        orchestrationMode: 'pip-orchestrator',
        source: 'seo-optimization-loop',
        sprintId: args.sprintId,
        orgId,
        runDate,
        optimizationIds: optimizations.map((optimization) => optimization.id),
        requestedAgentIds: ['theo', 'maya', 'sage', 'nora'],
      },
      constraints: [
        'Pip owns orchestration for SEO optimization proposals.',
        'Use the seo-sprint-manager skill and keep the SEO sprint progress ledger updated.',
        'Approve only useful proposals, execute generated SEO tasks where appropriate, and create blocker handoffs for human/client/admin needs.',
      ],
    },
  }
  if (!existingProjectTask.exists) projectTaskData.createdAt = FieldValue.serverTimestamp()
  if (shouldQueueAgent) projectTaskData.agentStatus = 'pending'
  await projectTaskRef.set(projectTaskData, { merge: true })

  await adminDb.collection('seo_agent_handoffs').doc(`${args.sprintId}_optimization_${runDate}`).set({
    orgId,
    sprintId: args.sprintId,
    runDate,
    kind: 'optimization',
    status: shouldQueueAgent ? 'queued' : currentAgentStatus,
    projectId: projectRef.id,
    projectTaskId: projectTaskRef.id,
    optimizationIds: optimizations.map((optimization) => optimization.id),
    updatedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
  }, { merge: true })

  await Promise.all(optimizations.map((optimization) => adminDb.collection('seo_optimizations').doc(optimization.id).set({
    agentProjectId: projectRef.id,
    agentProjectTaskId: projectTaskRef.id,
    agentQueuedAt: FieldValue.serverTimestamp(),
  }, { merge: true })))

  return {
    projectId: projectRef.id,
    projectTaskId: projectTaskRef.id,
    optimizationIds: optimizations.map((optimization) => optimization.id),
  }
}

export async function ensureSeoBlockerHandoff(args: {
  taskId: string
  reason?: string | null
  actor: ApiUser
}) {
  const taskRef = adminDb.collection('seo_tasks').doc(args.taskId)
  const taskSnap = await taskRef.get()
  if (!taskSnap.exists) return null

  const task = taskSnap.data() as SeoTaskRecord
  const orgId = text(task.orgId)
  const sprintId = text(task.sprintId)
  if (!orgId || !sprintId) return null

  const reason = text(args.reason) ?? 'SEO task is blocked; no blocker reason was provided.'
  const handoffRef = adminDb.collection('seo_blocker_handoffs').doc(args.taskId)
  const existing = await handoffRef.get()
  const existingData = existing.exists ? existing.data() as Record<string, unknown> : null
  if (
    existingData?.status === 'open' &&
    existingData.reason === reason &&
    text(existingData.projectTaskId)
  ) {
    return {
      projectId: text(existingData.projectId),
      projectTaskId: text(existingData.projectTaskId),
      alreadyOpen: true,
    }
  }

  const sprintSnap = await adminDb.collection('seo_sprints').doc(sprintId).get()
  if (!sprintSnap.exists) return null
  const sprint = sprintSnap.data() as SeoSprintRecord
  const projectRef = await ensureSeoProject({ orgId, sprintId, sprint, actor: args.actor })
  const description = blockerTaskDescription({ taskId: args.taskId, sprintId, sprint, task, reason })
  const title = `Team action: unblock SEO - ${text(task.title) ?? args.taskId}`
  const existingProjectTaskId = text(existingData?.projectTaskId)
  const projectTaskRef = existingProjectTaskId
    ? projectRef.collection('tasks').doc(existingProjectTaskId)
    : projectRef.collection('tasks').doc()

  const taskDoc: Record<string, unknown> = {
    orgId,
    projectId: projectRef.id,
    columnId: 'blocked',
    title,
    description,
    priority: 'urgent',
    assigneeId: null,
    assigneeIds: [],
    mentionIds: [],
    labels: [
      'seo',
      'seo-blocker',
      `seo-sprint:${sprintId}`,
      `seo-task:${args.taskId}`,
      'team-action',
      'blocked',
      'needs-assignment',
    ],
    checklist: [
      { id: 'fix', text: 'Resolve the blocker described above', done: false },
      { id: 'proof', text: 'Attach proof or confirmation', done: false },
      { id: 'agent', text: 'Send the provided unblock message back to the agent', done: false },
    ],
    dueDate: null,
    startDate: null,
    estimateMinutes: null,
    order: Date.now(),
    source: 'seo-blocker-handoff',
    sourceSprintId: sprintId,
    sourceSeoTaskId: args.taskId,
    reporterId: args.actor.uid,
    createdBy: args.actor.uid,
    updatedAt: FieldValue.serverTimestamp(),
  }
  if (!existingProjectTaskId) taskDoc.createdAt = FieldValue.serverTimestamp()
  await projectTaskRef.set(taskDoc, { merge: true })

  const recipients = await adminRecipientsForOrg(orgId)
  for (const recipient of recipients) {
    await adminDb.collection('notifications').add({
      orgId,
      userId: recipient.id,
      agentId: null,
      type: 'seo.blocked',
      title: 'SEO sprint blocked',
      body: `${text(sprint.siteName) ?? 'SEO sprint'}: ${text(task.title) ?? args.taskId}`,
      link: `/admin/projects/${projectRef.id}?task=${projectTaskRef.id}`,
      data: {
        sprintId,
        seoTaskId: args.taskId,
        projectId: projectRef.id,
        projectTaskId: projectTaskRef.id,
        reason,
      },
      status: 'unread',
      priority: 'high',
      snoozedUntil: null,
      readAt: null,
      createdAt: FieldValue.serverTimestamp(),
    })
  }

  await handoffRef.set({
    orgId,
    sprintId,
    seoTaskId: args.taskId,
    reason,
    status: 'open',
    projectId: projectRef.id,
    projectTaskId: projectTaskRef.id,
    notifiedAdminIds: recipients.map((recipient) => recipient.id),
    updatedAt: FieldValue.serverTimestamp(),
    createdAt: existingData?.createdAt ?? FieldValue.serverTimestamp(),
  }, { merge: true })

  await taskRef.set({
    blockerProjectId: projectRef.id,
    blockerProjectTaskId: projectTaskRef.id,
    blockerNotifiedAt: FieldValue.serverTimestamp(),
    blockerReason: reason,
  }, { merge: true })

  return {
    projectId: projectRef.id,
    projectTaskId: projectTaskRef.id,
    alreadyOpen: false,
  }
}

export async function resolveSeoBlockerHandoff(taskId: string, actor: ApiUser) {
  const handoffRef = adminDb.collection('seo_blocker_handoffs').doc(taskId)
  const handoffSnap = await handoffRef.get()
  if (!handoffSnap.exists) return
  const handoff = handoffSnap.data() as Record<string, unknown>
  if (handoff.status !== 'open') return
  const projectId = text(handoff.projectId)
  const projectTaskId = text(handoff.projectTaskId)
  if (projectId && projectTaskId) {
    await adminDb
      .collection('projects')
      .doc(projectId)
      .collection('tasks')
      .doc(projectTaskId)
      .set({
        columnId: 'done',
        labels: FieldValue.arrayUnion('resolved'),
        agentStatus: 'done',
        agentOutput: {
          summary: `SEO blocker resolved by ${actor.uid}.`,
          completedAt: FieldValue.serverTimestamp(),
        },
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
  }
  await handoffRef.set({
    status: 'resolved',
    resolvedBy: actor.uid,
    resolvedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
}
