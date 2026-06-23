// lib/reports/share.ts
//
// Share + open-tracking for reports (US-189). Replaces the single `viewedAt`
// boolean with per-open events keyed by a hashed visitor fingerprint so we can
// distinguish total opens from unique opens. Also owns share-settings updates
// (public toggle, expiry, subject/message) and token invalidation.

import crypto from 'crypto'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import {
  REPORTS_COLLECTION,
  REPORT_OPENS_COLLECTION,
  type Report,
  type ReportShareSettings,
} from './types'

function hash(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 32)
}

/** Is a report's public link currently live? Honours enabled flag, token, and expiry. */
export function isShareLive(report: Pick<Report, 'publicToken' | 'share'>, now = new Date()): boolean {
  if (!report.publicToken) return false
  const share = report.share
  if (share) {
    if (share.enabled === false) return false
    if (share.expiresAt && share.expiresAt < now.toISOString().slice(0, 10)) return false
  }
  return true
}

interface OpenContext {
  ip: string | null
  userAgent: string | null
  referer: string | null
}

/**
 * Record a public-link open. Deduped per visitor fingerprint: a repeat open by
 * the same visitor bumps openCount but not uniqueOpenCount. Returns whether the
 * open was unique (first time this visitor opened the report).
 */
export async function recordReportOpen(reportId: string, ctx: OpenContext): Promise<{ unique: boolean }> {
  const ipHash = hash(ctx.ip ?? 'unknown')
  const visitorHash = hash(`${ctx.ip ?? 'unknown'}|${ctx.userAgent ?? 'unknown'}`)

  const reportRef = adminDb.collection(REPORTS_COLLECTION).doc(reportId)
  // Deterministic doc id per (report, visitor) so repeat opens upsert the same row.
  const openRef = reportRef.collection(REPORT_OPENS_COLLECTION).doc(visitorHash)

  const existing = await openRef.get()
  const unique = !existing.exists

  await openRef.set(
    {
      id: visitorHash,
      reportId,
      visitorHash,
      ipHash,
      userAgent: (ctx.userAgent ?? '').slice(0, 400),
      referer: ctx.referer ?? null,
      at: FieldValue.serverTimestamp(),
      opens: FieldValue.increment(1),
    },
    { merge: true },
  )

  await reportRef.update({
    openCount: FieldValue.increment(1),
    ...(unique ? { uniqueOpenCount: FieldValue.increment(1) } : {}),
    lastOpenedAt: FieldValue.serverTimestamp(),
    // Maintain legacy field for old viewers/email previews.
    viewedAt: FieldValue.serverTimestamp(),
  })

  return { unique }
}

/** Per-open event rows for a report (newest first). */
export async function listReportOpens(reportId: string, limit = 100) {
  const snap = await adminDb
    .collection(REPORTS_COLLECTION)
    .doc(reportId)
    .collection(REPORT_OPENS_COLLECTION)
    .get()
  return snap.docs
    .map((d) => d.data() as Record<string, unknown>)
    .sort((a, b) => {
      const at = (a.at as { _seconds?: number })?._seconds ?? 0
      const bt = (b.at as { _seconds?: number })?._seconds ?? 0
      return bt - at
    })
    .slice(0, limit)
}

/** Update share settings (public toggle, expiry, subject, message). */
export async function updateShareSettings(
  reportId: string,
  patch: Partial<ReportShareSettings>,
): Promise<void> {
  const clean: Record<string, unknown> = {}
  if (typeof patch.enabled === 'boolean') clean['share.enabled'] = patch.enabled
  if (patch.expiresAt !== undefined) clean['share.expiresAt'] = patch.expiresAt || null
  if (typeof patch.subject === 'string') clean['share.subject'] = patch.subject.slice(0, 200)
  if (typeof patch.message === 'string') clean['share.message'] = patch.message.slice(0, 2000)
  clean.updatedAt = FieldValue.serverTimestamp()
  await adminDb.collection(REPORTS_COLLECTION).doc(reportId).update(clean)
}

/**
 * Invalidate the public link ("Disable link"). Clears the token so the old URL
 * 404s permanently. Returns the new token if `regenerate` is set, else null.
 */
export async function invalidateToken(
  reportId: string,
  regenerate = false,
): Promise<{ publicToken: string | null }> {
  const publicToken = regenerate ? crypto.randomBytes(24).toString('base64url') : null
  await adminDb.collection(REPORTS_COLLECTION).doc(reportId).update({
    publicToken,
    'share.enabled': regenerate,
    updatedAt: FieldValue.serverTimestamp(),
  })
  return { publicToken }
}
