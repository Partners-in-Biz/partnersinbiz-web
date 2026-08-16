/**
 * Recording + optional Conversation Intelligence transcription.
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { upsertTwilioCall } from './calls'
import type { ResolvedTwilioOrg } from './org-client'
import { TWILIO_COLLECTIONS } from './types'

export async function applyRecordingCallback(input: {
  orgId: string
  callSid: string
  recordingSid?: string
  recordingUrl?: string
  recordingStatus?: string
  recordingDuration?: string | number
}): Promise<void> {
  const duration = input.recordingDuration != null ? Number(input.recordingDuration) : null
  await upsertTwilioCall({
    orgId: input.orgId,
    callSid: input.callSid,
    direction: 'outbound',
    status: 'completed',
    from: '',
    to: '',
    recordingSid: input.recordingSid ?? null,
    recordingUrl: input.recordingUrl
      ? (input.recordingUrl.endsWith('.mp3') ? input.recordingUrl : `${input.recordingUrl}.mp3`)
      : null,
    recordingStatus: input.recordingStatus ?? null,
    durationSeconds: Number.isFinite(duration) ? duration : undefined,
    ended: input.recordingStatus === 'completed',
  })
}

/**
 * Best-effort transcription via Twilio Conversation Intelligence when configured.
 * Falls back to legacy recordings.transcriptions when Intelligence is unavailable.
 */
export async function requestCallTranscription(
  resolved: ResolvedTwilioOrg,
  input: { callSid: string; recordingSid?: string | null },
): Promise<{ ok: boolean; mode?: string; error?: string }> {
  try {
    // Prefer Intelligence v2 when a recording SID is present.
    if (input.recordingSid) {
      try {
        const transcript = await resolved.client.intelligence.v2.transcripts.create({
          channel: {
            media_properties: {
              source_sid: input.recordingSid,
            },
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any)
        await upsertTwilioCall({
          orgId: resolved.orgId,
          callSid: input.callSid,
          direction: 'outbound',
          status: 'completed',
          from: '',
          to: '',
          transcriptStatus: 'queued',
          metadata: { transcriptSid: transcript.sid },
        })
        return { ok: true, mode: 'intelligence' }
      } catch {
        // Fall through to legacy transcription.
      }
    }

    if (input.recordingSid) {
      // Legacy Recording Transcriptions API — typed loosely across Twilio SDK versions.
      const transcriptions = resolved.client.recordings(input.recordingSid).transcriptions as {
        create: (params?: Record<string, unknown>) => Promise<{ sid?: string }>
      }
      await transcriptions.create({})
      await upsertTwilioCall({
        orgId: resolved.orgId,
        callSid: input.callSid,
        direction: 'outbound',
        status: 'completed',
        from: '',
        to: '',
        transcriptStatus: 'requested',
      })
      return { ok: true, mode: 'legacy' }
    }

    return { ok: false, error: 'recordingSid required for transcription' }
  } catch (error) {
    const err = error as { message?: string }
    return { ok: false, error: err.message ?? 'transcription request failed' }
  }
}

export async function applyTranscriptionText(input: {
  orgId: string
  callSid: string
  transcript: string
  summary?: string | null
}): Promise<void> {
  await upsertTwilioCall({
    orgId: input.orgId,
    callSid: input.callSid,
    direction: 'outbound',
    status: 'completed',
    from: '',
    to: '',
    transcript: input.transcript,
    transcriptStatus: 'completed',
    summary: input.summary ?? null,
  })

  // Also stamp latest transcript onto the call doc directly for index-free reads.
  const snap = await adminDb
    .collection(TWILIO_COLLECTIONS.calls)
    .where('orgId', '==', input.orgId)
    .where('callSid', '==', input.callSid)
    .limit(1)
    .get()
  if (!snap.empty) {
    await snap.docs[0].ref.set(
      {
        transcript: input.transcript,
        transcriptStatus: 'completed',
        summary: input.summary ?? null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
  }
}
