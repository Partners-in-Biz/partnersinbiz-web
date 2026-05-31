// lib/automations/store.ts
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import type { MemberRef } from '@/lib/orgMembers/memberRef'
import type {
  AutomationRule,
  AutomationRuleInput,
  PendingAutomation,
  TriggerEvent,
  TriggerContext,
} from './types'

const RULES = 'automation_rules'
const PENDING = 'pending_automations'

export async function listRules(orgId: string): Promise<AutomationRule[]> {
  const snap = await adminDb
    .collection(RULES)
    .where('orgId', '==', orgId)
    .get()
  return snap.docs
    .map((d) => ({ ...(d.data() as Omit<AutomationRule, 'id'>), id: d.id }))
    .filter((rule) => rule.deleted !== true)
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
}

export async function getRule(orgId: string, ruleId: string): Promise<AutomationRule | null> {
  const snap = await adminDb.collection(RULES).doc(ruleId).get()
  if (!snap.exists) return null
  const data = snap.data() as AutomationRule
  if (data.orgId !== orgId) return null
  return { ...data, id: snap.id }
}

export async function createRule(
  orgId: string,
  input: AutomationRuleInput,
  actor: MemberRef,
): Promise<AutomationRule> {
  const ref = await adminDb.collection(RULES).add({
    ...input,
    orgId,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    createdByRef: actor,
    updatedByRef: actor,
  })
  const snap = await ref.get()
  return { ...snap.data(), id: ref.id } as AutomationRule
}

export async function updateRule(
  orgId: string,
  ruleId: string,
  patch: Partial<AutomationRuleInput>,
  actor: MemberRef,
): Promise<AutomationRule> {
  const ref = adminDb.collection(RULES).doc(ruleId)
  const snap = await ref.get()
  if (!snap.exists) throw new Error(`AutomationRule not found: ${ruleId}`)
  const existing = snap.data() as AutomationRule
  if (existing.orgId !== orgId) throw new Error(`AutomationRule not found: ${ruleId}`)
  await ref.update({
    ...patch,
    updatedAt: FieldValue.serverTimestamp(),
    updatedByRef: actor,
  })
  const updated = await ref.get()
  return { ...updated.data(), id: ref.id } as AutomationRule
}

export async function deleteRule(
  orgId: string,
  ruleId: string,
  actor: MemberRef,
): Promise<void> {
  const ref = adminDb.collection(RULES).doc(ruleId)
  const snap = await ref.get()
  if (!snap.exists) throw new Error(`AutomationRule not found: ${ruleId}`)
  const existing = snap.data() as AutomationRule
  if (existing.orgId !== orgId) throw new Error(`AutomationRule not found: ${ruleId}`)
  await ref.update({
    deleted: true,
    updatedAt: FieldValue.serverTimestamp(),
    updatedByRef: actor,
  })
}

export async function getMatchingRules(
  orgId: string,
  event: TriggerEvent,
  context: TriggerContext,
): Promise<AutomationRule[]> {
  const snap = await adminDb
    .collection(RULES)
    .where('orgId', '==', orgId)
    .get()

  const rules: AutomationRule[] = snap.docs.map((d) => ({
    ...(d.data() as Omit<AutomationRule, 'id'>),
    id: d.id,
  }))

  // In-memory filters for optional trigger fields
  return rules.filter((rule) => {
    if (rule.deleted === true) return false
    if (rule.enabled !== true) return false
    if (rule.trigger.event !== event) return false
    if (rule.trigger.toStageId && rule.trigger.toStageId !== context.toStageId) return false
    if (rule.trigger.pipelineId && rule.trigger.pipelineId !== context.pipelineId) return false
    return true
  })
}

export async function queuePendingAutomation(
  orgId: string,
  rule: AutomationRule,
  context: TriggerContext,
): Promise<void> {
  const delayMs = (rule.delayMinutes ?? 0) * 60_000
  const scheduledAt = Timestamp.fromMillis(Date.now() + delayMs)

  await adminDb.collection(PENDING).add({
    orgId,
    ruleId: rule.id,
    triggerEvent: rule.trigger.event,
    actions: rule.actions,
    contextDealId: context.dealId ?? null,
    contextContactId: context.contactId ?? null,
    contextContactEmail: context.contactEmail ?? null,
    contextOwnerEmail: context.ownerEmail ?? null,
    scheduledAt,
    status: 'pending',
    executedAt: null,
    createdAt: FieldValue.serverTimestamp(),
  })
}

export async function getPendingDue(limit = 100): Promise<PendingAutomation[]> {
  const snap = await adminDb
    .collection(PENDING)
    .where('status', '==', 'pending')
    .where('scheduledAt', '<=', Timestamp.now())
    .orderBy('scheduledAt', 'asc')
    .limit(limit)
    .get()
  return snap.docs.map((d) => ({ ...(d.data() as Omit<PendingAutomation, 'id'>), id: d.id }))
}

export async function markExecuted(id: string): Promise<void> {
  await adminDb.collection(PENDING).doc(id).update({
    status: 'executed',
    executedAt: FieldValue.serverTimestamp(),
  })
}

export async function markFailed(id: string, error: string): Promise<void> {
  await adminDb.collection(PENDING).doc(id).update({
    status: 'failed',
    error,
    executedAt: FieldValue.serverTimestamp(),
  })
}
