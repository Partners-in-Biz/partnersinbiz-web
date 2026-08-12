import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { lastActorFrom } from '@/lib/api/actor'
import { getProjectForUser } from '@/lib/projects/access'
import {
  applyAgentColumnMoveState,
  buildProjectTaskUpdateData,
  notificationPriority,
  validateDispatchableAgentTaskContract,
} from '@/lib/projects/taskPayload'
import { isAgentOwnedTask } from '@/lib/tasks/agentState'
import { validateCompletionEvidence } from '@/lib/projects/completionIntegrity'
import { logActivity } from '@/lib/activity/log'
import { adminProjectTaskLink } from '@/lib/projects/links'
import { buildBlockedTaskRecovery } from '@/lib/projects/blockerRecovery'
import { resolveContextReferences } from '@/lib/context-references/registry'
import { sanitizeContextReferenceSeeds, type ContextReference } from '@/lib/context-references/types'
import {
  isProjectTaskPlanningMutation,
} from '@/lib/projects/planningDiscovery'
import { planningContextMutationTransition } from '@/lib/projects/planningDiscoveryStore'
import { canProjectRole, filterProjectItemsForAccess } from '@/lib/projects/collaboration'
import { applyTaskLlmCredentialResolution } from '@/lib/projects/apply-task-llm'
import { applyOrgChartToAssignment, applyOrgDefaultsToTaskFields } from '@/lib/agent-org/taskHooks'
import { publishTaskLifecycleToCommandSession } from '@/lib/projects/commandSession'
import { approvalActorAuditFields, isAuthorizedAdminApprover } from '@/lib/projects/adminApprover'
import { hasApprovalGateMarker, reconcileApprovalGateUpdate } from '@/lib/projects/approvalState'
import { removeProjectTaskReadModelTask, upsertProjectTaskReadModel } from '@/lib/projects/taskReadModelStore'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ projectId: string; taskId: string }> }

