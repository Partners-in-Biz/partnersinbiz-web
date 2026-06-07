import { FieldValue } from 'firebase-admin/firestore'

import { isValidAgentId, type AgentId } from '@/lib/agents/types'
import { getClientDocumentTemplate } from '@/lib/client-documents/templates'
import { adminDb } from '@/lib/firebase/admin'
import type { ClientDocument, DocumentBlock } from '@/lib/client-documents/types'

export type ApprovedDocumentTaskPlanItem = {
  key?: string
  title?: string
  description?: string
  sectionId?: string
  blockId?: string
  assigneeAgentId?: AgentId
  dependsOn?: string[]
  priority?: 'urgent' | 'high' | 'medium' | 'normal' | 'low'
  labels?: string[]
  dueDate?: string | null
  estimateMinutes?: number | null
  reviewerAgentId?: AgentId | null
  riskLevel?: 'low' | 'medium' | 'high' | 'critical'
  requiredCapability?: string | null
  expectedArtifacts?: string[]
  sourceResearchItemId?: string | null
}

export type ApprovedDocumentTaskPlan = {
  tasks?: ApprovedDocumentTaskPlanItem[]
}

type BuildInput = {
  document: ClientDocument & { id: string }
  versionId: string
  approvalId: string
  blocks: DocumentBlock[]
  plan: ApprovedDocumentTaskPlan
  actorId: string
  taskRefs: string[]
  now?: number
}

type BuildError = { ok: false; error: string; status: number }
type BuiltTask = Record<string, unknown> & { id: string; dependsOn?: string[] }
type BuildSuccess = {
  ok: true
  projectId: string
  tasks: BuiltTask[]
  createdTaskIds: string[]
}

const DEFAULT_PRIORITY = 'medium'
const GENERATED_LABEL = 'generated-from-approved-spec'
const GEO_SEO_RUNTIME_SKILL_PATH = 'geo-seo-service'
const SIDE_EFFECT_GATES = [
  'production-deploy',
  'public-publish',
  'client-or-prospect-message',
  'paid-spend',
  'secret-or-config-change',
  'billing-or-finance-change',
  'destructive-delete-or-archive',
] as const
const SIDE_EFFECT_CONSTRAINTS = [
  'No production deploy, release promotion, or main merge without explicit approval',
  'No public publishing or public share/report promotion without explicit approval',
  'No client-visible or prospect-visible send/message without explicit approval',
  'No paid spend, ad launch, billing, finance, secret, config, or destructive action without explicit approval',
]

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map(cleanString).filter((item): item is string => !!item)))
}

function normalizePriority(value: unknown): 'urgent' | 'high' | 'medium' | 'low' {
  if (value === 'urgent' || value === 'high' || value === 'medium' || value === 'low') return value
  if (value === 'normal') return 'medium'
  return DEFAULT_PRIORITY
}

function normalizeRiskLevel(value: unknown, fallback: 'low' | 'medium' | 'high' | 'critical' = 'medium') {
  if (value === 'low' || value === 'medium' || value === 'high' || value === 'critical') return value
  return fallback
}

function defaultMetadataForTask(input: { document: ClientDocument; item: ApprovedDocumentTaskPlanItem }) {
  const assignee = cleanString(input.item.assigneeAgentId)
  const isEngineeringDoc = input.document.type === 'build_spec' || input.document.type === 'change_request'
  if (assignee === 'theo') {
    return {
      reviewerAgentId: 'qa-release' as AgentId,
      riskLevel: isEngineeringDoc ? 'high' as const : 'medium' as const,
      requiredCapability: 'engineering',
      expectedArtifacts: isEngineeringDoc ? ['commit', 'test-output', 'build-output', 'preview-url'] : ['commit', 'test-output', 'build-output'],
    }
  }
  if (assignee === 'qa-release') {
    return {
      reviewerAgentId: 'pip' as AgentId,
      riskLevel: isEngineeringDoc ? 'high' as const : 'medium' as const,
      requiredCapability: 'quality-assurance',
      expectedArtifacts: ['test-output', 'build-output', 'qa-notes'],
    }
  }
  if (assignee === 'sage') {
    return {
      reviewerAgentId: 'pip' as AgentId,
      riskLevel: 'medium' as const,
      requiredCapability: input.document.type === 'research_report' ? 'research-recommendation-followup' : 'research-intelligence',
      expectedArtifacts: input.document.type === 'research_report' ? ['recommendation-options', 'project-comment-or-task-links'] : ['research-records', 'evidence-links'],
    }
  }
  return {
    reviewerAgentId: null,
    riskLevel: 'medium' as const,
    requiredCapability: assignee === 'pip' ? 'coordination' : null,
    expectedArtifacts: ['project-comment-or-task-links'],
  }
}

