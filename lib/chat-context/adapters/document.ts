import type { ApiUser } from '@/lib/api/types'
import type { ChatContextAdapter } from '@/lib/chat-context/access'
import { genericChatContextAdapter } from '@/lib/chat-context/adapters/generic'
import type {
  ChatContextAction,
  ChatContextReadModel,
  ContextActivitySummary,
  ContextAttentionSummary,
  ContextDisplayState,
  ContextItemSummary,
} from '@/lib/chat-context/types'
import {
  clientLinkedOrgIdForUser,
  assertUserCanPerformOrganizationModuleAction,
} from '@/lib/organizations/module-policy-access'
import { getAccessibleClientDocument } from '@/lib/client-documents/access'
import { CLIENT_DOCUMENTS_COLLECTION } from '@/lib/client-documents/store'
import { getRecentDocumentRows } from '@/lib/client-documents/indexed-query'
import type {
  ClientDocument,
  ClientDocumentVersion,
  DocumentApproval,
  DocumentComment,
  DocumentSuggestion,
  DocumentTask,
} from '@/lib/client-documents/types'
import { adminDb } from '@/lib/firebase/admin'

type Row<T> = T & { id: string }

function clean(value: unknown, max = 240): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : ''
}

function dateString(value: unknown): string | undefined {
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString()
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  if (value && typeof value === 'object') {
    const raw = value as { toDate?: () => Date; toMillis?: () => number; seconds?: number; _seconds?: number }
    try {
      const converted = raw.toDate?.()
      if (converted && !Number.isNaN(converted.getTime())) return converted.toISOString()
      const millis = raw.toMillis?.()
      if (typeof millis === 'number' && Number.isFinite(millis)) return new Date(millis).toISOString()
      const seconds = raw.seconds ?? raw._seconds
      if (typeof seconds === 'number' && Number.isFinite(seconds)) return new Date(seconds * 1000).toISOString()
    } catch {
      return undefined
    }
  }
  return undefined
}

