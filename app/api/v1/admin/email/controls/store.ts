// app/api/v1/admin/email/controls/store.ts
//
// Platform-wide outbound email controls. Single global doc
// `admin_email_controls/global`. The pause flag is intended to be consulted by
// outbound send paths as a global kill-switch (see the enforcement note in the
// controls route handler).

import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'

export const CONTROLS_COLLECTION = 'admin_email_controls'
export const CONTROLS_DOC_ID = 'global'

export interface EmailControls {
  pauseOutbound: boolean
  pauseReason: string | null
  pausedBy: string | null
  pausedAt: string | null
  updatedAt: string | null
  updatedBy: string | null
}

const DEFAULT_CONTROLS: EmailControls = {
  pauseOutbound: false,
  pauseReason: null,
  pausedBy: null,
  pausedAt: null,
  updatedAt: null,
  updatedBy: null,
}

function tsToIso(v: unknown): string | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = (v as any)?.toDate?.()
  if (d instanceof Date) return d.toISOString()
  if (typeof v === 'string') return v
  return null
}

export async function readEmailControls(): Promise<EmailControls> {
  const snap = await adminDb.collection(CONTROLS_COLLECTION).doc(CONTROLS_DOC_ID).get()
  if (!snap.exists) return { ...DEFAULT_CONTROLS }
  const data = snap.data() ?? {}
  return {
    pauseOutbound: !!data.pauseOutbound,
    pauseReason: (data.pauseReason ?? null) as string | null,
    pausedBy: (data.pausedBy ?? null) as string | null,
    pausedAt: tsToIso(data.pausedAt),
    updatedAt: tsToIso(data.updatedAt),
    updatedBy: (data.updatedBy ?? null) as string | null,
  }
}

export async function writeEmailControls(input: {
  pauseOutbound: boolean
  pauseReason?: string | null
  actorUid: string
}): Promise<EmailControls> {
  const ref = adminDb.collection(CONTROLS_COLLECTION).doc(CONTROLS_DOC_ID)
  const existing = await ref.get()
  const wasPaused = !!existing.data()?.pauseOutbound

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patch: Record<string, any> = {
    pauseOutbound: input.pauseOutbound,
    pauseReason: input.pauseReason ?? null,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: input.actorUid,
  }
  // Stamp pausedAt/pausedBy only on the transition into a paused state.
  if (input.pauseOutbound && !wasPaused) {
    patch.pausedAt = FieldValue.serverTimestamp()
    patch.pausedBy = input.actorUid
  }
  if (!input.pauseOutbound) {
    patch.pausedAt = null
    patch.pausedBy = null
  }

  await ref.set(patch, { merge: true })
  return readEmailControls()
}
