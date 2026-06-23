/**
 * Admin audit log helper.
 *
 * Every privileged platform-admin action (suspend, billing change, plan change,
 * feature-flag toggle, impersonation, dev-mode toggle, analytics export, etc.)
 * writes an immutable record to the `admin_audit_log` collection so there is a
 * permanent, queryable trail of who did what to which org and when.
 *
 * Records are never mutated or deleted by application code.
 */
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import type { ApiUser } from '@/lib/api/types'

export interface AdminAuditEntry {
  /** Machine action key, e.g. "org.suspend", "billing.grant_free_months". */
  action: string
  /** Target org id (when the action targets an organisation). */
  orgId?: string | null
  /** Target user uid (when the action targets a user). */
  targetUid?: string | null
  /** Human-readable one-line summary of what happened. */
  summary: string
  /** Arbitrary structured detail (reason, amounts, before/after, etc). */
  metadata?: Record<string, unknown>
}

export interface AdminAuditRecord extends AdminAuditEntry {
  id: string
  actorUid: string
  actorRole: string
  createdAt: string | null
}

function actorLabel(user: ApiUser): { actorUid: string; actorRole: string } {
  return {
    actorUid: user.uid,
    actorRole: user.role ?? 'unknown',
  }
}

/**
 * Write an audit entry. Never throws — auditing must not break the main flow,
 * but failures are logged loudly so they can be investigated.
 */
export async function writeAdminAudit(user: ApiUser, entry: AdminAuditEntry): Promise<void> {
  try {
    const { actorUid, actorRole } = actorLabel(user)
    await adminDb.collection('admin_audit_log').add({
      action: entry.action,
      orgId: entry.orgId ?? null,
      targetUid: entry.targetUid ?? null,
      summary: entry.summary,
      metadata: entry.metadata ?? {},
      actorUid,
      actorRole,
      createdAt: FieldValue.serverTimestamp(),
    })
  } catch (err) {
    console.error('[admin-audit] write failed', entry.action, err)
  }
}

function tsToIso(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const seconds = (value as { _seconds?: number; seconds?: number })._seconds
    ?? (value as { seconds?: number }).seconds
  if (typeof seconds === 'number') return new Date(seconds * 1000).toISOString()
  const toDate = (value as { toDate?: () => Date }).toDate
  if (typeof toDate === 'function') {
    try { return toDate.call(value).toISOString() } catch { return null }
  }
  return null
}

/**
 * Read recent audit entries, optionally scoped to a single org. Sorts most
 * recent first in memory to avoid requiring a composite index.
 */
export async function readAdminAudit(opts: { orgId?: string; limit?: number } = {}): Promise<AdminAuditRecord[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500)
  let snap
  if (opts.orgId) {
    snap = await adminDb
      .collection('admin_audit_log')
      .where('orgId', '==', opts.orgId)
      .get()
  } else {
    snap = await adminDb.collection('admin_audit_log').get()
  }

  return snap.docs
    .map((doc) => {
      const d = doc.data()
      return {
        id: doc.id,
        action: typeof d.action === 'string' ? d.action : 'unknown',
        orgId: typeof d.orgId === 'string' ? d.orgId : null,
        targetUid: typeof d.targetUid === 'string' ? d.targetUid : null,
        summary: typeof d.summary === 'string' ? d.summary : '',
        metadata: (d.metadata && typeof d.metadata === 'object') ? d.metadata as Record<string, unknown> : {},
        actorUid: typeof d.actorUid === 'string' ? d.actorUid : '',
        actorRole: typeof d.actorRole === 'string' ? d.actorRole : '',
        createdAt: tsToIso(d.createdAt),
      } satisfies AdminAuditRecord
    })
    .sort((a, b) => {
      const at = a.createdAt ? Date.parse(a.createdAt) : 0
      const bt = b.createdAt ? Date.parse(b.createdAt) : 0
      return bt - at
    })
    .slice(0, limit)
}
