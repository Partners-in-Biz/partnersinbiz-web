// lib/email/suppressions.ts
//
// Org-scoped suppression list. Drives:
//   • Pre-send filtering (broadcasts/audience, cron/sequences, v1/email/send,
//     cron/sequences SMS, broadcast SMS dispatch, v1/sms/send)
//   • Webhook handling — hard bounces / complaints add permanent rows;
//     soft bounces add a 24h temporary row that auto-clears on read; inbound
//     STOP texts add a permanent SMS row.
//
// Storage: Firestore `suppressions` collection.
//   • Email rows keyed `${orgId}_${lower(email)}` (legacy — preserved for
//     backwards-compat; readers treat a missing `channel` as 'email').
//   • SMS rows keyed `${orgId}_sms_${e164}`.
// Both lookups stay O(1) per (org, channel, address) without an index, and
// writes are idempotent.

import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'

export type SuppressionReason =
  | 'hard-bounce'
  | 'soft-bounce' // temporary — clears after 24h
  | 'soft-bounce-escalated' // permanent — N soft bounces in a rolling window (treated as a hard bounce)
  | 'complaint' // marked as spam
  | 'manual-unsub' // user clicked unsubscribe / replied STOP
  | 'list-cleanup' // admin-removed
  | 'invalid-address' // syntactically bad
  | 'disposable-domain' // burner inbox / invalid number

export type SuppressionScope = 'permanent' | 'temporary'

export type SuppressionSource = 'webhook' | 'api' | 'admin' | 'cron'

export type SuppressionChannel = 'email' | 'sms'

export interface SuppressionDetails {
  diagnosticCode?: string
  smtpStatus?: string
  emailId?: string
  smsId?: string
  broadcastId?: string
  campaignId?: string
  sequenceId?: string
  twilioErrorCode?: string
}

export interface Suppression {
  id: string
  orgId: string
  email: string
  /**
   * Channel this suppression applies to. Old docs written before the SMS
   * channel was added do NOT carry this field — readers default it to
   * 'email' for backwards-compatibility.
   */
  channel?: SuppressionChannel
  reason: SuppressionReason
  source: SuppressionSource
  scope: SuppressionScope
  expiresAt: Timestamp | null
  details: SuppressionDetails
  createdAt: Timestamp | null
  createdBy: string
}

export type SuppressionInput = Omit<Suppression, 'id' | 'createdAt'>

const COLLECTION = 'suppressions'

// Reasons ranked by priority. A higher-priority reason can upgrade a lower
// one (e.g. soft-bounce → hard-bounce). Equal or lower-priority writes are
// merged into the existing row (we update timestamps + details but keep the
// stronger scope/reason).
const REASON_PRIORITY: Record<SuppressionReason, number> = {
  'soft-bounce': 1,
  'list-cleanup': 2,
  'invalid-address': 3,
  'disposable-domain': 3,
  'manual-unsub': 4,
  // soft-bounce-escalated is a permanent hard-equivalent: it must sit at the
  // same strength as 'hard-bounce' so escalations stick.
  'hard-bounce': 5,
  'soft-bounce-escalated': 5,
  complaint: 6,
}

export function normalizeEmail(email: string): string {
  return (email ?? '').trim().toLowerCase()
}

/**
 * Normalises a suppression address for the channel. Email is lowercased;
 * SMS is just trimmed (it's expected to already be E.164 — callers should
 * normalise via lib/sms/twilio.normalizeToE164 before writing).
 */
export function normalizeAddress(address: string, channel: SuppressionChannel): string {
  if (!address) return ''
  if (channel === 'sms') return address.trim()
  return normalizeEmail(address)
}

/**
 * Doc id for an (org, channel, address) tuple.
 *   • email — `${orgId}_${lower(email)}` (legacy shape, preserved)
 *   • sms   — `${orgId}_sms_${e164}`
 */
export function suppressionDocId(
  orgId: string,
  address: string,
  channel: SuppressionChannel = 'email',
): string {
  const norm = normalizeAddress(address, channel)
  if (channel === 'sms') return `${orgId}_sms_${norm}`
  return `${orgId}_${norm}`
}

function nowMs(): number {
  return Date.now()
}