function firstLinkedResearchItemId(document: ClientDocument): string | null {
  const ids = document.linked?.researchItemIds
  return Array.isArray(ids) ? cleanString(ids[0]) : null
}

function stringifySectionContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((item) => `- ${String(item)}`).join('\n')
  if (content && typeof content === 'object') return JSON.stringify(content, null, 2)
  return String(content ?? '')
}

function sectionTitle(block: DocumentBlock): string {
  return cleanString(block.title) ?? block.type
}

function defaultTitle(block: DocumentBlock): string {
  return `Execute spec section: ${sectionTitle(block)}`
}

function buildAgentSpec(input: {
  item: ApprovedDocumentTaskPlanItem
  block: DocumentBlock
  document: ClientDocument & { id: string }
  versionId: string
}) {
  const title = cleanString(input.item.title) ?? defaultTitle(input.block)
  const description = cleanString(input.item.description)
  const sectionContext = stringifySectionContent(input.block.content)
  return [
    title,
    '',
    `Source document: ${input.document.title} (${input.document.id})`,
    `Approved version: ${input.versionId}`,
    `Spec section: ${sectionTitle(input.block)} (${input.block.id})`,
    '',
    description ? `Task context:\n${description}\n` : null,
    `Inherited section context:\n${sectionContext}`,
  ]
    .filter(Boolean)
    .join('\n')
}

function linkedArtifactsForDocument(document: ClientDocument & { id: string }) {
  const linked = document.linked ?? {}
  return [
    linked.campaignId ? { type: 'campaign', ref: linked.campaignId, label: 'Linked campaign' } : null,
    linked.seoSprintId ? { type: 'seo-sprint', ref: linked.seoSprintId, label: 'Linked SEO sprint' } : null,
    linked.geoWorkspaceId ? { type: 'geo-workspace', ref: linked.geoWorkspaceId, label: 'Linked GEO workspace' } : null,
    linked.geoAuditId ? { type: 'geo-audit', ref: linked.geoAuditId, label: 'Linked GEO audit' } : null,
    ...(Array.isArray(linked.geoTaskIds)
      ? linked.geoTaskIds.map((ref) => ({ type: 'geo-task', ref, label: 'Linked GEO task' }))
      : []),
  ].filter(Boolean)
}

function taskPlanItems(plan: ApprovedDocumentTaskPlan, blocks: DocumentBlock[], document?: ClientDocument): ApprovedDocumentTaskPlanItem[] {
  if (Array.isArray(plan.tasks) && plan.tasks.length > 0) return plan.tasks
  if (document?.type) {
    const template = getClientDocumentTemplate(document.type)
    const templatePlan = template.agentWorkflowTasks
    if (Array.isArray(templatePlan) && templatePlan.length > 0) return templatePlan
    if (template.contract.taskFanout === 'none') return []
  }
  return blocks
    .filter((block) => ['scope', 'deliverables', 'timeline', 'rich_text'].includes(block.type))
    .map((block) => ({ key: block.id, sectionId: block.id, title: defaultTitle(block), assigneeAgentId: 'pip' as AgentId }))
}