function titleCase(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function stateFor(status: ClientDocument['status']): ContextDisplayState {
  if (status === 'accepted' || status === 'approved') return 'complete'
  if (status === 'archived') return 'archived'
  if (status === 'client_review') return 'review'
  if (status === 'changes_requested' || status === 'internal_review') return 'needs_input'
  return 'ready'
}

function row<T>(snapshot: { id: string; data(): FirebaseFirestore.DocumentData }): Row<T> {
  return { id: snapshot.id, ...snapshot.data() } as Row<T>
}

function canAdminister(user: ApiUser): boolean {
  return user.role === 'admin' || user.role === 'ai'
}

export function documentChatActions(input: {
  document: ClientDocument
  user: ApiUser
  approvalPolicyAllows: boolean
  openComments: Array<Row<DocumentComment>>
  openSuggestions: Array<Row<DocumentSuggestion>>
  openTasks: Array<Row<DocumentTask>>
}): {
  document: ChatContextAction[]
  comments: Map<string, ChatContextAction[]>
  suggestions: Map<string, ChatContextAction[]>
  tasks: Map<string, ChatContextAction[]>
} {
  const id = encodeURIComponent(input.document.id)
  const documentActions: ChatContextAction[] = []
  const commentActions = new Map<string, ChatContextAction[]>()
  const suggestionActions = new Map<string, ChatContextAction[]>()
  const taskActions = new Map<string, ChatContextAction[]>()
  const admin = canAdminister(input.user)
  const clientMayReview = input.user.role !== 'client' || input.document.clientPermissions.canApprove

  const blockingAssumptions = input.document.assumptions.filter(
    (assumption) => assumption.status === 'open' && assumption.severity === 'blocks_publish',
  )
  const clientOrgIds = Array.from(new Set([
    ...(input.document.linked.clientOrgId ? [input.document.linked.clientOrgId] : []),
    ...(input.document.linked.clientOrgIds ?? []),
  ].map((orgId) => orgId.trim()).filter(Boolean)))

  if (
    admin
    && input.document.orgId
    && input.document.currentVersionId
    && clientOrgIds.length > 0
    && blockingAssumptions.length === 0
    && ['internal_draft', 'internal_review', 'changes_requested'].includes(input.document.status)
  ) {
    documentActions.push({
      id: `publish-document:${input.document.id}:${input.document.currentVersionId}`,
      label: clientOrgIds.length === 1
        ? 'Publish for client review'
        : `Publish to ${clientOrgIds.length} client organisations`,
      href: `/api/v1/client-documents/${id}/publish`,
      method: 'POST',
      requiresApproval: true,
      ...(clientOrgIds.length > 1 ? { body: { acknowledgeMultiOrgPublish: true } } : {}),
    })
  }

  if (
    input.approvalPolicyAllows
    && clientMayReview
    && input.document.approvalMode === 'operational'
    && input.document.status === 'client_review'
    && input.document.latestPublishedVersionId
  ) {
    documentActions.push({
      id: `approve-document:${input.document.id}:${input.document.latestPublishedVersionId}`,
      label: 'Approve published document',
      href: `/api/v1/client-documents/${id}/approve`,
      method: 'POST',
      requiresApproval: true,
    })
  }

  const clientMayComment = input.user.role !== 'client' || input.document.clientPermissions.canComment
  if (clientMayComment) {
    for (const comment of input.openComments) {
      commentActions.set(comment.id, [{
        id: `resolve-document-comment:${input.document.id}:${comment.id}`,
        label: 'Resolve comment',
        href: `/api/v1/client-documents/${id}/comments/${encodeURIComponent(comment.id)}/resolve`,
        method: 'POST',
        requiresApproval: true,
        body: { resolved: true },
      }])
    }
  }

  if (admin) {
    for (const suggestion of input.openSuggestions) {
      suggestionActions.set(suggestion.id, [
        {
          id: `accept-document-suggestion:${input.document.id}:${suggestion.id}`,
          label: 'Accept suggestion',
          href: `/api/v1/client-documents/${id}/suggestions/${encodeURIComponent(suggestion.id)}/accept`,
          method: 'POST',
          requiresApproval: true,
        },
        {
          id: `reject-document-suggestion:${input.document.id}:${suggestion.id}`,
          label: 'Reject suggestion',
          href: `/api/v1/client-documents/${id}/suggestions/${encodeURIComponent(suggestion.id)}/reject`,
          method: 'POST',
          destructive: true,
          requiresApproval: true,
        },
      ])
    }
  }

  for (const task of input.openTasks) {
    taskActions.set(task.id, [{
      id: `complete-document-task:${input.document.id}:${task.id}`,
      label: 'Mark task complete',
      href: `/api/v1/client-documents/${id}/tasks`,
      method: 'PATCH',
      requiresApproval: true,
      body: { taskId: task.id, completed: true },
    }])
  }

  return { document: documentActions, comments: commentActions, suggestions: suggestionActions, tasks: taskActions }
}

function activityFrom(
  comments: Array<Row<DocumentComment>>,
  approvals: Array<Row<DocumentApproval>>,
): ContextActivitySummary[] {
  const activity: ContextActivitySummary[] = [
    ...comments.flatMap((comment) => {
      const occurredAt = dateString(comment.createdAt)
      return occurredAt ? [{
        id: `comment:${comment.id}`,
        type: comment.status === 'resolved' ? 'verified_complete' as const : 'review_required' as const,
        label: comment.status === 'resolved' ? 'Comment resolved' : 'Comment added',
        occurredAt,
        detail: clean(comment.text),
        actorLabel: clean(comment.userName, 100),
      }] : []
    }),
    ...approvals.flatMap((approval) => {
      const occurredAt = dateString(approval.createdAt)
      return occurredAt ? [{
        id: `approval:${approval.id}`,
        type: 'verified_complete' as const,
        label: approval.mode === 'formal_acceptance' ? 'Document formally accepted' : 'Document approved',
        occurredAt,
        actorLabel: clean(approval.actorName, 100),
      }] : []
    }),
  ]
  return activity.sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt)).slice(0, 8)
}

