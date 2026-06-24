// app/api/v1/admin/announcements/route.ts
//
// Feature announcement authoring (US-303).
//
//   GET    -> { announcements, counts, plans } for the authoring UI.
//   POST   -> create an announcement (draft / scheduled / published).
//   PATCH  -> update an announcement, or transition status. Publishing mirrors
//             a record into the `changelog` collection (portal What's-new).
//   DELETE -> remove an announcement (?id=...) and its mirrored changelog entry.

import { FieldValue } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError, apiErrorFromException } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { writeAdminAudit } from '@/lib/admin/audit'
import {
  ANNOUNCEMENTS_COLLECTION,
  docToAnnouncement,
  listAnnouncements,
  announcementCounts,
  type AnnouncementStatus,
} from './data'

export const dynamic = 'force-dynamic'

function sStr(value: unknown, max = 4000): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function sNotes(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter((v) => v.length > 0)
    .slice(0, 30)
}

function sPlans(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out = new Set<string>()
  for (const v of value) {
    if (typeof v === 'string' && v.trim()) out.add(v.trim())
  }
  return Array.from(out)
}

function validStatus(value: unknown): AnnouncementStatus | null {
  if (value === 'draft' || value === 'scheduled' || value === 'published' || value === 'archived') return value
  return null
}

async function listPlanOptions(): Promise<Array<{ key: string; name: string }>> {
  const snap = await adminDb.collection('plans').get().catch(() => null)
  return (snap?.docs ?? [])
    .map((d) => {
      const data = d.data() ?? {}
      return { key: String(data.key ?? d.id), name: String(data.name ?? data.key ?? d.id) }
    })
    .filter((p) => p.key)
}

// Mirror a published announcement into the portal changelog feed.
async function mirrorToChangelog(
  announcement: { title: string; body: string; notes: string[]; version: string; changelogEntryId: string | null },
): Promise<string> {
  const today = new Date().toISOString().slice(0, 10)
  const notes = announcement.notes.length > 0 ? announcement.notes : announcement.body ? [announcement.body] : []
  const payload = {
    version: announcement.version || today,
    date: today,
    title: announcement.title,
    notes,
    source: 'announcement',
    createdAt: FieldValue.serverTimestamp(),
  }

  if (announcement.changelogEntryId) {
    const ref = adminDb.collection('changelog').doc(announcement.changelogEntryId)
    await ref.set(payload, { merge: true })
    return announcement.changelogEntryId
  }
  const ref = await adminDb.collection('changelog').add(payload)
  return ref.id
}

export const GET = withAuth('admin', async () => {
  try {
    const [announcements, plans] = await Promise.all([listAnnouncements(), listPlanOptions()])
    return apiSuccess({ announcements, counts: announcementCounts(announcements), plans })
  } catch (err) {
    return apiErrorFromException(err)
  }
})

export const POST = withAuth('admin', async (req, user) => {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return apiError('Invalid JSON body', 400)
  }

  const title = sStr(body.title, 200)
  if (!title) return apiError('title is required', 400)

  const requestedStatus = validStatus(body.status) ?? 'draft'
  const publishAt = sStr(body.publishAt, 40) || null
  if (requestedStatus === 'scheduled' && !publishAt) {
    return apiError('publishAt is required when status is scheduled', 400)
  }

  const notes = sNotes(body.notes)
  const announcementBody = sStr(body.body, 6000)
  const version = sStr(body.version, 60)

  const record = {
    title,
    body: announcementBody,
    notes,
    category: sStr(body.category, 60) || 'feature',
    version,
    targetPlans: sPlans(body.targetPlans),
    status: requestedStatus,
    publishAt,
    publishedAt: null as null | ReturnType<typeof FieldValue.serverTimestamp>,
    changelogEntryId: null as string | null,
    views: 0,
    viewedBy: [] as string[],
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    createdBy: user.uid,
  }

  try {
    const ref = await adminDb.collection(ANNOUNCEMENTS_COLLECTION).add(record)

    if (requestedStatus === 'published') {
      const changelogEntryId = await mirrorToChangelog({
        title,
        body: announcementBody,
        notes,
        version,
        changelogEntryId: null,
      })
      await ref.set(
        { publishedAt: FieldValue.serverTimestamp(), changelogEntryId },
        { merge: true },
      )
    }

    await writeAdminAudit(user, {
      action: 'announcement.create',
      summary: `Created announcement "${title}" (${requestedStatus})`,
      metadata: { announcementId: ref.id, status: requestedStatus, targetPlans: record.targetPlans },
    })

    const snap = await ref.get()
    return apiSuccess({ announcement: docToAnnouncement(ref.id, (snap.data() ?? {}) as Record<string, unknown>) }, 201)
  } catch (err) {
    return apiErrorFromException(err)
  }
})