export function buildApprovedDocumentTaskFanout(input: BuildInput): BuildSuccess | BuildError {
  const projectId = cleanString(input.document.linked?.projectId)
  if (!projectId) {
    return { ok: false, error: 'Document must be linked to a project before tasks can be generated', status: 400 }
  }

  const items = taskPlanItems(input.plan, input.blocks, input.document)
  if (items.length === 0) return { ok: false, error: 'No task plan items were provided', status: 400 }
  if (input.taskRefs.length < items.length) return { ok: false, error: 'Not enough task references supplied for task plan', status: 500 }

  const blocksById = new Map(input.blocks.map((block) => [block.id, block]))
  const keyToTaskId = new Map<string, string>()
  items.forEach((item, index) => {
    const key = cleanString(item.key) ?? cleanString(item.sectionId) ?? cleanString(item.blockId) ?? `task-${index + 1}`
    keyToTaskId.set(key, input.taskRefs[index])
  })

  const createdAt = input.now ?? Date.now()
  const tasks: BuiltTask[] = []

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    const sectionId = cleanString(item.sectionId) ?? cleanString(item.blockId) ?? cleanString(item.key)
    const block =
      (sectionId ? blocksById.get(sectionId) : undefined) ??
      input.blocks[index] ??
      ({
        id: sectionId ?? `generated-task-${index + 1}`,
        type: 'rich_text',
        title: cleanString(item.title) ?? `Generated workflow task ${index + 1}`,
        content: cleanString(item.description) ?? '',
        required: true,
        display: {},
      } satisfies DocumentBlock)

    const assigneeAgentId = cleanString(item.assigneeAgentId)
    if (assigneeAgentId && !isValidAgentId(assigneeAgentId)) {
      return { ok: false, error: `Invalid assigneeAgentId for task ${index + 1}`, status: 400 }
    }

    const taskId = input.taskRefs[index]
    const title = cleanString(item.title) ?? defaultTitle(block)
    const labels = Array.from(new Set([
      GENERATED_LABEL,
      `document:${input.document.id}`,
      `document-section:${block.id}`,
      ...cleanStringArray(item.labels),
    ]))
    const dependsOn = cleanStringArray(item.dependsOn).map((dep) => {
      if (dep === 'approvalGateTaskId' || dep === 'approval-gate' || dep === '$approvalGateTaskId') return input.approvalId
      return keyToTaskId.get(dep) ?? dep
    })
    const agentSpec = buildAgentSpec({ item, block, document: input.document, versionId: input.versionId })
    const defaults = defaultMetadataForTask({ document: input.document, item })
    const reviewerAgentId = cleanString(item.reviewerAgentId) ?? defaults.reviewerAgentId
    if (reviewerAgentId && !isValidAgentId(reviewerAgentId)) {
      return { ok: false, error: `Invalid reviewerAgentId for task ${index + 1}`, status: 400 }
    }
    const requiredCapability = cleanString(item.requiredCapability) ?? defaults.requiredCapability
    const expectedArtifacts = cleanStringArray(item.expectedArtifacts).length > 0 ? cleanStringArray(item.expectedArtifacts) : defaults.expectedArtifacts
    const sourceResearchItemId = cleanString(item.sourceResearchItemId) ?? firstLinkedResearchItemId(input.document)

    const task: BuiltTask = {
      id: taskId,
      orgId: input.document.orgId ?? null,
      projectId,
      columnId: 'todo',
      title,
      description: cleanString(item.description) ?? `Generated from approved spec section: ${sectionTitle(block)}`,
      priority: normalizePriority(item.priority),
      labels,
      assigneeId: null,
      assigneeIds: [],
      mentionIds: [],
      attachments: [],
      checklist: [],
      dueDate: item.dueDate ?? null,
      startDate: null,
      estimateMinutes: typeof item.estimateMinutes === 'number' && Number.isFinite(item.estimateMinutes) ? Math.round(item.estimateMinutes) : null,
      order: createdAt + index,
      sourceDocumentId: input.document.id,
      sourceDocumentVersionId: input.versionId,
      sourceDocumentApprovalId: input.approvalId,
      sourceDocumentSectionId: block.id,
      sourceSpecVersion: input.versionId,
      sourceResearchItemId,
      approvalGateTaskId: input.approvalId,
      reviewerAgentId,
      riskLevel: normalizeRiskLevel(item.riskLevel, defaults.riskLevel),
      requiredCapability,
      expectedArtifacts,
      linkedDocuments: [
        {
          type: 'client-document',
          ref: input.document.id,
          label: input.document.title,
          versionId: input.versionId,
          approvalId: input.approvalId,
        },
      ],
      linkedArtifacts: linkedArtifactsForDocument(input.document),
      reporterId: input.actorId,
      createdBy: input.actorId,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      agentInput: {
        spec: agentSpec,
        context: {
          orgId: input.document.orgId ?? null,
          projectId,
          linkedRecords: input.document.linked ?? {},
          documentId: input.document.id,
          documentTitle: input.document.title,
          documentVersionId: input.versionId,
          sourceSpecVersion: input.versionId,
          approvalId: input.approvalId,
          approvalGateTaskId: input.approvalId,
          reviewerAgentId,
          riskLevel: normalizeRiskLevel(item.riskLevel, defaults.riskLevel),
          requiredCapability,
          expectedArtifacts,
          sourceResearchItemId,
          section: {
            id: block.id,
            type: block.type,
            title: sectionTitle(block),
            content: block.content,
          },
        },
        constraints: ['Use the inherited spec section as the source of truth', 'Respect dependsOn before starting blocked work'],
      },
    }

    if (assigneeAgentId) {
      task.assigneeAgentId = assigneeAgentId
      task.agentStatus = 'pending'
    }
    if (dependsOn.length > 0) task.dependsOn = dependsOn

    tasks.push(task)
  }

  return { ok: true, projectId, tasks, createdTaskIds: tasks.map((task) => task.id) }
}

