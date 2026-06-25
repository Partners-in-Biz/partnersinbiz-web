/**
 * GET  /api/v1/crm/contacts  — list contacts (filterable, paginated)
 * POST /api/v1/crm/contacts  — create a new contact
 *
 * Query params (GET): stage, type, source, tags (csv), status (active|unsubscribed|bounced),
 *   utmSource, minScore (>=), sort (recent|score), search, limit (default 50), page (default 1)
 * Meta (GET): { total, page, limit, orgId, utmSources } — utmSources = distinct values for the source filter
 * Auth: GET → viewer+, POST → member+
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { resolveMemberRef } from '@/lib/orgMembers/memberRef'
import { apiSuccess, apiError } from '@/lib/api/response'
import type {
  Contact,
  ContactInput,
  ContactStage,
  ContactType,
  ContactSource,
} from '@/lib/crm/types'
import { dispatchWebhook } from '@/lib/webhooks/dispatch'
import { logActivity } from '@/lib/activity/log'
import { loadCompany } from '@/lib/companies/store'
import { cleanContactString, normalizeAgreementRoles } from '@/lib/crm/contacts'
import { getDefinitionsForResource } from '@/lib/customFields/store'
import { validateCustomFields } from '@/lib/customFields/validation'
import {
  filterCrmRowsForActor,
  isCrmPrivilegedActor,
  loadCompanyAssignmentMap,
  normalizeAllowedUserIds,
  crmRecordCompanyIds,
} from '@/lib/crm/assignment-access'
import { safeTouchCrmLiveUpdate } from '@/lib/crm/live-updates'

const VALID_STAGES: ContactStage[] = [
  'new', 'contacted', 'replied', 'demo', 'proposal', 'won', 'lost',
]
const VALID_TYPES: ContactType[] = ['lead', 'prospect', 'client', 'churned']
const VALID_SOURCES: ContactSource[] = ['manual', 'form', 'import', 'outreach']

function isValidEmail(e: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)
}

const VALID_STATUSES = ['active', 'unsubscribed', 'bounced'] as const
type SubscriptionStatus = (typeof VALID_STATUSES)[number]

/**
 * Derives a contact's subscription status from its lifecycle timestamps.
 * Bounced and Unsubscribed are terminal and take precedence over Active.
 */
function deriveContactStatus(c: Contact): SubscriptionStatus {
  if (c.bouncedAt) return 'bounced'
  if (c.unsubscribedAt) return 'unsubscribed'
  return 'active'
}

type ContactCompanyLink = {
  companyId: string
  companyName: string
  roleTitle?: string
  relationshipType?: string
  primary?: boolean
}

function cleanOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() || undefined : undefined
}

async function normalizeCompanyLinks(rawLinks: unknown, orgId: string, primary?: { companyId?: string; companyName?: string }): Promise<ContactCompanyLink[] | null> {
  const input = Array.isArray(rawLinks) ? rawLinks : []
  const links: ContactCompanyLink[] = []

  for (const raw of input) {
    if (!raw || typeof raw !== 'object') return null
    const row = raw as Record<string, unknown>
    const companyId = cleanOptionalString(row.companyId)
    if (!companyId) return null
    const loaded = await loadCompany(companyId, orgId)
    if (!loaded) return null
    const next: ContactCompanyLink = {
      companyId,
      companyName: loaded.data.name,
      ...(cleanOptionalString(row.roleTitle) ? { roleTitle: cleanOptionalString(row.roleTitle) } : {}),
      ...(cleanOptionalString(row.relationshipType) ? { relationshipType: cleanOptionalString(row.relationshipType) } : {}),
      ...(row.primary === true ? { primary: true } : {}),
    }
    const existingIndex = links.findIndex((link) => link.companyId === companyId)
    if (existingIndex >= 0) links[existingIndex] = { ...links[existingIndex], ...next }
    else links.push(next)
  }

  if (primary?.companyId && !links.some((link) => link.companyId === primary.companyId)) {
    links.unshift({ companyId: primary.companyId, companyName: primary.companyName ?? '', primary: true })
  }

  return links.map((link, index) => index === 0 && !links.some((candidate) => candidate.primary)
    ? { ...link, primary: true }
    : link)
}


function timestampMillis(value: unknown): number {
  if (!value) return 0
  if (typeof value === 'object' && value !== null) {
    const candidate = value as { toMillis?: () => number; toDate?: () => Date; seconds?: number }
    if (typeof candidate.toMillis === 'function') return candidate.toMillis()
    if (typeof candidate.toDate === 'function') return candidate.toDate().getTime()
    if (typeof candidate.seconds === 'number') return candidate.seconds * 1000
  }
  return 0
}

