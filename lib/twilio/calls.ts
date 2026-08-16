/**
 * Persist Twilio call lifecycle into Firestore + CRM activities.
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { TWILIO_COLLECTIONS, type CallDirection, type CallStatus, type TwilioCallRecord } from './types'

export interface UpsertCallInput {
  orgId: string
  callSid?: string | null
  parentCallSid?: string | null
  direction: CallDirection
  status: CallStatus | string
  from: string
  to: string
  contactId?: string | null
  dealId?: string | null
  userId?: string | null
  durationSeconds?: number | null
  recordingSid?: string | null
  recordingUrl?: string | null
  recordingStatus?: string | null
  transcript?: string | null
  transcriptStatus?: string | null
  summary?: string | null
  errorCode?: string | null
  errorMessage?: string | null
  metadata?: Record<string, unknown>
  ended?: boolean
}

async function findCallBySid(orgId: string, callSid: string): Promise<{ id: string; data: TwilioCallRecord } | null> {
  const snap = await adminDb
    .collection(TWILIO_COLLECTIONS.calls)
    .where('orgId', '==', orgId)
    .where('callSid', '==', callSid)
    .limit(1)
    .get()
  if (snap.empty) return null
  const doc = snap.docs[0]
  return { id: doc.id, data: { id: doc.id, ...(doc.data() as Omit<TwilioCallRecord, 'id'>) } }
}

export async function upsertTwilioCall(input: UpsertCallInput): Promise<{ id: string; created: boolean }> {
  const now = FieldValue.serverTimestamp()
  const existing = input.callSid ? await findCallBySid(input.orgId, input.callSid) : null
  const ref = existing
    ? adminDb.collection(TWILIO_COLLECTIONS.calls).doc(existing.id)
    : adminDb.collection(TWILIO_COLLECTIONS.calls).doc()

  const patch: Record<string, unknown> = {
    orgId: input.orgId,
    status: input.status,
    updatedAt: now,
    deleted: false,
  }
  if (input.direction) patch.direction = input.direction
  if (input.from) patch.from = input.from
  if (input.to) patch.to = input.to
  if (!existing) {
    patch.direction = input.direction
    patch.from = input.from
    patch.to = input.to
    patch.createdAt = now
  }
  if (input.callSid) patch.callSid = input.callSid
  if (input.parentCallSid !== undefined) patch.parentCallSid = input.parentCallSid
  if (input.contactId !== undefined) patch.contactId = input.contactId
  if (input.dealId !== undefined) patch.dealId = input.dealId
  if (input.userId !== undefined) patch.userId = input.userId
  if (input.durationSeconds !== undefined) patch.durationSeconds = input.durationSeconds
  if (input.recordingSid !== undefined) patch.recordingSid = input.recordingSid
  if (input.recordingUrl !== undefined) patch.recordingUrl = input.recordingUrl
  if (input.recordingStatus !== undefined) patch.recordingStatus = input.recordingStatus
  if (input.transcript !== undefined) patch.transcript = input.transcript
  if (input.transcriptStatus !== undefined) patch.transcriptStatus = input.transcriptStatus
  if (input.summary !== undefined) patch.summary = input.summary
  if (input.errorCode !== undefined) patch.errorCode = input.errorCode
  if (input.errorMessage !== undefined) patch.errorMessage = input.errorMessage
  if (input.metadata) patch.metadata = { ...(existing?.data.metadata ?? {}), ...input.metadata }
  if (input.ended) patch.endedAt = now

  if (existing) await ref.set(patch, { merge: true })
  else await ref.set(patch)

  // Best-effort CRM activity when we have a contact and a terminal/meaningful status.
  const contactId = input.contactId ?? existing?.data.contactId
  if (contactId && shouldLogActivity(input.status, Boolean(existing))) {
    await logCallActivity({
      orgId: input.orgId,
      callId: ref.id,
      contactId,
      dealId: input.dealId ?? existing?.data.dealId ?? null,
      userId: input.userId ?? existing?.data.userId ?? null,
      direction: input.direction,
      status: input.status,
      from: input.from || existing?.data.from || '',
      to: input.to || existing?.data.to || '',
      durationSeconds: input.durationSeconds ?? existing?.data.durationSeconds ?? null,
      recordingUrl: input.recordingUrl ?? existing?.data.recordingUrl ?? null,
      transcript: input.transcript ?? existing?.data.transcript ?? null,
      summary: input.summary ?? existing?.data.summary ?? null,
      callSid: input.callSid ?? existing?.data.callSid ?? null,
    })
  }

  return { id: ref.id, created: !existing }
}

function shouldLogActivity(status: string, hadExisting: boolean): boolean {
  const terminal = ['completed', 'busy', 'failed', 'no-answer', 'canceled']
  if (terminal.includes(status)) return true
  if (!hadExisting && (status === 'ringing' || status === 'in-progress' || status === 'queued')) return true
  return false
}

async function logCallActivity(input: {
  orgId: string
  callId: string
  contactId: string
  dealId: string | null
  userId: string | null
  direction: CallDirection
  status: string
  from: string
  to: string
  durationSeconds: number | null
  recordingUrl: string | null
  transcript: string | null
  summary: string | null
  callSid: string | null
}): Promise<void> {
  try {
    const existing = await adminDb
      .collection('activities')
      .where('orgId', '==', input.orgId)
      .where('metadata.callId', '==', input.callId)
      .limit(1)
      .get()
      .catch(() => null)

    const subject =
      input.direction === 'outbound'
        ? `Outbound call to ${input.to}`
        : `Inbound call from ${input.from}`
    const bodyParts = [
      `Status: ${input.status}`,
      input.durationSeconds != null ? `Duration: ${input.durationSeconds}s` : null,
      input.summary ? `Summary: ${input.summary}` : null,
      input.transcript ? `Transcript: ${input.transcript.slice(0, 2000)}` : null,
      input.recordingUrl ? `Recording: ${input.recordingUrl}` : null,
    ].filter(Boolean)

    const payload = {
      orgId: input.orgId,
      type: 'call',
      contactId: input.contactId,
      dealId: input.dealId,
      subject,
      body: bodyParts.join('\n'),
      metadata: {
        callId: input.callId,
        callSid: input.callSid,
        direction: input.direction,
        status: input.status,
        from: input.from,
        to: input.to,
        durationSeconds: input.durationSeconds,
        recordingUrl: input.recordingUrl,
        hasTranscript: Boolean(input.transcript),
        summary: input.summary,
      },
      createdBy: input.userId || 'system',
      createdByType: input.userId ? 'user' : 'system',
      updatedAt: FieldValue.serverTimestamp(),
    }

    if (existing && !existing.empty) {
      await existing.docs[0].ref.set(payload, { merge: true })
      await adminDb.collection(TWILIO_COLLECTIONS.calls).doc(input.callId).set(
        { activityId: existing.docs[0].id },
        { merge: true },
      )
      return
    }

    const ref = adminDb.collection('activities').doc()
    await ref.set({
      ...payload,
      createdAt: FieldValue.serverTimestamp(),
      deleted: false,
    })
    await adminDb.collection(TWILIO_COLLECTIONS.calls).doc(input.callId).set(
      { activityId: ref.id },
      { merge: true },
    )
  } catch (err) {
    console.error('[twilio/calls] activity log failed', err)
  }
}

export async function listTwilioCalls(
  orgId: string,
  opts: { contactId?: string | null; limit?: number } = {},
): Promise<TwilioCallRecord[]> {
  let query = adminDb.collection(TWILIO_COLLECTIONS.calls).where('orgId', '==', orgId)
  if (opts.contactId) query = query.where('contactId', '==', opts.contactId)
  const snap = await query.limit(Math.min(Math.max(opts.limit ?? 50, 1), 200)).get()
  return snap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as Omit<TwilioCallRecord, 'id'>) }))
    .filter((call) => call.deleted !== true)
    .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
}

export async function getTwilioCall(orgId: string, callId: string): Promise<TwilioCallRecord | null> {
  const doc = await adminDb.collection(TWILIO_COLLECTIONS.calls).doc(callId).get()
  if (!doc.exists) return null
  const data = doc.data() as Omit<TwilioCallRecord, 'id'>
  if (data.orgId !== orgId || data.deleted === true) return null
  return { id: doc.id, ...data }
}
