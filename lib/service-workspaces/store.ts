import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { MemberRef } from '@/lib/orgMembers/memberRef'
import { recordCrmAuditEvent } from '@/lib/crm/audit'
import type {
  ServiceWorkspace,
  ServiceWorkspaceInput,
  ServiceWorkspaceListParams,
} from './types'

const COLLECTION = 'serviceWorkspaces'

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(cleanString).filter(Boolean)
}

function numericValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function limitValue(value: unknown, fallback = 100): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Math.min(Math.max(Number.isFinite(parsed) ? parsed : fallback, 1), 500)
}

function timeValue(value: unknown): number {
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  if (typeof value === 'object') {
    const timestamp = value as { toMillis?: () => number; seconds?: number; _seconds?: number }
    if (typeof timestamp.toMillis === 'function') return timestamp.toMillis()
    const seconds = timestamp.seconds ?? timestamp._seconds
    if (typeof seconds === 'number') return seconds * 1000
  }
  return 0
}

function sanitizeWorkspace(input: Record<string, unknown>): Partial<ServiceWorkspaceInput> {
  const out: Partial<ServiceWorkspaceInput> = {}
  const stringFields: Array<keyof ServiceWorkspaceInput> = [
    'companyId',
    'contactId',
    'relationshipId',
    'projectId',
    'dealId',
    'orderId',
    'name',
    'serviceType',
    'status',
    'visibility',
    'approvalState',
    'currency',
  ]
  for (const key of stringFields) {
    const value = cleanString(input[key])
    if (value) (out as Record<string, unknown>)[key] = value
  }
  const budget = numericValue(input.budget)
  if (budget !== undefined) out.budget = budget
  if (input.metrics && typeof input.metrics === 'object' && !Array.isArray(input.metrics)) {
    out.metrics = input.metrics as Record<string, number>
  }
  const linkedDocumentIds = cleanStringArray(input.linkedDocumentIds)
  if (linkedDocumentIds.length > 0) out.linkedDocumentIds = linkedDocumentIds
  const linkedProjectIds = cleanStringArray(input.linkedProjectIds)
  if (linkedProjectIds.length > 0) out.linkedProjectIds = linkedProjectIds
  const linkedReportIds = cleanStringArray(input.linkedReportIds)
  if (linkedReportIds.length > 0) out.linkedReportIds = linkedReportIds
  if (input.startsAt !== undefined) out.startsAt = input.startsAt
  if (input.endsAt !== undefined) out.endsAt = input.endsAt
  return out
}

function matchesWorkspace(row: ServiceWorkspace, params: ServiceWorkspaceListParams): boolean {
  if (row.deleted === true || row.status === 'archived') return false
  if (params.companyId && row.companyId !== params.companyId) return false
  if (params.relationshipId && row.relationshipId !== params.relationshipId) return false
  if (params.projectId && row.projectId !== params.projectId && !row.linkedProjectIds?.includes(params.projectId)) return false
  if (params.serviceType && row.serviceType !== params.serviceType) return false
  if (params.status && row.status !== params.status) return false
  return true
}

export async function listServiceWorkspaces(
  orgId: string,
  params: ServiceWorkspaceListParams = {},
): Promise<ServiceWorkspace[]> {
  const snap = await adminDb
    .collection(COLLECTION)
    .where('orgId', '==', orgId)
    .limit(1000)
    .get()

  return snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as ServiceWorkspace)
    .filter((row) => matchesWorkspace(row, params))
    .sort((a, b) => timeValue(b.updatedAt ?? b.createdAt) - timeValue(a.updatedAt ?? a.createdAt))
    .slice(0, limitValue(params.limit))
}

export async function createServiceWorkspace(
  orgId: string,
  input: Record<string, unknown>,
  actor: MemberRef,
): Promise<ServiceWorkspace> {
  const patch = sanitizeWorkspace(input)
  if (!patch.companyId) throw new Error('companyId is required')
  if (!patch.name) throw new Error('name is required')
  const ref = await adminDb.collection(COLLECTION).add({
    ...patch,
    orgId,
    serviceType: patch.serviceType ?? 'custom',
    status: patch.status ?? 'active',
    visibility: patch.visibility ?? 'relationship',
    approvalState: patch.approvalState ?? 'approved',
    linkedDocumentIds: patch.linkedDocumentIds ?? [],
    linkedProjectIds: patch.linkedProjectIds ?? [],
    linkedReportIds: patch.linkedReportIds ?? [],
    createdByRef: actor,
    updatedByRef: actor,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    deleted: false,
  })
  const snap = await ref.get()
  const workspace = { id: ref.id, ...snap.data() } as ServiceWorkspace
  await recordCrmAuditEvent({
    orgId,
    eventType: 'service_workspace.created',
    resourceType: 'serviceWorkspace',
    resourceId: ref.id,
    companyId: workspace.companyId,
    relationshipId: workspace.relationshipId,
    serviceWorkspaceId: ref.id,
    approvalState: workspace.approvalState,
    actorRef: actor,
    metadata: { serviceType: workspace.serviceType, status: workspace.status, visibility: workspace.visibility },
    notification: workspace.visibility !== 'internal'
      ? {
          type: 'crm.service_workspace.created',
          title: 'Service workspace created',
          body: `${workspace.name} is now tracked for this company.`,
        }
      : undefined,
  })
  return workspace
}

export async function updateServiceWorkspace(
  orgId: string,
  workspaceId: string,
  input: Record<string, unknown>,
  actor: MemberRef,
): Promise<ServiceWorkspace> {
  const ref = adminDb.collection(COLLECTION).doc(workspaceId)
  const snap = await ref.get()
  if (!snap.exists) throw new Error('Service workspace not found')
  const existing = snap.data() as ServiceWorkspace
  if (existing.orgId !== orgId) throw new Error('Service workspace not found')
  const patch = sanitizeWorkspace(input)
  await ref.update({
    ...patch,
    updatedByRef: actor,
    updatedAt: FieldValue.serverTimestamp(),
  })
  const next = await ref.get()
  const workspace = { id: workspaceId, ...next.data() } as ServiceWorkspace
  await recordCrmAuditEvent({
    orgId,
    eventType: 'service_workspace.updated',
    resourceType: 'serviceWorkspace',
    resourceId: workspaceId,
    companyId: workspace.companyId,
    relationshipId: workspace.relationshipId,
    serviceWorkspaceId: workspaceId,
    approvalState: workspace.approvalState,
    actorRef: actor,
    metadata: patch as Record<string, unknown>,
    notification: patch.status || patch.visibility || patch.approvalState
      ? {
          type: 'crm.service_workspace.updated',
          title: 'Service workspace updated',
          body: `${workspace.name} changed.`,
        }
      : undefined,
  })
  return workspace
}