function isExpired(s: { scope: SuppressionScope; expiresAt: Timestamp | null }): boolean {
  if (s.scope === 'permanent') return false
  if (!s.expiresAt) return false
  return s.expiresAt.toMillis() <= nowMs()
}

/**
 * Add or upgrade a suppression.
 *
 * Returns `upgraded: true` when an existing row was upgraded (lower → higher
 * priority OR temporary → permanent). Returns `upgraded: false` for fresh
 * inserts, no-op writes, or refreshes of existing equal-priority rows.
 */
export async function addSuppression(
  input: SuppressionInput,
): Promise<{ id: string; upgraded: boolean }> {
  const channel: SuppressionChannel = input.channel ?? 'email'
  const address = normalizeAddress(input.email, channel)
  if (!input.orgId) throw new Error('addSuppression: orgId required')
  if (channel === 'email') {
    if (!address || !address.includes('@')) {
      throw new Error('addSuppression: valid email required')
    }
  } else {
    if (!address || !/^\+[1-9]\d{6,14}$/.test(address)) {
      throw new Error('addSuppression: valid E.164 phone required')
    }
  }

  const id = suppressionDocId(input.orgId, address, channel)
  const ref = adminDb.collection(COLLECTION).doc(id)

  const incomingPriority = REASON_PRIORITY[input.reason] ?? 0

  const result = await adminDb.runTransaction(async (tx) => {
    const existingSnap = await tx.get(ref)
    const existing = existingSnap.exists
      ? ((existingSnap.data() ?? {}) as Omit<Suppression, 'id'>)
      : null

    // Fresh insert.
    if (!existing) {
      tx.set(ref, {
        orgId: input.orgId,
        email: address,
        channel,
        reason: input.reason,
        source: input.source,
        scope: input.scope,
        expiresAt: input.expiresAt ?? null,
        details: input.details ?? {},
        createdAt: FieldValue.serverTimestamp(),
        createdBy: input.createdBy || 'system',
      })
      return { upgraded: false }
    }

    const existingPriority = REASON_PRIORITY[existing.reason] ?? 0

    // Higher priority wins — upgrade reason + scope. We treat permanent as
    // always-stronger than temporary, regardless of reason priority.
    const isUpgrade =
      incomingPriority > existingPriority ||
      (input.scope === 'permanent' && existing.scope !== 'permanent')

    if (isUpgrade) {
      tx.update(ref, {
        reason: input.reason,
        source: input.source,
        scope: input.scope,
        expiresAt: input.expiresAt ?? null,
        details: { ...(existing.details ?? {}), ...(input.details ?? {}) },
        channel: existing.channel ?? channel,
        // createdAt left as-is; this is the original suppression moment.
      })
      return { upgraded: true }
    }

    // Equal priority — refresh details + (for temporary) extend expiry.
    if (incomingPriority === existingPriority) {
      const nextExpiresAt =
        existing.scope === 'temporary' && input.scope === 'temporary' && input.expiresAt
          ? input.expiresAt
          : (existing.expiresAt ?? null)
      tx.update(ref, {
        details: { ...(existing.details ?? {}), ...(input.details ?? {}) },
        expiresAt: nextExpiresAt,
        channel: existing.channel ?? channel,
      })
      return { upgraded: false }
    }

    // Lower priority incoming — leave existing alone.
    return { upgraded: false }
  })

  return { id, upgraded: result.upgraded }
}

/**
 * True when the (org, address) is currently suppressed for the given channel.
 * Temporary rows whose `expiresAt` is in the past are treated as expired and
 * return false (the row is left in place for audit; the audience filter is the
 * hot path).
 *
 * `channel` defaults to 'email' for backwards-compat with existing callers.
 */
export async function isSuppressed(
  orgId: string,
  address: string,
  channel: SuppressionChannel = 'email',
): Promise<boolean> {
  const norm = normalizeAddress(address, channel)
  if (!orgId || !norm) return false
  const id = suppressionDocId(orgId, norm, channel)
  const snap = await adminDb.collection(COLLECTION).doc(id).get()
  if (!snap.exists) return false
  const data = snap.data() as Omit<Suppression, 'id'> | undefined
  if (!data) return false
  // Guard against the old-shape collision: an email row whose lowercased
  // address coincidentally matches an E.164 number is not an SMS suppression.
  const dataChannel: SuppressionChannel = data.channel ?? 'email'
  if (dataChannel !== channel) return false
  if (data.scope === 'permanent') return true
  if (isExpired(data)) return false
  return true
}

