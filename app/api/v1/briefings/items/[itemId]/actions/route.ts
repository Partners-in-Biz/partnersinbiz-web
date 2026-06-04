import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { getProjectForUser } from '@/lib/projects/access'
import { buildProjectTaskCreateData } from '@/lib/projects/taskPayload'
import { isValidAgentId } from '@/lib/agents/types'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ itemId: string }> }
const SAFE_ACTIONS = ['create-task', 'assign-agent', 'create-crm-activity'] as const
const GATED_EXTERNAL_ACTIONS = new Set([
  'send',
  'send-email',
  'send-now',
  'publish',
  'spend',
  'deploy',
  'billing',
  'delete',
  'archive',
  'destructive',
  'launch-campaign',
  'enroll',
  'enroll-sequence',
  'sequence',
  'import',
  'import-list',
])
const NO_SIDE_EFFECT_COPY = 'No send, publish, spend, deploy, billing, secret/config, or destructive action was performed.'

type EvidenceRow = {
  id?: string
  kind: 'commit' | 'verification' | 'link' | 'document' | 'blocker'
  label: string
  value: string
  href?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map(cleanString).filter((item): item is string => Boolean(item))))
}

function cleanEvidenceRows(value: unknown): EvidenceRow[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((row): EvidenceRow[] => {
    if (!isRecord(row)) return []
    const kind = cleanString(row.kind)
    const label = cleanString(row.label)
    const rowValue = cleanString(row.value)
    if (!kind || !['commit', 'verification', 'link', 'document', 'blocker'].includes(kind) || !label || !rowValue) return []
    const id = cleanString(row.id)
    const href = cleanString(row.href)
    return [{ ...(id ? { id } : {}), kind: kind as EvidenceRow['kind'], label, value: rowValue, ...(href ? { href } : {}) }]
  })
}

function evidenceAttachments(rows: EvidenceRow[]) {
  return rows
    .filter((row) => Boolean(row.href))
    .map((row) => ({
      name: row.label,
      url: row.href as string,
      type: 'text/uri-list',
      mimeType: 'text/uri-list',
    }))
}

function sourceContext(body: Record<string, unknown>, itemId: string) {
  const context = isRecord(body.context) ? body.context : {}
  const source = isRecord(body.source) ? body.source : {}
  const metadata = isRecord(body.metadata) ? body.metadata : {}
  const orgId = cleanString(body.orgId) ?? cleanString(context.orgId)
  const projectId = cleanString(body.projectId) ?? cleanString(context.sourceProjectId) ?? cleanString(context.projectId)
  const taskId = cleanString(body.taskId) ?? cleanString(context.sourceTaskId) ?? cleanString(context.taskId)
  const documentId = cleanString(body.documentId) ?? cleanString(context.sourceDocumentId) ?? cleanString(context.documentId)
  const evidenceRows = cleanEvidenceRows(body.evidenceRows).length > 0
    ? cleanEvidenceRows(body.evidenceRows)
    : cleanEvidenceRows(metadata.softwareBuildEvidence)
  const explicitEvidenceRowIds = cleanStringArray(context.evidenceRowIds).length > 0
    ? cleanStringArray(context.evidenceRowIds)
    : cleanStringArray(body.evidenceRowIds).length > 0
      ? cleanStringArray(body.evidenceRowIds)
      : cleanStringArray(metadata.evidenceRowIds)
  const evidenceRowIds = explicitEvidenceRowIds.length > 0
    ? explicitEvidenceRowIds
    : evidenceRows.flatMap((row) => row.id ? [row.id] : [])

  return {
    orgId,
    projectId,
    taskId,
    documentId,
    sourceBriefingId: itemId,
    sourceBriefingSourceType: cleanString(source.type),
    sourceBriefingSourceId: cleanString(source.id),
    sourceBriefingSourceUrl: cleanString(source.url),
    sourceProjectId: cleanString(context.sourceProjectId) ?? projectId,
    sourceTaskId: cleanString(context.sourceTaskId) ?? taskId,
    sourceDocumentId: cleanString(context.sourceDocumentId) ?? documentId,
    sourceDocumentSectionId: cleanString(context.sourceDocumentSectionId),
    sourceEvidenceId: cleanString(context.sourceEvidenceId) ?? cleanString(body.sourceEvidenceId) ?? cleanString(metadata.sourceEvidenceId),
    evidenceRowIds,
    sourceSpecVersion: cleanString(context.sourceSpecVersion),
    sourceResearchItemId: cleanString(context.sourceResearchItemId),
    approvalGateTaskId: cleanString(context.approvalGateTaskId) ?? cleanString(metadata.approvalTaskId),
    requiredCapability: cleanString(context.requiredCapability),
    riskLevel: cleanString(context.riskLevel),
    reviewerAgentId: cleanString(context.reviewerAgentId),
    expectedArtifacts: cleanStringArray(context.expectedArtifacts),
    evidenceRows,
  }
}

function compactContext(input: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => {
    if (value === null || value === undefined || value === '') return false
    if (Array.isArray(value) && value.length === 0) return false
    return true
  }))
}