export const PATCH = withAuth('admin', async (req, user) => {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return apiError('Invalid JSON body', 400)
  }

  const id = sStr(body.id, 200)
  if (!id) return apiError('id is required', 400)

  const ref = adminDb.collection(ANNOUNCEMENTS_COLLECTION).doc(id)
  const snap = await ref.get()
  if (!snap.exists) return apiError('Announcement not found', 404)
  const current = docToAnnouncement(id, (snap.data() ?? {}) as Record<string, unknown>)

  const next = {
    title: 'title' in body ? sStr(body.title, 200) || current.title : current.title,
    body: 'body' in body ? sStr(body.body, 6000) : current.body,
    notes: 'notes' in body ? sNotes(body.notes) : current.notes,
    category: 'category' in body ? sStr(body.category, 60) || current.category : current.category,
    version: 'version' in body ? sStr(body.version, 60) : current.version,
    targetPlans: 'targetPlans' in body ? sPlans(body.targetPlans) : current.targetPlans,
  }

  const nextStatus = validStatus(body.status) ?? current.status
  const publishAt = 'publishAt' in body ? sStr(body.publishAt, 40) || null : current.publishAt
  if (nextStatus === 'scheduled' && !publishAt) {
    return apiError('publishAt is required when status is scheduled', 400)
  }

  const update: Record<string, unknown> = {
    ...next,
    status: nextStatus,
    publishAt,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: user.uid,
  }

  try {
    // Transition into published — mirror to changelog and stamp publishedAt.
    const becamePublished = nextStatus === 'published' && current.status !== 'published'
    if (nextStatus === 'published') {
      const changelogEntryId = await mirrorToChangelog({
        title: next.title,
        body: next.body,
        notes: next.notes,
        version: next.version,
        changelogEntryId: current.changelogEntryId,
      })
      update.changelogEntryId = changelogEntryId
      if (becamePublished || !current.publishedAt) {
        update.publishedAt = FieldValue.serverTimestamp()
      }
    }

    // Archiving a published announcement removes its changelog mirror.
    if (nextStatus === 'archived' && current.changelogEntryId) {
      await adminDb.collection('changelog').doc(current.changelogEntryId).delete().catch(() => {})
      update.changelogEntryId = null
    }

    await ref.set(update, { merge: true })

    await writeAdminAudit(user, {
      action: 'announcement.update',
      summary: `Updated announcement "${next.title}" → ${nextStatus}`,
      metadata: { announcementId: id, status: nextStatus, targetPlans: next.targetPlans },
    })

    const updated = await ref.get()
    return apiSuccess({ announcement: docToAnnouncement(id, (updated.data() ?? {}) as Record<string, unknown>) })
  } catch (err) {
    return apiErrorFromException(err)
  }
})

export const DELETE = withAuth('admin', async (req, user) => {
  const url = new URL(req.url)
  const id = url.searchParams.get('id')?.trim() ?? ''
  if (!id) return apiError('id is required', 400)

  const ref = adminDb.collection(ANNOUNCEMENTS_COLLECTION).doc(id)
  const snap = await ref.get()
  if (!snap.exists) return apiError('Announcement not found', 404)
  const current = docToAnnouncement(id, (snap.data() ?? {}) as Record<string, unknown>)

  try {
    if (current.changelogEntryId) {
      await adminDb.collection('changelog').doc(current.changelogEntryId).delete().catch(() => {})
    }
    await ref.delete()

    await writeAdminAudit(user, {
      action: 'announcement.delete',
      summary: `Deleted announcement "${current.title}"`,
      metadata: { announcementId: id },
    })

    return apiSuccess({ deleted: true, id })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
