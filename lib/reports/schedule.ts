// lib/reports/schedule.ts
//
// Report scheduling (US-177). A schedule re-generates a report on a cadence
// (weekly / monthly / quarterly) and emails it to a recipient list using a
// chosen template. The existing /api/cron/reports route honours active
// schedules whose nextSendAt has arrived.

import crypto from 'crypto'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import {
  REPORT_SCHEDULES_COLLECTION,
  type ReportSchedule,
  type ScheduleCadence,
} from './types'

/** Format a Date as a UTC YYYY-MM-DD string. */
function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Today as YYYY-MM-DD (UTC). */
export function todayISO(now = new Date()): string {
  return toISODate(now)
}

/**
 * Compute the next send date (YYYY-MM-DD) for a cadence, strictly after `from`.
 * weekly = +7 days, monthly = +1 calendar month, quarterly = +3 calendar months.
 */
export function computeNextSend(cadence: ScheduleCadence, from: Date = new Date()): string {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()))
  switch (cadence) {
    case 'weekly':
      d.setUTCDate(d.getUTCDate() + 7)
      break
    case 'monthly':
      d.setUTCMonth(d.getUTCMonth() + 1)
      break
    case 'quarterly':
      d.setUTCMonth(d.getUTCMonth() + 3)
      break
  }
  return toISODate(d)
}

interface CreateScheduleInput {
  orgId: string
  name: string
  cadence: ScheduleCadence
  category: ReportSchedule['category']
  type: ReportSchedule['type']
  recipients: string[]
  template: string
  propertyId?: string | null
  sourceReportId?: string | null
  spec?: ReportSchedule['spec']
  createdBy: string
  /** Optional explicit first-send date; defaults to one cadence-interval out. */
  firstSendAt?: string
}

export async function createSchedule(input: CreateScheduleInput): Promise<ReportSchedule> {
  const id = `sch_${crypto.randomBytes(8).toString('hex')}`
  const nextSendAt = input.firstSendAt ?? computeNextSend(input.cadence)
  const schedule: ReportSchedule = {
    id,
    orgId: input.orgId,
    sourceReportId: input.sourceReportId ?? null,
    name: input.name,
    cadence: input.cadence,
    category: input.category,
    type: input.type,
    propertyId: input.propertyId ?? null,
    spec: input.spec ?? null,
    recipients: input.recipients.map((r) => r.trim().toLowerCase()).filter(Boolean),
    template: input.template,
    status: 'active',
    nextSendAt,
    lastSentAt: null,
    unsubscribed: [],
    createdAt: FieldValue.serverTimestamp(),
    createdBy: input.createdBy,
    updatedAt: FieldValue.serverTimestamp(),
  }
  await adminDb.collection(REPORT_SCHEDULES_COLLECTION).doc(id).set(schedule)
  return schedule
}

export async function getSchedule(id: string): Promise<ReportSchedule | null> {
  const doc = await adminDb.collection(REPORT_SCHEDULES_COLLECTION).doc(id).get()
  if (!doc.exists) return null
  return { ...(doc.data() as ReportSchedule), id: doc.id }
}

export async function listSchedules(orgId: string): Promise<ReportSchedule[]> {
  const snap = await adminDb
    .collection(REPORT_SCHEDULES_COLLECTION)
    .where('orgId', '==', orgId)
    .get()
  return snap.docs
    .map((d) => ({ ...(d.data() as ReportSchedule), id: d.id }))
    .sort((a, b) => (a.nextSendAt < b.nextSendAt ? -1 : 1))
}

type SchedulePatch = Partial<
  Pick<
    ReportSchedule,
    | 'name'
    | 'cadence'
    | 'category'
    | 'type'
    | 'recipients'
    | 'template'
    | 'status'
    | 'nextSendAt'
    | 'lastSentAt'
    | 'propertyId'
    | 'spec'
    | 'unsubscribed'
  >
>

export async function updateSchedule(id: string, patch: SchedulePatch): Promise<void> {
  const clean: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) clean[k] = v
  }
  // Recompute next-send when cadence changes and caller did not supply one.
  if (patch.cadence && patch.nextSendAt === undefined) {
    clean.nextSendAt = computeNextSend(patch.cadence)
  }
  if (patch.recipients) {
    clean.recipients = patch.recipients.map((r) => r.trim().toLowerCase()).filter(Boolean)
  }
  clean.updatedAt = FieldValue.serverTimestamp()
  await adminDb.collection(REPORT_SCHEDULES_COLLECTION).doc(id).update(clean)
}

export async function deleteSchedule(id: string): Promise<void> {
  await adminDb.collection(REPORT_SCHEDULES_COLLECTION).doc(id).delete()
}

/**
 * Stateless unsubscribe token so a recipient can opt out from an email link
 * without auth. HMAC of (scheduleId|email) keyed by CRON_SECRET.
 */
export function unsubscribeToken(scheduleId: string, email: string): string {
  const secret = process.env.CRON_SECRET ?? 'dev-secret'
  return crypto
    .createHmac('sha256', secret)
    .update(`${scheduleId}|${email.trim().toLowerCase()}`)
    .digest('base64url')
    .slice(0, 32)
}

export function verifyUnsubscribeToken(scheduleId: string, email: string, token: string): boolean {
  const expected = unsubscribeToken(scheduleId, email)
  if (expected.length !== token.length) return false
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token))
}

/** Add an email to a schedule's unsubscribe list (US-177 unsubscribe-from-schedule). */
export async function unsubscribeFromSchedule(id: string, email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase()
  if (!normalized) return false
  const ref = adminDb.collection(REPORT_SCHEDULES_COLLECTION).doc(id)
  const doc = await ref.get()
  if (!doc.exists) return false
  await ref.update({
    unsubscribed: FieldValue.arrayUnion(normalized),
    recipients: FieldValue.arrayRemove(normalized),
    updatedAt: FieldValue.serverTimestamp(),
  })
  return true
}

/**
 * Active schedules whose nextSendAt <= today. Used by the cron.
 * Filtered/sorted in memory to avoid a composite index requirement.
 */
export async function dueSchedules(now = new Date()): Promise<ReportSchedule[]> {
  const today = toISODate(now)
  const snap = await adminDb
    .collection(REPORT_SCHEDULES_COLLECTION)
    .where('status', '==', 'active')
    .get()
  return snap.docs
    .map((d) => ({ ...(d.data() as ReportSchedule), id: d.id }))
    .filter((s) => s.nextSendAt <= today && (s.recipients?.length ?? 0) > 0)
}

/** Roll a schedule forward after a successful run. */
export async function markScheduleSent(id: string, cadence: ScheduleCadence, now = new Date()): Promise<void> {
  await adminDb.collection(REPORT_SCHEDULES_COLLECTION).doc(id).update({
    lastSentAt: now.toISOString(),
    nextSendAt: computeNextSend(cadence, now),
    updatedAt: FieldValue.serverTimestamp(),
  })
}