function applyPlanningMutation(
  tx: FirebaseFirestore.Transaction,
  projectRef: FirebaseFirestore.DocumentReference,
  projectId: string,
  project: Record<string, unknown>,
  actorUid: string,
  reason: string,
  options: { reopenWhenReady?: boolean } = {},
) {
  const transition = planningContextMutationTransition(project, {
    uid: actorUid,
    now: new Date().toISOString(),
    reason,
    // Task create/update are outputs of a confirmed brief, not brief rewrites.
    // Only explicit scope writers (docs/suite/delete) should reopen when ready.
    reopenWhenReady: options.reopenWhenReady,
  })
  if (transition.state) {
    tx.update(projectRef, { planningDiscovery: transition.state, updatedAt: FieldValue.serverTimestamp() })
  }
  if (transition.event) {
    tx.set(projectRef.collection('planningDiscoveryEvents').doc(), {
      ...transition.event,
      projectId,
      orgId: project.orgId ?? null,
      schemaVersion: 1,
      reason,
    })
  }
  return transition
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function projectRequestOrgScope(req: NextRequest, user: Parameters<typeof getProjectForUser>[1]) {
  const explicitOrgId = req.headers.get('x-org-id')?.trim() || ''
  const isAgentActor = user.role === 'ai' || user.authKind === 'user_delegation'
  if (isAgentActor && !explicitOrgId) {
    return { ok: false as const, response: apiError('X-Org-Id is required for agent project task access', 400) }
  }
  if (isAgentActor && user.orgId && explicitOrgId !== user.orgId) {
    return { ok: false as const, response: apiError('Agent organisation scope does not match X-Org-Id', 403) }
  }
  return { ok: true as const, orgId: explicitOrgId || undefined }
}

function taskIsVisible(
  taskId: string,
  task: Record<string, unknown>,
  access: Extract<Awaited<ReturnType<typeof getProjectForUser>>, { ok: true }>,
  user: Parameters<typeof getProjectForUser>[1],
): boolean {
  return filterProjectItemsForAccess([{ id: taskId, ...task }], {
    projectAccess: access.projectAccess,
    user,
  }).length === 1
}

function agentInputWithContextRefs(
  agentInput: unknown,
  contextRefs: ContextReference[],
): Record<string, unknown> | null {
  if (!isRecord(agentInput)) return null
  const existingContext = isRecord(agentInput.context) ? agentInput.context : {}
  return {
    ...agentInput,
    context: {
      ...existingContext,
      contextRefs,
    },
  }
}

function isApprovalGateRecord(data: Record<string, unknown>, nextBody: Record<string, unknown> = {}): boolean {
  return hasApprovalGateMarker(data, nextBody)
}

export const GET = withAuth('client', async (req: NextRequest, user, ctx) => {
  const { projectId, taskId } = await (ctx as RouteContext).params
  const scope = projectRequestOrgScope(req, user)
  if (!scope.ok) return scope.response
  const access = await getProjectForUser(projectId, user, scope.orgId, { action: 'project.read', item: taskId })
  if (!access.ok) return apiError(access.error, access.status)

  const doc = await adminDb.collection('projects').doc(projectId).collection('tasks').doc(taskId).get()
  if (!doc.exists) return apiError('Task not found', 404)
  const task = doc.data() ?? {}
  if (!taskIsVisible(taskId, task, access, user)) return apiError('Task not found', 404)
  return apiSuccess({ id: taskId, ...task })
})

async function approvalGateTaskApproved(projectId: string, approvalGateTaskId: string): Promise<boolean> {
  const gateDoc = await adminDb.collection('projects').doc(projectId).collection('tasks').doc(approvalGateTaskId).get()
  if (!gateDoc.exists) return false
  return gateDoc.data()?.approvalStatus === 'approved'
}

export const PATCH = withAuth('client', async (req: NextRequest, user, ctx) => {
  const { projectId, taskId } = await (ctx as RouteContext).params
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const scope = projectRequestOrgScope(req, user)
  if (!scope.ok) return scope.response
  const access = await getProjectForUser(projectId, user, scope.orgId, { action: 'project.write', item: taskId })
  if (!access.ok) return apiError(access.error, access.status)
  if (!canProjectRole(access.projectAccess?.role ?? 'viewer', 'write')) {
    return apiError('Project contributor access is required to update tasks', 403)
  }
  const planningSensitive = isProjectTaskPlanningMutation(body)

  const ref = adminDb.collection('projects').doc(projectId).collection('tasks').doc(taskId)
  const doc = await ref.get()
  if (!doc.exists) return apiError('Task not found', 404)

  const existing = doc.data() ?? {}
  if (!taskIsVisible(taskId, existing, access, user)) return apiError('Task not found', 404)
  const existingApprovalGateTaskId = typeof existing.approvalGateTaskId === 'string' && existing.approvalGateTaskId.trim().length > 0
  const isApprovalGateCard = isApprovalGateRecord(existing, body)
  const isApprovalGatedTask = isApprovalGateCard || existingApprovalGateTaskId
  const adminApprover = isAuthorizedAdminApprover(user)
  const approvalMetadataFields = [
    'approvalGate',
    'requiredCapability',
    'riskLevel',
    'expectedArtifacts',
    'verifierChecklist',
    'approvalGateTaskId',
    'sourceDocumentId',
    'sourceDocumentSectionId',
    'sourceSpecVersion',
    'sourceResearchItemId',
  ]
  const approvalExecutionFields = [
    'columnId',
    'reviewStatus',
    'labels',
    'agentStatus',
    'assigneeAgentId',
    'agentOutput',
    'agentConversationId',
    'agentHeartbeatAt',
    'agentReleaseAt',
    'agentReleaseStatus',
    'agentReleasedAt',
  ]
  if (body.approvalStatus !== undefined && !adminApprover) {
    return apiError('Only an admin approver can change approvalStatus on project tasks', 403)
  }
  if (!adminApprover && approvalMetadataFields.some((field) => body[field] !== undefined)) {
    return apiError('Only an admin approver can change approval-gate metadata on project tasks', 403)
  }
  if (body.approvalStatus !== undefined && body.approvalStatus !== null && !isApprovalGatedTask) {
    return apiError('approvalStatus can only be changed on approval-gated tasks', 400)
  }
  const updates = buildProjectTaskUpdateData(body)
  if (!updates.ok) return apiError(updates.error, updates.status ?? 400)
  let updateValue = applyAgentColumnMoveState(existing, updates.value, body)

  // Authorisation before state reconciliation so unauthorised callers get 403,
  // not a 400 from canonical state rules they were never allowed to attempt.
  const touchesApprovalExecutionState = approvalExecutionFields.some((field) => updateValue[field] !== undefined)
  if (!adminApprover && isApprovalGateCard && touchesApprovalExecutionState) {
    return apiError('Only an admin approver can change approval-gate metadata on project tasks', 403)
  }
  if (!adminApprover && existingApprovalGateTaskId && touchesApprovalExecutionState) {
    const approved = await approvalGateTaskApproved(projectId, String(existing.approvalGateTaskId))
    if (!approved) return apiError('Only an admin approver can change approval-gate metadata on project tasks', 403)
  }

  const reconciled = reconcileApprovalGateUpdate(existing, updateValue, body, isApprovalGateCard)
  if (!reconciled.ok) return apiError(reconciled.error, reconciled.status)
  updateValue = reconciled.value

  // A task can become high-risk or gain an agent after creation. Validate the
  // merged record when the caller makes it dispatchable, so an incomplete task
  // cannot be constructed through a sequence of individually-valid PATCH calls.
  const dispatchContractTouched = body.assigneeAgentId !== undefined
    || body.riskLevel !== undefined
    || body.agentInput !== undefined
    || body.requiredCapability !== undefined
    || body.agentStatus === 'pending'
  if (dispatchContractTouched) {
    const nextTaskContract = validateDispatchableAgentTaskContract({ ...existing, ...updateValue })
    if (!nextTaskContract.ok) return apiError(nextTaskContract.error, nextTaskContract.status ?? 400)
  }

  // Completion is a watcher-verifiable state transition, never an agent narrative
  // shortcut. The watcher writes completionVerification only after it has checked
  // the typed evidence (including origin/development reachability for code work).
  const isAgentTask = isAgentOwnedTask(existing, body, updateValue)
  const attemptsCompletion = updateValue.agentStatus === 'done'
    || updateValue.columnId === 'done'
    || updateValue.reviewStatus === 'approved'
  const evidence = validateCompletionEvidence(
    updateValue.completionEvidence !== undefined ? updateValue.completionEvidence : existing.completionEvidence,
  )
  const existingVerification = isRecord(existing.completionVerification) ? existing.completionVerification : null
  const evidenceChanged = updateValue.completionEvidence !== undefined
    && updateValue.completionEvidence !== existing.completionEvidence
  const evidenceCleared = updateValue.completionEvidence === null
    || (updateValue.completionVerification === null && updateValue.completionEvidence === null)
  const verificationFresh = !evidenceChanged && !evidenceCleared
  const watcherVerified = evidence.ok
    && verificationFresh
    && existingVerification?.verifierIdentity === 'agent-watcher'
    && existingVerification.verifierResult === 'passed'
    && (evidence.evidence.workKind !== 'code' || (
      existingVerification.commitReachable === true
      && existingVerification.changedFilesMatch === true
      && existingVerification.worktreeClean === true
    ))
  const reviewerAgentId = updateValue.reviewerAgentId ?? existing.reviewerAgentId
  const reviewerIds = updateValue.reviewerIds ?? existing.reviewerIds
  const hasReviewer = Boolean(
    (typeof reviewerAgentId === 'string' && reviewerAgentId.trim())
    || (Array.isArray(reviewerIds) && reviewerIds.some((id) => typeof id === 'string' && id.trim())),
  )
  const reviewerApproved = !hasReviewer || existing.reviewStatus === 'approved' || updateValue.reviewStatus === 'approved'
  const completionVerified = watcherVerified && reviewerApproved
  if (isAgentTask && !isApprovalGateCard && attemptsCompletion && !completionVerified) {
    const priorOutput = isRecord(updateValue.agentOutput)
      ? updateValue.agentOutput
      : isRecord(existing.agentOutput) ? existing.agentOutput : {}
    const priorSummary = typeof priorOutput.summary === 'string' ? priorOutput.summary.trim() : ''
    const exactReason = 'completion_integrity_verification_required'
    updateValue = {
      ...updateValue,
      agentStatus: 'blocked',
      columnId: 'blocked',
      reviewStatus: 'changes-requested',
      agentHeartbeatAt: null,
      completionIntegrityFailureReasons: [exactReason],
      agentOutput: {
        ...priorOutput,
        summary: `${priorSummary ? `${priorSummary}\n\n` : ''}Completion integrity blocked: ${exactReason}. Submit structured completionEvidence and let the watcher verify it before Done or approval.`,
      },
    }
  }

  // Record human (or delegated-human) approval audit fields when status changes.
  if (body.approvalStatus !== undefined && adminApprover) {
    const previous = typeof existing.approvalStatus === 'string' ? existing.approvalStatus.trim().toLowerCase() : ''
    const next = typeof updateValue.approvalStatus === 'string' ? updateValue.approvalStatus.trim().toLowerCase() : ''
    if (next && next !== previous) {
      Object.assign(updateValue, approvalActorAuditFields(user), {
        approvedAt: next === 'approved' || next === 'rejected' || next === 'denied'
          ? new Date().toISOString()
          : null,
      })
    }
  }
  const projectOrgId = access.doc.data()?.orgId as string | undefined
  const actorFields = lastActorFrom(user)
  Object.assign(updateValue, {
    updatedBy: actorFields.updatedBy,
    updatedByType: actorFields.updatedByType,
    ...(actorFields.updatedByAgentId ? { updatedByAgentId: actorFields.updatedByAgentId } : {}),
  })

  // Org-chart gate: relationship enforcement + node defaults on reassignment.
  const effectiveAssignee = typeof updateValue.assigneeAgentId === 'string'
    ? updateValue.assigneeAgentId
    : (typeof existing.assigneeAgentId === 'string' ? existing.assigneeAgentId : null)
  if (effectiveAssignee && typeof projectOrgId === 'string' && projectOrgId) {
    const orgGate = await applyOrgChartToAssignment({
      orgId: projectOrgId,
      user,
      assigneeAgentId: effectiveAssignee,
    })
    if (!orgGate.ok) return apiError(orgGate.error ?? 'Org chart does not permit this assignment', orgGate.status ?? 403)
    if (orgGate.defaults) {
      const bag: { agentModel: string | null; agentEffort: string | null } = {
        agentModel: updateValue.agentModel !== undefined ? updateValue.agentModel : existing.agentModel,
        agentEffort: updateValue.agentEffort !== undefined ? updateValue.agentEffort : existing.agentEffort,
      }
      applyOrgDefaultsToTaskFields(bag, orgGate.defaults)
      if (updateValue.agentModel === undefined && bag.agentModel !== existing.agentModel) updateValue.agentModel = bag.agentModel
      if (updateValue.agentEffort === undefined && bag.agentEffort !== existing.agentEffort) updateValue.agentEffort = bag.agentEffort
    }
  }

  if (body.contextRefs !== undefined) {
    const contextRefs = await resolveContextReferences(
      sanitizeContextReferenceSeeds(body.contextRefs),
      user,
      projectOrgId,
    )
    updateValue.contextRefs = contextRefs
    const nextAgentInput = agentInputWithContextRefs(updateValue.agentInput ?? existing.agentInput, contextRefs)
    if (nextAgentInput) updateValue.agentInput = nextAgentInput
  }

  const llmFieldsTouched = [
    'llmCredentialSource',
    'agentProvider',
    'agentModel',
    'assigneeAgentId',
    'agentRuntimeTargetId',
  ].some((field) => body[field] !== undefined)
  if (llmFieldsTouched && typeof projectOrgId === 'string' && projectOrgId) {
    const mergedForResolve: Record<string, unknown> = {
      llmCredentialSource: updateValue.llmCredentialSource ?? existing.llmCredentialSource ?? 'auto',
      agentProvider: updateValue.agentProvider !== undefined ? updateValue.agentProvider : existing.agentProvider,
      agentModel: updateValue.agentModel !== undefined ? updateValue.agentModel : existing.agentModel,
    }
    await applyTaskLlmCredentialResolution({
      orgId: projectOrgId,
      ownerUid: typeof existing.createdBy === 'string' && existing.createdBy
        ? existing.createdBy
        : (typeof existing.reporterId === 'string' && existing.reporterId ? existing.reporterId : user.uid),
      user,
      taskFields: mergedForResolve,
      syncPersonal: true,
      runtimeTargetId: typeof existing.agentRuntimeTargetId === 'string' ? existing.agentRuntimeTargetId : null,
    })
    updateValue.llmCredentialSource = mergedForResolve.llmCredentialSource
    updateValue.agentProvider = mergedForResolve.agentProvider
    updateValue.llmCredentialOwnerUid = mergedForResolve.llmCredentialOwnerUid
    updateValue.llmResolvedSource = mergedForResolve.llmResolvedSource
    updateValue.llmConnectionId = mergedForResolve.llmConnectionId
  }

  // Sentinel swap — the payload builder is pure JSON and can't emit FieldValue.serverTimestamp() itself.
  if (updateValue.agentHeartbeatAt === '__server_timestamp__') {
    updateValue.agentHeartbeatAt = FieldValue.serverTimestamp()
  }

  const projectRef = adminDb.collection('projects').doc(projectId)
  // Planning-sensitive task patches require a live confirmed Decision Brief, but
  // ordinary project_task.updated must NOT reopen/stale that brief. False reopen
  // made approved projects look blocked again after routine title/label/dueDate
  // or enrichment writes. Intentional brief invalidation stays on docs/suite/delete.
  const mutation = await adminDb.runTransaction(async (tx) => {
    let liveProject: FirebaseFirestore.DocumentSnapshot | null = null
    if (planningSensitive) {
      liveProject = await tx.get(projectRef)
      if (!liveProject.exists) return { ok: false as const, status: 404, error: 'Project not found' }
    }
    const liveTask = await tx.get(ref)
    if (!liveTask.exists) return { ok: false as const, status: 404, error: 'Task not found' }
    if (liveProject) {
      const project = (liveProject.data() ?? {}) as Record<string, unknown>
      const planning = applyPlanningMutation(
        tx,
        projectRef,
        projectId,
        project,
        user.uid,
        'project_task.updated',
        { reopenWhenReady: false },
      )
      if (!planning.allowed) {
        return { ok: false as const, status: 409, error: planning.blocker.message, details: planning.blocker }
      }
    }
    tx.update(ref, { ...updateValue, updatedAt: FieldValue.serverTimestamp() })
    return { ok: true as const }
  })
  if (!mutation.ok) return apiError(mutation.error, mutation.status, mutation.details)

  await upsertProjectTaskReadModel(projectId, taskId, { ...existing, ...updateValue }).catch(() => {})

  if (projectOrgId) {
    const approvalChanged = body.approvalStatus !== undefined
      && String(existing.approvalStatus ?? '') !== String(updateValue.approvalStatus ?? '')
    logActivity({
      orgId: projectOrgId,
      type: approvalChanged ? 'task_approval_updated' : 'task_updated',
      actorId: user.uid,
      actorName: user.uid,
      actorRole: user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client',
      description: approvalChanged
        ? `Approval status set to ${String(updateValue.approvalStatus ?? '')}${user.authKind === 'user_delegation' && user.agentId ? ` via delegated agent ${user.agentId}` : ''}`
        : 'Updated task',
      entityId: taskId,
      entityType: 'task',
      entityTitle: (updateValue.title as string | undefined) ?? undefined,
    }).catch(() => {})
  }

  // Notify reporter when agent marks task done
  const agentJustDone = updateValue.agentStatus === 'done' && existing.agentStatus !== 'done'
  if (agentJustDone && projectOrgId) {
    const reporterId = typeof existing.reporterId === 'string' ? existing.reporterId : typeof existing.createdBy === 'string' ? existing.createdBy : null
    const agentId = typeof updateValue.assigneeAgentId === 'string' ? updateValue.assigneeAgentId : typeof existing.assigneeAgentId === 'string' ? existing.assigneeAgentId : 'agent'
    const taskTitle = String(existing.title ?? 'Task')
    if (reporterId && reporterId !== user.uid) {
      adminDb.collection('notifications').add({
        orgId: projectOrgId,
        userId: reporterId,
        agentId: null,
        type: 'task.agent_done',
        title: `${agentId.charAt(0).toUpperCase() + agentId.slice(1)} finished a task`,
        body: taskTitle,
        link: await adminProjectTaskLink({ db: adminDb, orgId: projectOrgId, projectId, taskId }),
        data: { projectId, taskId },
        status: 'unread',
        priority: notificationPriority(existing.priority),
        snoozedUntil: null,
        readAt: null,
        createdAt: FieldValue.serverTimestamp(),
      }).catch(() => {})
    }
  }

  const agentJustNeedsInput = (updateValue.agentStatus === 'awaiting-input' || updateValue.agentStatus === 'blocked')
    && updateValue.agentStatus !== existing.agentStatus
  if (agentJustNeedsInput && projectOrgId) {
    const reporterId = typeof existing.reporterId === 'string' ? existing.reporterId : typeof existing.createdBy === 'string' ? existing.createdBy : null
    const agentId = typeof updateValue.assigneeAgentId === 'string' ? updateValue.assigneeAgentId : typeof existing.assigneeAgentId === 'string' ? existing.assigneeAgentId : 'agent'
    const nextTask = { ...existing, ...updateValue, id: taskId }
    const recovery = buildBlockedTaskRecovery(nextTask)
    const link = await adminProjectTaskLink({ db: adminDb, orgId: projectOrgId, projectId, taskId })
    if (reporterId && reporterId !== user.uid) {
      adminDb.collection('notifications').add({
        orgId: projectOrgId,
        userId: reporterId,
        agentId,
        type: 'task.agent_needs_input',
        title: `${agentId.charAt(0).toUpperCase() + agentId.slice(1)} needs Peet to continue`,
        body: `Exact blocker: ${recovery.blockingReason}. Proof needed: ${recovery.requiredEvidence}. Message for agent: ${recovery.messageForAgent}`,
        link,
        data: {
          projectId,
          taskId,
          taskTitle: String(existing.title ?? 'Task'),
          blockerReason: recovery.blockingReason,
          safeContinuePath: `${recovery.continueActionLabel}: add approval/input evidence in the task drawer, then use the safe continue/unblock action.`,
        },
        status: 'unread',
        priority: 'high',
        snoozedUntil: null,
        readAt: null,
        createdAt: FieldValue.serverTimestamp(),
      }).catch(() => {})
    }
  }

  // Feed the project command session (and auto-wake lead agent when configured).
  // Publish on agentStatus change, or when a card is accepted into Done (even if
  // agentStatus was already done with a stale Review badge).
  const agentStatusChanged = typeof updateValue.agentStatus === 'string' && updateValue.agentStatus !== existing.agentStatus
  const acceptedIntoDone = updateValue.columnId === 'done' && existing.columnId !== 'done'
  if (projectOrgId && (agentStatusChanged || acceptedIntoDone)) {
    const agentId = typeof updateValue.assigneeAgentId === 'string'
      ? updateValue.assigneeAgentId
      : typeof existing.assigneeAgentId === 'string'
        ? existing.assigneeAgentId
        : null
    const nextTask = { ...existing, ...updateValue, id: taskId }
    const lifecycleStatus = typeof updateValue.agentStatus === 'string'
      ? updateValue.agentStatus
      : acceptedIntoDone
        ? 'done'
        : typeof existing.agentStatus === 'string'
          ? existing.agentStatus
          : 'done'
    const recovery = (lifecycleStatus === 'blocked' || lifecycleStatus === 'awaiting-input')
      ? buildBlockedTaskRecovery(nextTask)
      : null
    const chatOrigin = isRecord(existing.chatOrigin) ? existing.chatOrigin : null
    const agentOutput = isRecord(updateValue.agentOutput)
      ? updateValue.agentOutput
      : isRecord(existing.agentOutput)
        ? existing.agentOutput
        : null
    void publishTaskLifecycleToCommandSession({
      projectId,
      orgId: projectOrgId,
      taskId,
      taskTitle: String(existing.title ?? 'Task'),
      agentId,
      agentStatus: lifecycleStatus,
      previousAgentStatus: typeof existing.agentStatus === 'string' ? existing.agentStatus : null,
      summary: typeof agentOutput?.summary === 'string' ? agentOutput.summary : undefined,
      blockingReason: recovery?.blockingReason,
      requiredEvidence: recovery?.requiredEvidence,
      messageForAgent: recovery?.messageForAgent,
      runId: typeof updateValue.agentConversationId === 'string'
        ? updateValue.agentConversationId
        : typeof existing.agentConversationId === 'string'
          ? existing.agentConversationId
          : null,
      chatOriginConversationId: typeof chatOrigin?.conversationId === 'string' ? chatOrigin.conversationId : null,
    }).catch(() => {})

    // Workflow Graph engine write-back: only for tasks stamped with workflowRunId.
    // Proven-done is enforced in the engine (expectedArtifacts); false-done is rejected.
    // Await + surface errors — do not fire-and-forget (silent ledger stall).
    if (typeof existing.workflowRunId === 'string' && existing.workflowRunId) {
      const workflowOutcome =
        lifecycleStatus === 'done' || acceptedIntoDone
          ? 'done' as const
          : lifecycleStatus === 'awaiting-input'
            ? 'awaiting_input' as const
            : lifecycleStatus === 'blocked'
              ? 'blocked' as const
              : null
      if (workflowOutcome) {
        const telemetry = isRecord(agentOutput?.telemetry) ? agentOutput.telemetry : null
        try {
          const { handleKanbanTaskTerminalForWorkflow } = await import('@/lib/workflow-graph')
          const writeback = await handleKanbanTaskTerminalForWorkflow({
            task: { ...existing, ...updateValue, id: taskId, agentOutput },
            outcome:
              workflowOutcome === 'done'
              && String(updateValue.approvalStatus ?? existing.approvalStatus ?? '') === 'rejected'
                ? 'rejected'
                : workflowOutcome,
            summary: typeof agentOutput?.summary === 'string' ? agentOutput.summary : undefined,
            tokensIn: typeof telemetry?.inputTokens === 'number' ? telemetry.inputTokens : undefined,
            tokensOut: typeof telemetry?.outputTokens === 'number' ? telemetry.outputTokens : undefined,
            tokensTotal: typeof telemetry?.totalTokens === 'number' ? telemetry.totalTokens : undefined,
            estimatedCost: typeof telemetry?.costUsd === 'number' ? telemetry.costUsd : undefined,
            model: typeof telemetry?.model === 'string' ? telemetry.model : undefined,
            provider: typeof telemetry?.provider === 'string' ? telemetry.provider : undefined,
            hermesRunId: typeof updateValue.agentConversationId === 'string'
              ? updateValue.agentConversationId
              : typeof existing.agentConversationId === 'string'
                ? existing.agentConversationId
                : undefined,
            actorUid: user.uid,
          })
          if (!writeback.ok && !writeback.skipped) {
            console.error('[workflow-graph] kanban write-back failed', {
              taskId,
              runId: existing.workflowRunId,
              error: writeback.error,
            })
          }
        } catch (err) {
          console.error('[workflow-graph] kanban write-back threw', {
            taskId,
            runId: existing.workflowRunId,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
    }
  }

  const previousAssignees = new Set(Array.isArray(existing.assigneeIds) ? existing.assigneeIds : existing.assigneeId ? [existing.assigneeId] : [])
  const nextAssignees = Array.isArray(updates.value.assigneeIds)
    ? updates.value.assigneeIds.filter((id): id is string => typeof id === 'string')
    : updates.value.assigneeId
      ? [String(updates.value.assigneeId)]
      : []
  const newAssignees = nextAssignees.filter(id => !previousAssignees.has(id) && id !== user.uid)

  if (newAssignees.length > 0) {
    const projectDoc = await adminDb.collection('projects').doc(projectId).get()
    const orgId = projectDoc.data()?.orgId
    if (typeof orgId === 'string') {
      const title = String(updates.value.title ?? existing.title ?? 'Task')
      for (const userId of newAssignees) {
        adminDb.collection('notifications').add({
          orgId,
          userId,
          agentId: null,
          type: 'task.assigned',
          title: 'Task assigned to you',
          body: title,
          link: await adminProjectTaskLink({ db: adminDb, orgId, projectId, taskId }),
          data: { projectId, taskId },
          status: 'unread',
          priority: notificationPriority(updates.value.priority ?? existing.priority),
          snoozedUntil: null,
          readAt: null,
          createdAt: FieldValue.serverTimestamp(),
        }).catch(() => {})
      }
    }
  }

  return apiSuccess({ id: taskId })
})

export const DELETE = withAuth('client', async (req: NextRequest, user, ctx) => {
  const { projectId, taskId } = await (ctx as RouteContext).params
  const scope = projectRequestOrgScope(req, user)
  if (!scope.ok) return scope.response
  const access = await getProjectForUser(projectId, user, scope.orgId, { action: 'project.write', item: taskId })
  if (!access.ok) return apiError(access.error, access.status)
  if (!canProjectRole(access.projectAccess?.role ?? 'viewer', 'write')) {
    return apiError('Project contributor access is required to delete tasks', 403)
  }

  const ref = adminDb.collection('projects').doc(projectId).collection('tasks').doc(taskId)
  const doc = await ref.get()
  if (!doc.exists) return apiError('Task not found', 404)

  const existing = doc.data() ?? {}
  if (!taskIsVisible(taskId, existing, access, user)) return apiError('Task not found', 404)
  const hasApprovalGateTaskId = typeof existing.approvalGateTaskId === 'string' && existing.approvalGateTaskId.trim().length > 0
  if (!isAuthorizedAdminApprover(user) && (isApprovalGateRecord(existing) || hasApprovalGateTaskId)) {
    return apiError('Only an admin approver can delete approval-gated project tasks', 403)
  }

  const projectRef = adminDb.collection('projects').doc(projectId)
  const mutation = await adminDb.runTransaction(async (tx) => {
    const liveProject = await tx.get(projectRef)
    const liveTask = await tx.get(ref)
    if (!liveProject.exists) return { ok: false as const, status: 404, error: 'Project not found' }
    if (!liveTask.exists) return { ok: false as const, status: 404, error: 'Task not found' }
    const project = (liveProject.data() ?? {}) as Record<string, unknown>
    const planning = applyPlanningMutation(tx, projectRef, projectId, project, user.uid, 'project_task.deleted')
    if (!planning.allowed) {
      return { ok: false as const, status: 409, error: planning.blocker.message, details: planning.blocker }
    }
    tx.delete(ref)
    return { ok: true as const }
  })
  if (!mutation.ok) return apiError(mutation.error, mutation.status, mutation.details)

  await removeProjectTaskReadModelTask(projectId, taskId).catch(() => {})

  const deleteOrgId = access.doc.data()?.orgId as string | undefined
  if (deleteOrgId) {
    logActivity({
      orgId: deleteOrgId,
      type: 'task_deleted',
      actorId: user.uid,
      actorName: user.uid,
      actorRole: user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client',
      description: 'Deleted task',
      entityId: taskId,
      entityType: 'task',
    }).catch(() => {})
  }

  return apiSuccess({ deleted: true })
})
