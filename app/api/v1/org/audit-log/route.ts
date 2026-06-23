// app/api/v1/org/audit-log/route.ts
//
// GET (admin) — lists audit/activity entries for the org.
// Reuses the canonical 'activity' collection (lib/activity/log.ts) which is the
// org-scoped audit store written across CRM, billing, domain, exports, etc.
// Fields: orgId, type, actorId, actorName, actorRole, description, entityType,
// entityId, entityTitle, createdAt.
//
// Filters: ?action= (matches `type`), ?actor= (substring of actorName/actorId),
// ?from=YYYY-MM-DD, ?to=YYYY-MM-DD, ?limit=, ?format=csv (streams a download).

import { NextRequest, NextResponse } from 'next/server'
import { Timestamp } from 'firebase-admin/firestore'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { adminDb } from '@/lib/firebase/admin'
import { apiSuccess, apiErrorFromException } from '@/lib/api/response'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

type AuditEntry = {
  id: string
  when: string | null
  whenMs: number | null
  actorId: string
  actorName: string
  actorRole: string
  action: string
  target: string
  details: string
  entityType: string
  entityId: string
}

function toMillis(value: unknown): number | null {
  if (value instanceof Timestamp) return value.toMillis()
  if (value && typeof value === 'object' && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    try { return (value as Timestamp).toMillis() } catch { return null }
  }
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const ms = Date.parse(value)
    return Number.isNaN(ms) ? null : ms
  }
  return null
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export const GET = withPortalAuthAndRole('admin', async (req: NextRequest, _uid: string, orgId: string) => {
  try {
    const url = new URL(req.url)
    const action = url.searchParams.get('action')?.trim() ?? ''
    const actor = url.searchParams.get('actor')?.trim().toLowerCase() ?? ''
    const fromRaw = url.searchParams.get('from')?.trim() ?? ''
    const toRaw = url.searchParams.get('to')?.trim() ?? ''
    const format = (url.searchParams.get('format') ?? 'json').toLowerCase()
    const limitParam = parseInt(url.searchParams.get('limit') ?? '', 10)
    // CSV exports can be larger; cap generously but bounded.
    const limit = Math.min(Math.max(1, Number.isFinite(limitParam) ? limitParam : (format === 'csv' ? 1000 : 100)), 5000)

    const fromMs = DATE_RE.test(fromRaw) ? Date.parse(`${fromRaw}T00:00:00.000Z`) : null
    const toMs = DATE_RE.test(toRaw) ? Date.parse(`${toRaw}T23:59:59.999Z`) : null

    let query = adminDb
      .collection('activity')
      .where('orgId', '==', orgId)
      .orderBy('createdAt', 'desc')
      .limit(limit)

    // `type` is the action field; an equality filter pairs cleanly with the
    // existing orgId+createdAt composite index.
    if (action) query = query.where('type', '==', action) as typeof query

    const snapshot = await query.get()

    let entries: AuditEntry[] = snapshot.docs.map((doc) => {
      const d = doc.data()
      const whenMs = toMillis(d.createdAt)
      return {
        id: doc.id,
        when: whenMs !== null ? new Date(whenMs).toISOString() : null,
        whenMs,
        actorId: str(d.actorId),
        actorName: str(d.actorName) || str(d.actorId),
        actorRole: str(d.actorRole),
        action: str(d.type),
        target: str(d.entityTitle) || `${str(d.entityType)}${d.entityId ? `:${str(d.entityId)}` : ''}`,
        details: str(d.description),
        entityType: str(d.entityType),
        entityId: str(d.entityId),
      }
    })

    // Date + actor filters applied in-memory (actor is a substring match;
    // Firestore can't do that, and date ranges avoid a second range filter).
    if (fromMs !== null) entries = entries.filter((e) => e.whenMs === null || e.whenMs >= fromMs)
    if (toMs !== null) entries = entries.filter((e) => e.whenMs === null || e.whenMs <= toMs)
    if (actor) {
      entries = entries.filter(
        (e) => e.actorName.toLowerCase().includes(actor) || e.actorId.toLowerCase().includes(actor),
      )
    }

    if (format === 'csv') {
      const cols = ['When', 'Who', 'Action', 'Target', 'Details']
      const lines = [cols.join(',')]
      for (const e of entries) {
        lines.push([
          csvEscape(e.when ?? ''),
          csvEscape(e.actorName),
          csvEscape(e.action),
          csvEscape(e.target),
          csvEscape(e.details),
        ].join(','))
      }
      const filename = `audit-log-${orgId}-${new Date().toISOString().slice(0, 10)}.csv`
      return new NextResponse(lines.join('\n'), {
        status: 200,
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="${filename}"`,
          'cache-control': 'private, no-store',
        },
      })
    }

    // Distinct actions present (for building the filter dropdown client-side).
    const actions = Array.from(new Set(entries.map((e) => e.action).filter(Boolean))).sort()

    return apiSuccess({ entries, count: entries.length, actions })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
