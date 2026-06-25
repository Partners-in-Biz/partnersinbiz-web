// app/api/v1/admin/reports/templates/route.ts
//
// Firestore-backed report template management (US-289).
//
//   GET    -> { templates, orgs } — custom + built-in templates, plus accessible
//             orgs for the assign-to-orgs picker.
//   POST   -> create a custom template (writes v1 + a version snapshot).
//   PATCH  -> update a custom template (bumps version, writes a version snapshot).
//             Also used to assign-to-orgs via { assignedOrgIds }.
//   DELETE -> remove a custom template (?id=...). Built-ins cannot be deleted.

import { FieldValue } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError, apiErrorFromException } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { writeAdminAudit } from '@/lib/admin/audit'
import { restrictedAdminOrgIds } from '@/lib/api/platformAdmin'
import {
  TEMPLATES_COLLECTION,
  VERSIONS_SUBCOLLECTION,
  listTemplates,
  docToRecord,
} from './data'

export const dynamic = 'force-dynamic'

interface OrgOption {
  id: string
  name: string
  slug: string
}

async function accessibleOrgs(restricted: string[]): Promise<OrgOption[]> {
  if (restricted.length > 0) {
    const docs = await Promise.all(
      restricted.map((id) => adminDb.collection('organizations').doc(id).get().catch(() => null)),
    )
    return docs
      .filter((d): d is FirebaseFirestore.DocumentSnapshot => !!d && d.exists)
      .map((d) => {
        const data = d.data() ?? {}
        return { id: d.id, name: String(data.name ?? d.id), slug: String(data.slug ?? d.id) }
      })
  }
  const snap = await adminDb.collection('organizations').limit(400).get().catch(() => null)
  return (snap?.docs ?? []).map((d) => {
    const data = d.data() ?? {}
    return { id: d.id, name: String(data.name ?? d.id), slug: String(data.slug ?? d.id) }
  })
}

function sanitiseString(value: unknown, max = 2000): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function sanitiseAssigned(value: unknown, allowed: Set<string> | null): string[] {
  if (!Array.isArray(value)) return []
  const out = new Set<string>()
  for (const v of value) {
    if (typeof v !== 'string' || !v.trim()) continue
    const id = v.trim()
    if (allowed && !allowed.has(id)) continue
    out.add(id)
  }
  return Array.from(out)
}

export const GET = withAuth('admin', async (_req, user) => {
  try {
    const [templates, orgs] = await Promise.all([
      listTemplates(),
      accessibleOrgs(restrictedAdminOrgIds(user)),
    ])
    return apiSuccess({ templates, orgs })
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

  const name = sanitiseString(body.name, 160)
  if (!name) return apiError('name is required', 400)

  const restricted = restrictedAdminOrgIds(user)
  const allowed = restricted.length > 0 ? new Set(restricted) : null
  const assignedOrgIds = sanitiseAssigned(body.assignedOrgIds, allowed)

  const record = {
    name,
    eyebrow: sanitiseString(body.eyebrow, 200),
    subject: sanitiseString(body.subject, 300) || '{org} report · {period}',
    description: sanitiseString(body.description, 600),
    body: sanitiseString(body.body, 8000),
    assignedOrgIds,
    isDefault: body.isDefault === true,
    version: 1,
    source: 'custom',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    createdBy: user.uid,
  }

  try {
    const ref = await adminDb.collection(TEMPLATES_COLLECTION).add(record)
    await ref.collection(VERSIONS_SUBCOLLECTION).add({
      version: 1,
      name: record.name,
      eyebrow: record.eyebrow,
      subject: record.subject,
      description: record.description,
      body: record.body,
      assignedOrgIds,
      changedBy: user.uid,
      changeNote: 'Created',
      createdAt: FieldValue.serverTimestamp(),
    })

    await writeAdminAudit(user, {
      action: 'report_template.create',
      summary: `Created report template "${name}"`,
      metadata: { templateId: ref.id, assignedOrgIds },
    })

    const snap = await ref.get()
    return apiSuccess({ template: docToRecord(ref.id, (snap.data() ?? {}) as Record<string, unknown>) }, 201)
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

  const id = sanitiseString(body.id, 200)
  if (!id) return apiError('id is required', 400)
  if (id.startsWith('builtin:')) return apiError('Built-in templates are read-only', 400)

  const ref = adminDb.collection(TEMPLATES_COLLECTION).doc(id)
  const snap = await ref.get()
  if (!snap.exists) return apiError('Template not found', 404)

  const current = docToRecord(id, (snap.data() ?? {}) as Record<string, unknown>)
  const restricted = restrictedAdminOrgIds(user)
  const allowed = restricted.length > 0 ? new Set(restricted) : null

  // Build the next state, only overriding fields present in the request body.
  const next = {
    name: 'name' in body ? sanitiseString(body.name, 160) || current.name : current.name,
    eyebrow: 'eyebrow' in body ? sanitiseString(body.eyebrow, 200) : current.eyebrow,
    subject: 'subject' in body ? sanitiseString(body.subject, 300) || current.subject : current.subject,
    description: 'description' in body ? sanitiseString(body.description, 600) : current.description,
    body: 'body' in body ? sanitiseString(body.body, 8000) : current.body,
    assignedOrgIds:
      'assignedOrgIds' in body ? sanitiseAssigned(body.assignedOrgIds, allowed) : current.assignedOrgIds,
    isDefault: 'isDefault' in body ? body.isDefault === true : current.isDefault,
  }

  const changeNote = sanitiseString(body.changeNote, 300) || 'Updated'
  const newVersion = current.version + 1

  try {
    await ref.set(
      {
        ...next,
        version: newVersion,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: user.uid,
      },
      { merge: true },
    )
    await ref.collection(VERSIONS_SUBCOLLECTION).add({
      version: newVersion,
      ...next,
      changedBy: user.uid,
      changeNote,
      createdAt: FieldValue.serverTimestamp(),
    })

    await writeAdminAudit(user, {
      action: 'report_template.update',
      summary: `Updated report template "${next.name}" (v${newVersion})`,
      metadata: { templateId: id, version: newVersion, changeNote, assignedOrgIds: next.assignedOrgIds },
    })

    const updated = await ref.get()
    return apiSuccess({ template: docToRecord(id, (updated.data() ?? {}) as Record<string, unknown>) })
  } catch (err) {
    return apiErrorFromException(err)
  }
})

export const DELETE = withAuth('admin', async (req, user) => {
  const url = new URL(req.url)
  const id = url.searchParams.get('id')?.trim() ?? ''
  if (!id) return apiError('id is required', 400)
  if (id.startsWith('builtin:')) return apiError('Built-in templates cannot be deleted', 400)

  const ref = adminDb.collection(TEMPLATES_COLLECTION).doc(id)
  const snap = await ref.get()
  if (!snap.exists) return apiError('Template not found', 404)
  const name = String((snap.data() ?? {}).name ?? id)

  try {
    // Delete version snapshots, then the template doc.
    const versions = await ref.collection(VERSIONS_SUBCOLLECTION).get()
    const batch = adminDb.batch()
    versions.docs.forEach((d) => batch.delete(d.ref))
    batch.delete(ref)
    await batch.commit()

    await writeAdminAudit(user, {
      action: 'report_template.delete',
      summary: `Deleted report template "${name}"`,
      metadata: { templateId: id },
    })

    return apiSuccess({ deleted: true, id })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