export const POST = withAuth('client', async (req: NextRequest, user, ctx) => {
  const { itemId: rawItemId } = await (ctx as RouteContext).params
  const itemId = decodeURIComponent(rawItemId || '').trim()
  if (!itemId) return apiError('itemId is required', 400)

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const action = cleanString(body.action)
  if (!SAFE_ACTIONS.includes(action as typeof SAFE_ACTIONS[number])) {
    const gatedCopy = action && GATED_EXTERNAL_ACTIONS.has(action)
      ? `Approval is still required before ${action}. ${NO_SIDE_EFFECT_COPY}`
      : `Unsupported briefing action '${action ?? ''}'. Supported internal actions are create-task, assign-agent, and create-crm-activity. ${NO_SIDE_EFFECT_COPY}`
    return apiError(gatedCopy, 400)
  }

  const source = sourceContext(body, itemId)
  const orgId = source.orgId
  const projectId = source.projectId
  if (orgId && !canAccessOrg(user, orgId)) {
    return apiError(`You do not have access to orgId ${orgId}; briefing card action was not created.`, 403)
  }

  if (action === 'create-crm-activity') {
    if (body.crmActivityInternalOnly !== true) {
      return apiError('CRM activity creation is disabled unless crmActivityInternalOnly is true', 400)
    }
    const contactId = cleanString(body.contactId) ?? cleanString(isRecord(body.context) ? body.context.contactId : null)
    const summary = cleanString(body.summary)
    if (!orgId) return apiError('orgId is required for CRM activity', 400)
    if (!canAccessOrg(user, orgId)) return apiError(`You do not have access to workspace ${orgId}`, 403)
    if (!contactId) return apiError('contactId is required for CRM activity', 400)
    if (!summary) return apiError('summary is required for CRM activity', 400)
    await adminDb.collection('activities').add({
      orgId,
      contactId,
      dealId: cleanString(body.dealId) ?? cleanString(isRecord(body.context) ? body.context.dealId : null) ?? '',
      type: 'note',
      summary,
      metadata: compactContext({
        source: 'briefings-control-desk',
        sourceBriefingId: source.sourceBriefingId,
        sourceBriefingSourceType: source.sourceBriefingSourceType,
        sourceBriefingSourceId: source.sourceBriefingSourceId,
        internalOnly: true,
        evidenceRows: source.evidenceRows,
      }),
      internalOnly: true,
      createdBy: user.uid,
      createdAt: FieldValue.serverTimestamp(),
      occurredAt: FieldValue.serverTimestamp(),
    })
    return apiSuccess({ itemId, action, crmActivityCreated: true }, 201)
  }

  if (!projectId) return apiError('source projectId is required to create a linked Projects/Kanban task', 400)
  const access = await getProjectForUser(projectId, user)
  if (!access.ok) return apiError(access.error, access.status)

  const agentId = cleanString(body.assigneeAgentId)
  if (action === 'assign-agent' && (!agentId || !isValidAgentId(agentId))) {
    return apiError('assigneeAgentId must be a valid agent id for assign-agent', 400)
  }

  const title = cleanString(body.title) ?? `Follow up briefing: ${cleanString(body.sourceTitle) ?? itemId}`
  const spec = cleanString(body.spec) ?? cleanString(body.description) ?? cleanString(body.summary) ?? title
  const projectOrgId = cleanString(access.doc.data()?.orgId) ?? orgId ?? undefined
  const agentInputContext = compactContext({
    orgId: projectOrgId,
    sourceProjectId: source.sourceProjectId,
    sourceTaskId: source.sourceTaskId,
    sourceDocumentId: source.sourceDocumentId,
    sourceDocumentSectionId: source.sourceDocumentSectionId,
    sourceEvidenceId: source.sourceEvidenceId,
    evidenceRowIds: source.evidenceRowIds,
    sourceSpecVersion: source.sourceSpecVersion,
    sourceResearchItemId: source.sourceResearchItemId,
    approvalGateTaskId: source.approvalGateTaskId,
    sourceBriefingId: source.sourceBriefingId,
    sourceBriefingSourceType: source.sourceBriefingSourceType,
    sourceBriefingSourceId: source.sourceBriefingSourceId,
    sourceBriefingSourceUrl: source.sourceBriefingSourceUrl,
    riskLevel: source.riskLevel,
    requiredCapability: source.requiredCapability,
    expectedArtifacts: source.expectedArtifacts,
    evidenceRows: source.evidenceRows,
    approvalGateCopy: source.approvalGateTaskId
      ? `Approval gate ${source.approvalGateTaskId} remains required before any external send, public publish, paid spend, production deploy, billing, secret/config, or destructive action.`
      : 'External send, public publishing, paid spend, production deploy, billing, secret/config, and destructive actions remain separately approval-gated.',
  })
  const payload = buildProjectTaskCreateData({
    orgId: projectOrgId,
    title,
    description: cleanString(body.description) ?? spec,
    priority: cleanString(body.priority) ?? 'medium',
    labels: cleanStringArray(body.labels).length > 0 ? cleanStringArray(body.labels) : ['briefing-action', 'internal-only'],
    internalOnly: true,
    assigneeAgentId: agentId,
    agentStatus: agentId ? 'pending' : undefined,
    reviewerAgentId: cleanString(body.reviewerAgentId) ?? source.reviewerAgentId,
    dependsOn: source.approvalGateTaskId ? [source.approvalGateTaskId] : [],
    attachments: evidenceAttachments(source.evidenceRows),
    agentInput: {
      spec,
      context: agentInputContext,
      constraints: [
        'internal-only durable record',
        'no external send, public publishing, paid spend, production deploy, billing, secret/config, or destructive action without separate approval',
      ],
    },
  }, projectId, projectOrgId)
  if (!payload.ok) return apiError(payload.error, payload.status ?? 400)

  const ref = await adminDb.collection('projects').doc(projectId).collection('tasks').add({
    ...payload.value,
    reporterId: user.uid,
    createdBy: user.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })

  return apiSuccess({ itemId, action, taskId: ref.id, projectId }, 201)
})
