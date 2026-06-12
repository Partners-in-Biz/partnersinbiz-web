/**
 * POST /api/v1/crm/contacts/import — bulk-create contacts from a parsed CSV.
 *
 * Body:
 *   {
 *     capturedFromId?: string       // CaptureSource id (must be type='csv' for clarity)
 *     rows: Array<{                 // also accepted as `contacts`
 *       email: string               // required
 *       name?: string
 *       firstName?: string
 *       lastName?: string
 *       company?: string
 *       phone?: string
 *       tags?: string[]
 *       notes?: string
 *     }>
 *     defaultTags?: string[]        // merged with each row's tags
 *     dryRun?: boolean              // when true, validate + return preview without writing
 *   }
 *
 * Returns: { created, updated, skipped, invalidRows: [{ index, reason }] }
 *          dryRun mode also returns: previewSample (first 3 normalized rows)
 *
 * Auth: member+
 *
 * Notes:
 * - Existing contacts (by orgId+email) get tag-merge only — no name/company overwrite.
 * - autoTags from the supplied capture source are merged in (if same org).
 * - source.capturedCount bumps by `created` only (not by updates).
 * - Auto-enroll behavior is OUT OF SCOPE — CSV imports skip campaign enrollment to
 *   avoid surprise sends.
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import {
  crmActorCanReadRecord,
  crmRecordCompanyIds,
  isCrmPrivilegedActor,
  loadCompanyAssignmentMap,
  normalizeAllowedUserIds,
  type AssignableCrmRecord,
} from '@/lib/crm/assignment-access'
import { safeTouchCrmLiveUpdate } from '@/lib/crm/live-updates'

const MAX_ROWS = 5000
const BATCH_CHUNK = 400

interface ImportRow {
  email: string
  name?: string
  firstName?: string
  lastName?: string
  company?: string
  phone?: string
  tags?: string[]
  notes?: string
}

interface InvalidRow {
  index: number
  reason: string
}

interface NormalizedRow {
  index: number
  email: string
  name: string
  company: string
  phone: string
  tags: string[]
  notes: string
}

type ExistingContact = {
  id: string
  ref: FirebaseFirestore.DocumentReference
  data: AssignableCrmRecord & { tags?: unknown }
  tags: string[]
}

type CompanyPlan = {
  id: string
  ref: FirebaseFirestore.DocumentReference
  name: string
  create: boolean
}

function isValidEmail(e: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)
}

function uniqueTags(...lists: Array<unknown>): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const list of lists) {
    if (!Array.isArray(list)) continue
    for (const raw of list) {
      if (typeof raw !== 'string') continue
      const t = raw.trim()
      if (!t) continue
      const key = t.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(t)
    }
  }
  return out
}

function deriveName(row: ImportRow): string {
  const name = (row.name ?? '').trim()
  if (name) return name
  const first = (row.firstName ?? '').trim()
  const last = (row.lastName ?? '').trim()
  const combined = `${first} ${last}`.trim()
  return combined
}

function companyKey(value: string): string {
  return value.trim().toLowerCase()
}

async function buildCompanyPlans(orgId: string, rows: NormalizedRow[]): Promise<{
  byName: Map<string, CompanyPlan>
  preview: { upsert: number; linked: number; skipped: number }
}> {
  const names = Array.from(new Set(rows.map((row) => row.company.trim()).filter(Boolean)))
  const byName = new Map<string, CompanyPlan>()
  if (names.length === 0) return { byName, preview: { upsert: 0, linked: 0, skipped: 0 } }

  const companiesSnap = await adminDb.collection('companies')
    .where('orgId', '==', orgId)
    .limit(1000)
    .get()
  for (const doc of companiesSnap.docs) {
    const data = doc.data() ?? {}
    if (data.deleted === true) continue
    const name = typeof data.name === 'string' ? data.name.trim() : ''
    if (!name) continue
    byName.set(companyKey(name), { id: doc.id, ref: doc.ref, name, create: false })
  }

  let upsert = 0
  let linked = 0
  for (const name of names) {
    const key = companyKey(name)
    const existing = byName.get(key)
    if (existing) {
      linked += 1
      continue
    }
    const ref = adminDb.collection('companies').doc()
    byName.set(key, {
      id: ref.id,
      ref,
      name,
      create: true,
    })
    upsert += 1
  }

  return {
    byName,
    preview: { upsert, linked, skipped: 0 },
  }
}

export const POST = withCrmAuth('member', async (req, ctx) => {
  const body = await req.json().catch(() => null) as
    | {
        capturedFromId?: string
        rows?: ImportRow[]
        contacts?: ImportRow[]
        defaultTags?: string[]
        dryRun?: boolean
      }
    | null

  if (!body) return apiError('Invalid JSON', 400)

  const { orgId } = ctx

  // Accept either `rows` or `contacts` as the array field name
  const rawRows = Array.isArray(body.rows) ? body.rows : Array.isArray(body.contacts) ? body.contacts : null
  if (!rawRows) return apiError('rows must be an array', 400)
  if (rawRows.length === 0) return apiError('rows must not be empty', 400)
  if (rawRows.length > MAX_ROWS) {
    return apiError(`rows exceeds maximum of ${MAX_ROWS}`, 400)
  }

  const capturedFromId =
    typeof body.capturedFromId === 'string' ? body.capturedFromId.trim() : ''
  const defaultTags = Array.isArray(body.defaultTags) ? body.defaultTags : []
  const dryRun = body.dryRun === true

  const actorRef = ctx.actor
  const restrictedRecords = !isCrmPrivilegedActor(ctx)

  // Resolve capture source autoTags (and confirm same org). If the source
  // doesn't belong to the org, we silently ignore it (don't apply autoTags
  // and don't bump its counter), but still keep capturedFromId on the row
  // metadata so the import isn't silently dropped on a typo. Actually —
  // safer to clear it instead.
  let sourceAutoTags: string[] = []
  let sourceRef: FirebaseFirestore.DocumentReference | null = null
  let effectiveCapturedFromId = ''
  if (capturedFromId) {
    const sourceSnap = await adminDb
      .collection('capture_sources')
      .doc(capturedFromId)
      .get()
    if (sourceSnap.exists) {
      const sourceData = sourceSnap.data() ?? {}
      if (sourceData.orgId === orgId) {
        sourceAutoTags = Array.isArray(sourceData.autoTags) ? sourceData.autoTags : []
        sourceRef = sourceSnap.ref
        effectiveCapturedFromId = capturedFromId
      }
    }
  }

  // Validate + normalize rows
  const invalidRows: InvalidRow[] = []
  const normalized: NormalizedRow[] = []
  const seenEmailsInPayload = new Set<string>()

  for (let i = 0; i < rawRows.length; i++) {
    const raw = rawRows[i]
    if (!raw || typeof raw !== 'object') {
      invalidRows.push({ index: i, reason: 'row is not an object' })
      continue
    }
    const emailRaw = typeof raw.email === 'string' ? raw.email.trim().toLowerCase() : ''
    if (!emailRaw) {
      invalidRows.push({ index: i, reason: 'email is required' })
      continue
    }
    if (!isValidEmail(emailRaw)) {
      invalidRows.push({ index: i, reason: 'email is invalid' })
      continue
    }
    if (seenEmailsInPayload.has(emailRaw)) {
      invalidRows.push({ index: i, reason: 'duplicate email in payload' })
      continue
    }
    seenEmailsInPayload.add(emailRaw)

    const tags = uniqueTags(raw.tags, defaultTags, sourceAutoTags)

    normalized.push({
      index: i,
      email: emailRaw,
      name: deriveName(raw),
      company: typeof raw.company === 'string' ? raw.company.trim() : '',
      phone: typeof raw.phone === 'string' ? raw.phone.trim() : '',
      tags,
      notes: typeof raw.notes === 'string' ? raw.notes.trim() : '',
    })
  }

  if (normalized.length === 0) {
    return apiSuccess({
      created: 0,
      updated: 0,
      skipped: invalidRows.length,
      invalidRows,
      ...(dryRun ? { previewSample: [] } : {}),
    })
  }

  // Look up existing contacts in the org by email. Firestore `in` queries
  // accept up to 30 values per query, so we chunk.
  const emailToExisting = new Map<string, ExistingContact>()
  const emails = normalized.map((n) => n.email)
  const IN_CHUNK = 30
  for (let i = 0; i < emails.length; i += IN_CHUNK) {
    const slice = emails.slice(i, i + IN_CHUNK)
    const snap = await (adminDb.collection('contacts') as any)
      .where('orgId', '==', orgId)
      .where('email', 'in', slice)
      .get()
    for (const doc of snap.docs as any[]) {
      const data = doc.data() ?? {}
      if (data.deleted === true) continue
      const email = typeof data.email === 'string' ? data.email.toLowerCase() : ''
      if (!email) continue
      emailToExisting.set(email, {
        id: doc.id,
        ref: doc.ref,
        data: { id: doc.id, ...data } as AssignableCrmRecord & { tags?: unknown },
        tags: Array.isArray(data.tags) ? data.tags : [],
      })
    }
  }

  const companyPlan = await buildCompanyPlans(orgId, normalized)

  let existingCompaniesForAccess = new Map<string, AssignableCrmRecord>()
  if (restrictedRecords) {
    const companyIds = new Set<string>()
    for (const existing of emailToExisting.values()) {
      for (const companyId of crmRecordCompanyIds(existing.data)) companyIds.add(companyId)
    }
    existingCompaniesForAccess = await loadCompanyAssignmentMap(orgId, companyIds)
  }

  // Partition into create-vs-update plans
  const toCreate: NormalizedRow[] = []
  const toUpdate: Array<{
    row: NormalizedRow
    ref: FirebaseFirestore.DocumentReference
    mergedTags: string[]
    company?: CompanyPlan
  }> = []
  let accessSkipped = 0

  for (const row of normalized) {
    const existing = emailToExisting.get(row.email)
    const linkedCompany = row.company ? companyPlan.byName.get(companyKey(row.company)) : undefined
    if (existing) {
      if (restrictedRecords && !crmActorCanReadRecord(ctx, existing.data, { companies: existingCompaniesForAccess })) {
        accessSkipped += 1
        continue
      }
      const mergedTags = uniqueTags(existing.tags, row.tags)
      // Skip the write if no new tags were added.
      if (mergedTags.length === existing.tags.length && !linkedCompany) {
        continue
      }
      toUpdate.push({ row, ref: existing.ref, mergedTags, company: linkedCompany })
    } else {
      toCreate.push(row)
    }
  }

  if (dryRun) {
    return apiSuccess({
      created: toCreate.length,
      updated: toUpdate.length,
      skipped: invalidRows.length + accessSkipped,
      invalidRows,
      companyPreview: companyPlan.preview,
      previewSample: normalized.slice(0, 4).map((r) => ({
        index: r.index,
        email: r.email,
        name: r.name,
        company: r.company,
        phone: r.phone,
        tags: r.tags,
        notes: r.notes,
        capturedFromId: effectiveCapturedFromId,
      })),
    })
  }

  // Commit in chunks of BATCH_CHUNK writes per batch.
  const contactsCol = adminDb.collection('contacts')
  type Op =
    | { kind: 'company'; ref: FirebaseFirestore.DocumentReference; company: CompanyPlan }
    | { kind: 'create'; ref: FirebaseFirestore.DocumentReference; row: NormalizedRow }
    | { kind: 'update'; ref: FirebaseFirestore.DocumentReference; row: NormalizedRow; mergedTags: string[]; company?: CompanyPlan }
  const ops: Op[] = []

  const newCompanyPlans = Array.from(companyPlan.byName.values()).filter((company) => company.create)
  for (const company of newCompanyPlans) {
    ops.push({ kind: 'company', ref: company.ref, company })
  }
  for (const row of toCreate) {
    ops.push({ kind: 'create', ref: contactsCol.doc(), row })
  }
  for (const upd of toUpdate) {
    ops.push({ kind: 'update', ref: upd.ref, row: upd.row, mergedTags: upd.mergedTags, company: upd.company })
  }

  for (let i = 0; i < ops.length; i += BATCH_CHUNK) {
    const slice = ops.slice(i, i + BATCH_CHUNK)
    const batch = adminDb.batch()
    for (const op of slice) {
      if (op.kind === 'company') {
        const companyData = {
          orgId,
          name: op.company.name,
          source: 'import',
          ownerUid: restrictedRecords ? ctx.actor.uid : undefined,
          ownerRef: restrictedRecords ? actorRef : undefined,
          allowedUserIds: restrictedRecords ? [ctx.actor.uid] : undefined,
          createdBy: ctx.isAgent ? undefined : ctx.actor.uid,
          createdByRef: actorRef,
          updatedBy: ctx.isAgent ? undefined : ctx.actor.uid,
          updatedByRef: actorRef,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          deleted: false,
        }
        batch.set(op.ref, Object.fromEntries(Object.entries(companyData).filter(([, v]) => v !== undefined)))
      } else if (op.kind === 'create') {
        const linkedCompany = op.row.company ? companyPlan.byName.get(companyKey(op.row.company)) : undefined
        const allowedUserIds = restrictedRecords ? normalizeAllowedUserIds([ctx.actor.uid]) : []
        const data = {
          orgId,
          capturedFromId: effectiveCapturedFromId,
          name: op.row.name,
          email: op.row.email,
          phone: op.row.phone,
          company: op.row.company,
          website: '',
          source: 'import' as const,
          type: 'lead' as const,
          stage: 'new' as const,
          tags: op.row.tags,
          notes: op.row.notes,
          assignedTo: restrictedRecords ? ctx.actor.uid : '',
          assignedToRef: restrictedRecords ? actorRef : undefined,
          ...(allowedUserIds.length > 0 ? { allowedUserIds } : {}),
          companyId: linkedCompany?.id,
          companyName: linkedCompany?.name,
          companyLinks: linkedCompany ? [{ companyId: linkedCompany.id, companyName: linkedCompany.name, primary: true }] : undefined,
          deleted: false,
          subscribedAt: FieldValue.serverTimestamp(),
          unsubscribedAt: null,
          bouncedAt: null,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          lastContactedAt: null,
          createdBy: ctx.isAgent ? undefined : ctx.actor.uid,
          createdByRef: actorRef,
          updatedBy: ctx.isAgent ? undefined : ctx.actor.uid,
          updatedByRef: actorRef,
        }
        const sanitized = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined))
        batch.set(op.ref, sanitized)
      } else {
        const updatePatch: Record<string, unknown> = {
          tags: op.mergedTags,
          ...(op.company ? {
            company: op.company.name,
            companyId: op.company.id,
            companyName: op.company.name,
            companyLinks: [{ companyId: op.company.id, companyName: op.company.name, primary: true }],
          } : {}),
          updatedBy: ctx.isAgent ? undefined : ctx.actor.uid,
          updatedByRef: actorRef,
          updatedAt: FieldValue.serverTimestamp(),
        }
        const sanitized = Object.fromEntries(Object.entries(updatePatch).filter(([, v]) => v !== undefined))
        batch.update(op.ref, sanitized)
      }
    }
    await batch.commit()
  }

  if (toCreate.length > 0 || toUpdate.length > 0) {
    await safeTouchCrmLiveUpdate(orgId, 'contacts', 'contacts.imported')
  }
  if (newCompanyPlans.length > 0) {
    await safeTouchCrmLiveUpdate(orgId, 'companies', 'companies.imported')
  }

  // Bump source counter by `created` only — folded into a final batch write.
  if (sourceRef && toCreate.length > 0) {
    try {
      const finalBatch = adminDb.batch()
      finalBatch.update(sourceRef, {
        capturedCount: FieldValue.increment(toCreate.length),
        lastCapturedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      await finalBatch.commit()
    } catch (err) {
      console.error('[contacts-import] failed to bump source counter', err)
    }
  }

  return apiSuccess({
    created: toCreate.length,
    updated: toUpdate.length,
    skipped: invalidRows.length + accessSkipped,
    invalidRows,
    companyPreview: companyPlan.preview,
  })
})
