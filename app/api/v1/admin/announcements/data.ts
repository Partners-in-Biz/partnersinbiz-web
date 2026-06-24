// app/api/v1/admin/announcements/data.ts
//
// Feature-announcement authoring store (US-303).
//
// Collection: announcements/{id}
//   { title, body, notes[], category, version, targetPlans[] (empty = all),
//     status: 'draft'|'scheduled'|'published'|'archived',
//     publishAt (ISO, for scheduled), publishedAt, changelogEntryId,
//     views, viewedBy[], createdAt, updatedAt, createdBy }
//
// When an announcement is published it mirrors a record into the existing
// `changelog` collection so it surfaces on the portal What's-new feed.

import { adminDb } from '@/lib/firebase/admin'

export const ANNOUNCEMENTS_COLLECTION = 'announcements'

export type AnnouncementStatus = 'draft' | 'scheduled' | 'published' | 'archived'

export interface AnnouncementRecord {
  id: string
  title: string
  body: string
  notes: string[]
  category: string
  version: string
  targetPlans: string[]
  status: AnnouncementStatus
  publishAt: string | null
  publishedAt: string | null
  changelogEntryId: string | null
  views: number
  createdAt: string | null
  updatedAt: string | null
}

function tsToIso(value: unknown): string | null {
  if (typeof value === 'string') {
    const t = Date.parse(value)
    return Number.isNaN(t) ? value : new Date(t).toISOString()
  }
  if (value && typeof value === 'object') {
    const v = value as { _seconds?: number; seconds?: number; toDate?: () => Date }
    if (typeof v.toDate === 'function') {
      try {
        return v.toDate().toISOString()
      } catch {
        return null
      }
    }
    if (typeof v._seconds === 'number') return new Date(v._seconds * 1000).toISOString()
    if (typeof v.seconds === 'number') return new Date(v.seconds * 1000).toISOString()
  }
  return null
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function strArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
}

function normaliseStatus(value: unknown): AnnouncementStatus {
  return value === 'scheduled' || value === 'published' || value === 'archived' ? value : 'draft'
}

export function docToAnnouncement(id: string, data: Record<string, unknown>): AnnouncementRecord {
  const viewedBy = strArray(data.viewedBy)
  const viewsField = typeof data.views === 'number' ? data.views : viewedBy.length
  return {
    id,
    title: str(data.title, 'Untitled announcement'),
    body: str(data.body),
    notes: strArray(data.notes),
    category: str(data.category, 'feature'),
    version: str(data.version),
    targetPlans: strArray(data.targetPlans),
    status: normaliseStatus(data.status),
    publishAt: tsToIso(data.publishAt),
    publishedAt: tsToIso(data.publishedAt),
    changelogEntryId: str(data.changelogEntryId) || null,
    views: viewsField,
    createdAt: tsToIso(data.createdAt),
    updatedAt: tsToIso(data.updatedAt),
  }
}

export async function listAnnouncements(limit = 200): Promise<AnnouncementRecord[]> {
  const snap = await adminDb.collection(ANNOUNCEMENTS_COLLECTION).limit(limit).get().catch(() => null)
  const rows = (snap?.docs ?? []).map((d) => docToAnnouncement(d.id, (d.data() ?? {}) as Record<string, unknown>))
  return rows.sort((a, b) => {
    const at = a.updatedAt ? Date.parse(a.updatedAt) : 0
    const bt = b.updatedAt ? Date.parse(b.updatedAt) : 0
    return bt - at
  })
}

export function announcementCounts(rows: AnnouncementRecord[]) {
  return {
    total: rows.length,
    draft: rows.filter((r) => r.status === 'draft').length,
    scheduled: rows.filter((r) => r.status === 'scheduled').length,
    published: rows.filter((r) => r.status === 'published').length,
    archived: rows.filter((r) => r.status === 'archived').length,
    totalViews: rows.reduce((sum, r) => sum + (r.views || 0), 0),
  }
}