export const documentChatContextAdapter: ChatContextAdapter = {
  async resolve(input) {
    if (input.kind !== 'document') {
      return { ok: false, reason: 'unsupported', status: 400, error: 'Unsupported document context' }
    }
    const base = await genericChatContextAdapter.resolve(input)
    if (!base.ok) return base
    const access = await getAccessibleClientDocument(input.id, input.user)
    if (!access.ok) {
      return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    }
    const document = access.document
    const policyOrgId = clientLinkedOrgIdForUser(document.linked, input.user, document.orgId)
    const approvalPolicy = policyOrgId
      ? await assertUserCanPerformOrganizationModuleAction(
          input.user,
          policyOrgId,
          'documents',
          'reviewApproval',
          'Document approval is disabled for your organisation role',
        )
      : { ok: true as const }

    const documentRef = adminDb.collection(CLIENT_DOCUMENTS_COLLECTION).doc(input.id)
    const [commentsSnap, suggestionsSnap, approvalsSnap, versionsSnap, taskRows] = await Promise.all([
      documentRef.collection('comments').get(),
      documentRef.collection('suggestions').get(),
      documentRef.collection('approvals').get(),
      documentRef.collection('versions').get(),
      getRecentDocumentRows({
        collectionName: 'document_tasks',
        documentId: input.id,
        orderField: 'createdAt',
        limit: 20,
      }),
    ])
    const comments = commentsSnap.docs.map((item) => row<DocumentComment>(item))
    const suggestions = suggestionsSnap.docs.map((item) => row<DocumentSuggestion>(item))
    const approvals = approvalsSnap.docs.map((item) => row<DocumentApproval>(item))
    const versions = versionsSnap.docs.map((item) => row<ClientDocumentVersion>(item))
    const tasks = taskRows.map((item) => item as unknown as Row<DocumentTask>)
    const openComments = comments.filter((comment) => comment.status === 'open')
    const openSuggestions = suggestions.filter((suggestion) => suggestion.status === 'open')
    const openTasks = tasks.filter((task) => task.completed !== true)
    const actions = documentChatActions({
      document,
      user: input.user,
      approvalPolicyAllows: approvalPolicy.ok,
      openComments,
      openSuggestions,
      openTasks,
    })
    const currentVersion = versions.find((version) => version.id === document.currentVersionId)
    const blockingAssumptions = document.assumptions.filter(
      (assumption) => assumption.status === 'open' && assumption.severity === 'blocks_publish',
    )
    const href = `/portal/documents/${encodeURIComponent(document.id)}?orgId=${encodeURIComponent(base.model.context.orgId)}`

    const reviewItems: ContextItemSummary[] = [
      ...openComments.slice(0, 6).map((comment) => ({
        id: `comment:${comment.id}`,
        label: clean(comment.text, 120) || 'Open comment',
        state: 'review' as const,
        detail: [clean(comment.userName, 80), clean(comment.blockId, 80) ? `Block ${clean(comment.blockId, 80)}` : ''].filter(Boolean).join(' · '),
        href,
        ...(dateString(comment.createdAt) ? { updatedAt: dateString(comment.createdAt) } : {}),
        ...(actions.comments.get(comment.id)?.length ? { actions: actions.comments.get(comment.id) } : {}),
      })),
      ...openSuggestions.slice(0, 6).map((suggestion) => ({
        id: `suggestion:${suggestion.id}`,
        label: `${titleCase(suggestion.kind)} suggestion`,
        state: 'needs_approval' as const,
        detail: clean(suggestion.blockId, 120) ? `Block ${clean(suggestion.blockId, 120)}` : undefined,
        href,
        ...(dateString(suggestion.createdAt) ? { updatedAt: dateString(suggestion.createdAt) } : {}),
        ...(actions.suggestions.get(suggestion.id)?.length ? { actions: actions.suggestions.get(suggestion.id) } : {}),
      })),
    ]
    const taskItems: ContextItemSummary[] = openTasks.slice(0, 8).map((task) => ({
      id: `task:${task.id}`,
      label: clean(task.title, 160) || 'Document task',
      state: task.dueDate && Date.parse(`${task.dueDate}T23:59:59Z`) < Date.now() ? 'blocked' : 'ready',
      detail: [clean(task.assignee, 100) ? `Assigned: ${clean(task.assignee, 100)}` : '', task.dueDate ? `Due ${task.dueDate}` : ''].filter(Boolean).join(' · '),
      href,
      ...(dateString(task.updatedAt ?? task.createdAt) ? { updatedAt: dateString(task.updatedAt ?? task.createdAt) } : {}),
      ...(actions.tasks.get(task.id)?.length ? { actions: actions.tasks.get(task.id) } : {}),
    }))

    const attention: ContextAttentionSummary[] = []
    if (blockingAssumptions.length > 0) {
      attention.push({
        id: 'publishing-blocked',
        label: `${blockingAssumptions.length} publishing blocker${blockingAssumptions.length === 1 ? '' : 's'}`,
        state: 'blocked',
        detail: blockingAssumptions.map((assumption) => clean(assumption.text, 100)).filter(Boolean).slice(0, 3).join(' · '),
        href,
      })
    }
    if (
      document.status === 'client_review'
      && document.approvalMode === 'formal_acceptance'
      && document.latestPublishedVersionId
      && input.user.role === 'client'
      && approvalPolicy.ok
    ) {
      attention.push({
        id: 'formal-acceptance',
        label: 'Formal acceptance required',
        state: 'needs_approval',
        detail: 'Open the document to review the terms and enter the required legal acknowledgement.',
        href,
      })
    } else if (
      document.status === 'client_review'
      && document.approvalMode === 'operational'
      && actions.document.some((action) => action.id.startsWith('approve-document:'))
    ) {
      attention.push({
        id: 'operational-approval',
        label: 'Operational approval required',
        state: 'needs_approval',
        detail: 'The currently published version is ready for approval.',
        href,
        actions: actions.document.filter((action) => action.id.startsWith('approve-document:')),
      })
    }
    if (openComments.length > 0 || openSuggestions.length > 0) {
      attention.push({
        id: 'review-feedback',
        label: 'Review feedback is open',
        state: 'review',
        detail: `${openComments.length} comment${openComments.length === 1 ? '' : 's'} · ${openSuggestions.length} suggestion${openSuggestions.length === 1 ? '' : 's'}`,
        href,
      })
    }

    const documentActions = actions.document.filter((action) => !action.id.startsWith('approve-document:'))
    const metrics: ChatContextReadModel['pulse']['metrics'] = [
      { id: 'status', label: 'Status', value: titleCase(document.status) },
      { id: 'version', label: 'Current version', value: currentVersion?.versionNumber ?? versions.length },
      { id: 'comments', label: 'Open comments', value: openComments.length },
      { id: 'suggestions', label: 'Open suggestions', value: openSuggestions.length },
      { id: 'tasks', label: 'Open tasks', value: openTasks.length },
    ]
    const hasInlineActions = [
      ...actions.document,
      ...Array.from(actions.comments.values()).flat(),
      ...Array.from(actions.suggestions.values()).flat(),
      ...Array.from(actions.tasks.values()).flat(),
    ].length > 0

    return {
      ok: true,
      model: {
        context: { ...base.model.context, href },
        pulse: {
          label: 'Client document',
          metrics,
          headline: `${titleCase(document.type)} · ${titleCase(document.approvalMode)} approval`,
          next: attention[0]
            ? {
                id: attention[0].id,
                label: attention[0].label,
                state: attention[0].state,
                detail: attention[0].detail,
                href: attention[0].href,
                actions: attention[0].actions,
              }
            : undefined,
        },
        groups: [
          {
            id: 'document',
            label: 'Document control',
            items: [{
              id: document.id,
              label: document.title,
              state: stateFor(document.status),
              detail: `Version ${currentVersion?.versionNumber ?? (versions.length || 1)} · ${titleCase(document.approvalMode)}`,
              href,
              ...(dateString(document.updatedAt) ? { updatedAt: dateString(document.updatedAt) } : {}),
              ...(documentActions.length > 0 ? { actions: documentActions } : {}),
            }],
          },
          ...(reviewItems.length > 0 ? [{ id: 'review', label: 'Open review', items: reviewItems }] : []),
          ...(taskItems.length > 0 ? [{ id: 'tasks', label: 'Document tasks', items: taskItems }] : []),
        ],
        artifacts: [],
        attention,
        activity: activityFrom(comments, approvals),
        preview: {
          kind: 'document',
          text: `${document.title} · ${titleCase(document.status)}`,
          status: document.status,
          version: document.currentVersionId,
        },
        ...(base.model.relationships?.length ? { relationships: base.model.relationships } : {}),
        capabilities: ['open', 'preview', 'review-state', 'version-history', ...(hasInlineActions ? ['inline-actions'] : [])],
        asOf: new Date().toISOString(),
      },
    }
  },
}