export const GET = withCrmAuth('viewer', async (req, ctx) => {
  const { searchParams } = new URL(req.url)
  const { orgId } = ctx

  const stage = searchParams.get('stage') as ContactStage | null
  const type = searchParams.get('type') as ContactType | null
  const source = searchParams.get('source') as ContactSource | null
  const tagsParam = searchParams.get('tags') ?? ''
  const capturedFromId = searchParams.get('capturedFromId') ?? ''
  const search = searchParams.get('search') ?? ''
  const status = searchParams.get('status') ?? ''            // active | unsubscribed | bounced
  const utmSource = (searchParams.get('utmSource') ?? '').trim()
  const minScoreParam = searchParams.get('minScore')
  const minScore = minScoreParam !== null ? parseInt(minScoreParam, 10) : null
  const sort = searchParams.get('sort') ?? 'recent'          // recent | score
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 200)
  const page = Math.max(parseInt(searchParams.get('page') ?? '1'), 1)

  const tagList = tagsParam
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
  if (tagList.length > 10) {
    return apiError('tags filter supports up to 10 values (array-contains-any limit)', 400)
  }

  const snapshot = await adminDb
    .collection('contacts')
    .where('orgId', '==', orgId)
    .get()

  let contacts: Contact[] = snapshot.docs
    .map((doc): Contact => ({ ...(doc.data() as Contact), id: doc.id }))
    .filter((c: Contact) => c.orgId === orgId && c.deleted !== true)

  if (!isCrmPrivilegedActor(ctx)) {
    const companyIds = new Set<string>()
    for (const contact of contacts) {
      for (const companyId of crmRecordCompanyIds(contact)) companyIds.add(companyId)
    }
    const companies = await loadCompanyAssignmentMap(orgId, companyIds)
    contacts = filterCrmRowsForActor(ctx, contacts, { companies })
  }

  if (capturedFromId) {
    contacts = contacts.filter((c) => c.capturedFromId === capturedFromId)
  }
  if (stage && VALID_STAGES.includes(stage)) {
    contacts = contacts.filter((c) => c.stage === stage)
  }
  if (type && VALID_TYPES.includes(type)) {
    contacts = contacts.filter((c) => c.type === type)
  }
  if (source && VALID_SOURCES.includes(source)) {
    contacts = contacts.filter((c) => c.source === source)
  }
  if (tagList.length > 0) {
    contacts = contacts.filter((c) => {
      const tags = Array.isArray(c.tags) ? c.tags : []
      return tagList.some((tag) => tags.includes(tag))
    })
  }
  if (status && (VALID_STATUSES as readonly string[]).includes(status)) {
    contacts = contacts.filter((c) => deriveContactStatus(c) === status)
  }

  // Capture distinct UTM sources BEFORE applying the utmSource filter so the
  // list UI dropdown stays stable while a single source is selected.
  const utmSources = Array.from(
    new Set(
      contacts
        .map((c) => (typeof c.utmSource === 'string' ? c.utmSource.trim() : ''))
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b))

  if (utmSource) {
    contacts = contacts.filter((c) => (c.utmSource ?? '') === utmSource)
  }
  if (minScore !== null && Number.isFinite(minScore)) {
    contacts = contacts.filter((c) => (c.leadScore ?? 0) >= minScore)
  }

  if (search) {
    const q = search.toLowerCase()
    contacts = contacts.filter(
      (c) =>
        c.name?.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q) ||
        c.company?.toLowerCase().includes(q),
    )
  }

  if (sort === 'score') {
    contacts.sort((a, b) => {
      const diff = (b.leadScore ?? 0) - (a.leadScore ?? 0)
      if (diff !== 0) return diff
      // Tie-break on recency so equal-score rows stay deterministic.
      return timestampMillis(b.createdAt) - timestampMillis(a.createdAt)
    })
  } else {
    contacts.sort((a, b) => timestampMillis(b.createdAt) - timestampMillis(a.createdAt))
  }

  const total = contacts.length
  const offset = (page - 1) * limit
  return apiSuccess(contacts.slice(offset, offset + limit), 200, { total, page, limit, orgId, utmSources })
})