export async function generateApprovedDocumentProjectTasks(input: {
  document: ClientDocument & { id: string }
  approvalId: string
  actorId: string
  plan: ApprovedDocumentTaskPlan
}): Promise<BuildSuccess | BuildError> {
  const versionId = input.document.latestPublishedVersionId
  if (!versionId) return { ok: false, error: 'Publish a version before generating tasks', status: 400 }

  const documentRef = adminDb.collection('client_documents').doc(input.document.id)
  const versionSnap = await documentRef.collection('versions').doc(versionId).get()
  if (!versionSnap.exists) return { ok: false, error: 'Published version not found', status: 404 }

  const version = versionSnap.data() as { blocks?: DocumentBlock[] } | undefined
  const blocks = Array.isArray(version?.blocks) ? version.blocks : []
  const items = taskPlanItems(input.plan, blocks, input.document)
  const projectId = cleanString(input.document.linked?.projectId)
  if (!projectId) {
    return { ok: false, error: 'Document must be linked to a project before tasks can be generated', status: 400 }
  }

  const projectTaskCollection = adminDb.collection('projects').doc(projectId).collection('tasks')
  const taskRefs = items.map(() => projectTaskCollection.doc())
  const built = buildApprovedDocumentTaskFanout({
    document: input.document,
    versionId,
    approvalId: input.approvalId,
    blocks,
    plan: { tasks: items },
    actorId: input.actorId,
    taskRefs: taskRefs.map((ref) => ref.id),
  })
  if (!built.ok) return built

  const batch = adminDb.batch()
  built.tasks.forEach((task, index) => {
    const { id, ...taskData } = task
    void id
    batch.set(taskRefs[index], taskData)
  })
  batch.update(documentRef, {
    'linked.generatedProjectTaskIds': FieldValue.arrayUnion(...built.createdTaskIds),
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: input.actorId,
    updatedByType: 'agent',
  })
  await batch.commit()

  return built
}