/**
 * Batch-check helper for send pipelines. Returns the normalised addresses that
 * are currently suppressed under this org+channel. Uses `in` queries with
 * chunks of 10 (Firestore's IN cap).
 *
 * `channel` defaults to 'email' for backwards-compat.
 */
export async function getSuppressedEmails(
  orgId: string,
  emails: string[],
  channel: SuppressionChannel = 'email',
): Promise<Set<string>> {
  const out = new Set<string>()
  if (!orgId || !emails || emails.length === 0) return out

  const norm = Array.from(
    new Set(
      emails
        .map((e) => normalizeAddress(e, channel))
        .filter((e) => {
          if (!e) return false
          if (channel === 'email') return e.includes('@')
          return /^\+[1-9]\d{6,14}$/.test(e)
        }),
    ),
  )
  if (norm.length === 0) return out

  const ids = norm.map((addr) => suppressionDocId(orgId, addr, channel))

  // Chunk through `__name__ in` queries (max 10 per query).
  const CHUNK = 10
  for (let i = 0; i < ids.length; i += CHUNK) {
    const batch = ids.slice(i, i + CHUNK)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const snap = await (adminDb.collection(COLLECTION) as any)
      .where('__name__', 'in', batch)
      .get()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const d of snap.docs as any[]) {
      const data = d.data() as Omit<Suppression, 'id'> | undefined
      if (!data) continue
      if (data.orgId !== orgId) continue // belt-and-braces
      const dataChannel: SuppressionChannel = data.channel ?? 'email'
      if (dataChannel !== channel) continue
      if (data.scope === 'permanent' || !isExpired(data)) {
        out.add(normalizeAddress(data.email, channel))
      }
    }
  }

  return out
}

/**
 * Look up the active suppression row for an (org, address). Returns null when
 * no row exists, or when the row exists but is an expired temporary.
 */
export async function getSuppression(
  orgId: string,
  address: string,
  channel: SuppressionChannel = 'email',
): Promise<Suppression | null> {
  const norm = normalizeAddress(address, channel)
  if (!orgId || !norm) return null
  const id = suppressionDocId(orgId, norm, channel)
  const snap = await adminDb.collection(COLLECTION).doc(id).get()
  if (!snap.exists) return null
  const data = snap.data() as Omit<Suppression, 'id'> | undefined
  if (!data) return null
  const dataChannel: SuppressionChannel = data.channel ?? 'email'
  if (dataChannel !== channel) return null
  if (data.scope === 'temporary' && isExpired(data)) return null
  return { id, ...data }
}

/**
 * Remove a suppression (admin override). Returns the number of rows
 * actually deleted (0 or 1).
 */
export async function removeSuppression(
  orgId: string,
  address: string,
  channel: SuppressionChannel = 'email',
): Promise<{ removed: number }> {
  const norm = normalizeAddress(address, channel)
  if (!orgId || !norm) return { removed: 0 }
  const id = suppressionDocId(orgId, norm, channel)
  const ref = adminDb.collection(COLLECTION).doc(id)
  const snap = await ref.get()
  if (!snap.exists) return { removed: 0 }
  await ref.delete()
  return { removed: 1 }
}

/**
 * Remove a suppression by doc id (used by DELETE /suppressions/[id]).
 */
export async function removeSuppressionById(
  id: string,
  orgId: string,
): Promise<{ removed: number }> {
  if (!id || !orgId) return { removed: 0 }
  const ref = adminDb.collection(COLLECTION).doc(id)
  const snap = await ref.get()
  if (!snap.exists) return { removed: 0 }
  const data = snap.data() as Omit<Suppression, 'id'> | undefined
  if (!data || data.orgId !== orgId) return { removed: 0 }
  await ref.delete()
  return { removed: 1 }
}

/**
 * Compute the expiresAt timestamp for a temporary suppression of duration
 * `hours` from now. Defaults to 24h.
 */
export function temporaryExpiryFromNow(hours = 24): Timestamp {
  return Timestamp.fromMillis(nowMs() + hours * 60 * 60 * 1000)
}