export const POST = withCrmAuth('member', async (req, ctx) => {
  const body = await req.json() as ContactInput

  if (!body.name?.trim()) return apiError('Name is required')
  if (!body.email?.trim()) return apiError('Email is required')
  if (!isValidEmail(body.email.trim())) return apiError('Email is invalid')
  if (body.stage && !VALID_STAGES.includes(body.stage)) return apiError('Invalid stage')
  if (body.type && !VALID_TYPES.includes(body.type)) return apiError('Invalid type')
  if (body.source && !VALID_SOURCES.includes(body.source)) return apiError('Invalid source')

  const requestedStatus = typeof (body as { status?: unknown }).status === 'string'
    ? ((body as { status?: string }).status as string).trim()
    : ''
  if (requestedStatus && !(VALID_STATUSES as readonly string[]).includes(requestedStatus)) {
    return apiError('Invalid status', 400)
  }
  const subscriptionStatus = (requestedStatus || 'active') as SubscriptionStatus

  const { orgId } = ctx
  const normalizedEmail = body.email.trim().toLowerCase()
  const bodyRaw = body as unknown as Record<string, unknown>
  const linkedUserId = typeof bodyRaw.linkedUserId === 'string' ? bodyRaw.linkedUserId.trim() : ''

  // US-052: reject creating a second contact with an email already on file so the
  // form can surface the collision instead of silently fanning out duplicates.
  const duplicateSnap = await adminDb
    .collection('contacts')
    .where('orgId', '==', orgId)
    .where('email', '==', normalizedEmail)
    .limit(1)
    .get()
  const duplicate = duplicateSnap.docs.find((doc) => doc.data()?.deleted !== true)
  if (duplicate) {
    return apiError(
      `A contact with the email ${normalizedEmail} already exists in this workspace.`,
      409,
      { duplicate: { id: duplicate.id, email: normalizedEmail, reason: 'email' } },
    )
  }

  if (linkedUserId) {
    const linkedUserSnap = await adminDb
      .collection('contacts')
      .where('orgId', '==', orgId)
      .where('linkedUserId', '==', linkedUserId)
      .limit(1)
      .get()
    const linkedDuplicate = linkedUserSnap.docs.find((doc) => doc.data()?.deleted !== true)
    if (linkedDuplicate) {
      return apiError(
        'A contact for this linked platform user already exists in this workspace.',
        409,
        { duplicate: { id: linkedDuplicate.id, linkedUserId, reason: 'linkedUserId' } },
      )
    }
  }
  const agreementRoles = normalizeAgreementRoles(bodyRaw.agreementRoles)
  if (agreementRoles === null) return apiError('Invalid agreementRoles', 400)
  const jobTitle = cleanContactString(bodyRaw.jobTitle)
  const department = cleanContactString(bodyRaw.department)

  const capturedFromId = typeof (body as { capturedFromId?: unknown }).capturedFromId === 'string'
    ? ((body as { capturedFromId?: string }).capturedFromId as string).trim()
    : ''

  const actorRef = ctx.actor
  const requestedAssignedTo = typeof body.assignedTo === 'string' ? body.assignedTo.trim() : ''
  if (!isCrmPrivilegedActor(ctx) && requestedAssignedTo && requestedAssignedTo !== ctx.actor.uid) {
    return apiError('You can only assign contacts to yourself with your current CRM access', 403)
  }
  const assignedToUid = requestedAssignedTo || ctx.actor.uid
  const allowedUserIds = normalizeAllowedUserIds(bodyRaw.allowedUserIds)
  if (assignedToUid && !allowedUserIds.includes(assignedToUid)) allowedUserIds.push(assignedToUid)

  // Default the contact owner to the creator unless the caller explicitly assigns another owner.
  let assignedToRef: import('@/lib/orgMembers/memberRef').MemberRef | undefined
  if (assignedToUid) {
    assignedToRef = assignedToUid === ctx.actor.uid ? actorRef : await resolveMemberRef(ctx.orgId, assignedToUid)
  }

  // Resolve companyId → companyName cache lookup (hybrid model — company string untouched)
  const bodyWithCompany = body as ContactInput & { companyId?: string }
  let resolvedCompanyId: string | undefined
  let resolvedCompanyName: string | undefined
  if (bodyWithCompany.companyId) {
    const loaded = await loadCompany(bodyWithCompany.companyId, orgId)
    if (!loaded) return apiError('Invalid companyId (not found or cross-tenant)', 400)
    resolvedCompanyId = bodyWithCompany.companyId
    resolvedCompanyName = loaded.data.name
  }

  const normalizedCompanyLinks = await normalizeCompanyLinks(bodyRaw.companyLinks, orgId, resolvedCompanyId ? {
    companyId: resolvedCompanyId,
    companyName: resolvedCompanyName,
  } : undefined)
  if (normalizedCompanyLinks === null) return apiError('Invalid companyLinks', 400)

  const contactData = {
    orgId,
    capturedFromId,
    name: body.name.trim(),
    email: body.email.trim().toLowerCase(),
    phone: body.phone?.trim() ?? '',
    ...(jobTitle !== undefined ? { jobTitle } : {}),
    ...(department !== undefined ? { department } : {}),
    ...(agreementRoles !== undefined ? { agreementRoles } : {}),
    company: body.company?.trim() ?? '',
    website: body.website?.trim() ?? '',
    source: body.source ?? 'manual',
    type: body.type ?? 'lead',
    stage: body.stage ?? 'new',
    tags: body.tags ?? [],
    notes: body.notes?.trim() ?? '',
    assignedTo: assignedToUid,
    ownerUid: assignedToUid,
    ...(allowedUserIds.length > 0 ? { allowedUserIds } : {}),
    assignedToRef,  // may be undefined; sanitize step will strip
    ownerRef: assignedToRef, // keep briefings/ownership filters aligned with assignment
    companyId: resolvedCompanyId,     // undefined if not provided; sanitize strips
    companyName: resolvedCompanyName, // undefined if not provided; sanitize strips
    companyLinks: normalizedCompanyLinks.length > 0 ? normalizedCompanyLinks : undefined,
    linkedUserId: linkedUserId || undefined,
    linkedOrgId: typeof bodyRaw.linkedOrgId === 'string' ? bodyRaw.linkedOrgId.trim() || undefined : undefined,
    deleted: false,
    // Subscription lifecycle derived from the requested status (US-052). The
    // contact is always subscribed at creation; unsubscribed/bounced additionally
    // stamp the terminal timestamp that deriveContactStatus() reads back.
    subscribedAt: FieldValue.serverTimestamp(),
    unsubscribedAt: subscriptionStatus === 'unsubscribed' ? FieldValue.serverTimestamp() : null,
    bouncedAt: subscriptionStatus === 'bounced' ? FieldValue.serverTimestamp() : null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    lastContactedAt: null,
    createdBy: ctx.isAgent ? undefined : ctx.actor.uid,
    createdByRef: actorRef,
    updatedBy: ctx.isAgent ? undefined : ctx.actor.uid,
    updatedByRef: actorRef,
  }

  // Custom field validation (best-effort — Firestore outage must not block core write)
  if (bodyRaw.customFields !== undefined && bodyRaw.customFields !== null) {
    try {
      const defs = await getDefinitionsForResource(orgId, 'contact')
      const errs = validateCustomFields(defs, bodyRaw.customFields as Record<string, unknown>)
      if (errs.length > 0) {
        return apiError(`Custom field validation failed: ${errs.map(e => `${e.key}: ${e.message}`).join('; ')}`, 400)
      }
    } catch (err) {
      console.error('custom-field-validation-skipped', err)
    }
  }

  // Firestore rejects undefined values — strip them before write
  const sanitized = Object.fromEntries(
    Object.entries(contactData).filter(([, v]) => v !== undefined),
  )

  const docRef = adminDb.collection('contacts').doc()
  await docRef.set(sanitized)
  await safeTouchCrmLiveUpdate(orgId, 'contacts', 'contact.created')

  try {
    await dispatchWebhook(orgId, 'contact.created', {
      id: docRef.id,
      name: body.name.trim(),
      email: body.email.trim().toLowerCase(),
      phone: body.phone?.trim() ?? '',
      company: body.company?.trim() ?? '',
      source: body.source ?? 'manual',
      createdByRef: actorRef,
    })
  } catch (err) {
    console.error('[webhook-dispatch-error] contact.created', err)
  }

  logActivity({
    orgId,
    type: 'crm_contact_created',
    actorId: ctx.actor.uid,
    actorName: ctx.actor.displayName,
    actorRole: ctx.isAgent ? 'ai' : ctx.role === 'admin' ? 'admin' : 'client',
    description: `Created contact: "${body.name.trim()}"`,
    entityId: docRef.id,
    entityType: 'contact',
    entityTitle: body.name.trim(),
  }).catch(() => {})

  // ── Automation trigger (A6) — best-effort ──────────────────────────────────
  try {
    const { fireTrigger } = await import('@/lib/automations/trigger')
    await fireTrigger('contact.created', {
      orgId,
      contactId: docRef.id,
      contactEmail: body.email.trim().toLowerCase(),
    })
  } catch { /* best-effort */ }

  return apiSuccess({ id: docRef.id }, 201)
})
