import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { MemberRef } from '@/lib/orgMembers/memberRef'

export interface CrmNotificationInput {
  type: string
  title: string
  body?: string
  targetOrgIds?: string[]
}

export interface CrmAuditEventInput {
  orgId: string
  eventType: string
  resourceType: string
  resourceId: string
  companyId?: string
  relationshipId?: string
  serviceWorkspaceId?: string
  orderId?: string
  shipmentId?: string
  approvalState?: string
  actorRef?: MemberRef
  metadata?: Record<string, unknown>
  notification?: CrmNotificationInput
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export async function recordCrmAuditEvent(input: CrmAuditEventInput): Promise<void> {
  try {
    const now = FieldValue.serverTimestamp()
    await adminDb.collection('crmAuditEvents').add(Object.fromEntries(Object.entries({
      orgId: input.orgId,
      eventType: input.eventType,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      companyId: cleanString(input.companyId) || undefined,
      relationshipId: cleanString(input.relationshipId) || undefined,
      serviceWorkspaceId: cleanString(input.serviceWorkspaceId) || undefined,
      orderId: cleanString(input.orderId) || undefined,
      shipmentId: cleanString(input.shipmentId) || undefined,
      approvalState: cleanString(input.approvalState) || undefined,
      actorRef: input.actorRef,
      metadata: input.metadata ?? {},
      createdAt: now,
    }).filter(([, value]) => value !== undefined)))

    if (input.notification) {
      await adminDb.collection('notifications').add(Object.fromEntries(Object.entries({
        orgId: input.orgId,
        type: input.notification.type,
        title: input.notification.title,
        body: input.notification.body ?? '',
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        companyId: cleanString(input.companyId) || undefined,
        relationshipId: cleanString(input.relationshipId) || undefined,
        serviceWorkspaceId: cleanString(input.serviceWorkspaceId) || undefined,
        orderId: cleanString(input.orderId) || undefined,
        shipmentId: cleanString(input.shipmentId) || undefined,
        targetOrgIds: input.notification.targetOrgIds ?? [],
        read: false,
        createdAt: now,
      }).filter(([, value]) => value !== undefined)))
    }
  } catch (err) {
    console.error('[crm-audit-event-error]', input.eventType, err)
  }
}
