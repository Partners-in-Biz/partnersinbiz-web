import { FieldValue } from 'firebase-admin/firestore'

import { ownerUidFrom } from '@/lib/api/actor'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import type { ApiUser } from '@/lib/api/types'
import type { StudioKind } from '@/lib/chat-context/types'
import { parseMarketingCanvasContextId } from '@/lib/chat-context/marketingCanvasIdentity'
import { parseStudioArtifactContextId, studioArtifactContextId } from '@/lib/chat-context/studioArtifactIdentity'
import { canAccessModule, type WorkspaceModuleKey } from '@/lib/orgMembers/access-policy'
import { assertUserCanPerformOrganizationModuleAction } from '@/lib/organizations/module-policy-access'
import { isPortalModuleEnabled, type PortalModuleKey } from '@/lib/organizations/portal-modules'
import {
  explicitLinkedClientOrgIds,
  getAccessibleClientDocument,
  isClientVisibleToOrg,
} from '@/lib/client-documents/access'
import { CLIENT_DOCUMENTS_COLLECTION } from '@/lib/client-documents/store'
import { listCompanyDocuments } from '@/lib/companies/command-center'
import type { Company } from '@/lib/companies/types'
import { convDoc } from '@/lib/conversations/conversations'
import { adminDb } from '@/lib/firebase/admin'
import { getProjectForUser } from '@/lib/projects/access'
import { filterProjectItemsForAccess, filterProjectsForMemberScope } from '@/lib/projects/collaboration'
import { getResearchItem, RESEARCH_COLLECTION } from '@/lib/research/store'
import { getSupportTicket, SUPPORT_TICKETS_COLLECTION } from '@/lib/support/store'
import {
  calendarEventVisibleToActor,
  loadCalendarActorEmails,
} from '@/lib/calendar/access'
import type { CalendarEvent } from '@/lib/calendar/types'
import { canReadWorkspaceArtifact } from '@/lib/workspace-os/artifacts'
import {
  type AssignableCrmRecord,
  crmActorCanReadCompanyRecord,
  crmActorCanReadRecord,
  crmRecordCompanyIds,
  crmRecordContactIds,
  filterCrmRowsForActor,
  isCrmPrivilegedActor,
  loadCompanyAssignmentMap,
  loadContactAssignmentMap,
} from '@/lib/crm/assignment-access'
import {
  crmActorCanReadBillingRecord,
  filterBillingRecordsForCrmActor,
  resolveBillingCrmAuthContext,
} from '@/lib/billing/crm-record-scope'
import {
  contextReferenceKey,
  contextReferenceTypeFrom,
  MAX_ATTACHED_CONTEXT_CHARS,
  MAX_CONTEXT_REFS,
  MAX_CONTEXT_SUMMARY_CHARS,
  normalizeContextReference,
  sanitizeContextReferenceSeeds,
  type ContextReference,
  type ContextReferenceOrigin,
  type ContextReferenceSeed,
  type ContextReferenceType,
} from './types'
import {
  isWorkbenchPathContextSeed,
  resolveWorkbenchPathContextReference,
} from '@/lib/messages/workbench/context-references'

type RawDoc = Record<string, unknown>
type FirestoreDoc = {
  id: string
  exists?: boolean
  data: () => RawDoc | undefined
}

type ResolverInput = {
  seed: ContextReferenceSeed
  user: ApiUser
  defaultOrgId?: string
}

export interface SearchContextReferencesInput {
  type: ContextReferenceType
  query?: string
  orgId: string
  projectId?: string
  contextType?: ContextReferenceType
  contextId?: string
  limit?: number
  user: ApiUser
}

export interface PatchConversationContextRefsInput {
  convId: string
  orgId: string
  action: 'add' | 'remove' | 'clear'
  refs?: ContextReferenceSeed[]
  currentRefs?: ContextReference[]
  user: ApiUser
}

const COLLECTION_BY_TYPE: Partial<Record<ContextReferenceType, string>> = {
  contact: 'contacts',
  company: 'companies',
  product: 'products',
  document: CLIENT_DOCUMENTS_COLLECTION,
  research: RESEARCH_COLLECTION,
  social: 'social_posts',
  campaign: 'campaigns',
  email: 'mailbox_messages',
  support: SUPPORT_TICKETS_COLLECTION,
  task: 'tasks',
  deal: 'deals',
  invoice: 'invoices',
  quote: 'quotes',
  property: 'properties',
  seo_sprint: 'seo_sprints',
  workspace_folder: 'workspace_folders',
  workspace_artifact: 'workspace_artifacts',
  workspace_connection: 'workspace_connections',
  workspace_broker_job: 'workspace_broker_jobs',
  file: 'uploads',
  report: 'reports',
  calendar_event: 'calendar_events',
}

const SEARCH_SCAN_LIMIT_BY_TYPE: Partial<Record<ContextReferenceType, number>> = {
  contact: 500,
  company: 500,
}

type StudioDefinition = {
  label: string
  route: string
  adminRoute?: (orgData: RawDoc) => string
  moduleKey: Extract<WorkspaceModuleKey, 'marketing' | 'mobileApps' | 'youtubeStudio' | 'bookStudio'>
  portalModuleKey?: PortalModuleKey
  resources: Record<string, { collection: string; exactHref?: (id: string, base: string, data: RawDoc) => string }>
}

const STUDIO_DEFINITIONS: Record<StudioKind, StudioDefinition> = {
  marketing_studio: {
    label: 'Marketing Studio', route: '/portal/creative-canvas', adminRoute: () => '/admin/creative-canvas', moduleKey: 'marketing',
    resources: {
      canvas: { collection: 'creative_canvases', exactHref: (id, base) => `${base}?canvasId=${encodeURIComponent(id)}` },
    },
  },
  video_editor: {
    label: 'Video Editor', route: '/portal/video-editor', moduleKey: 'marketing',
    resources: {
      project: { collection: 'video_editor_projects', exactHref: (id, base) => `${base}?projectId=${encodeURIComponent(id)}` },
    },
  },
  book_studio: {
    label: 'Book Studio', route: '/portal/book-studio', adminRoute: (org) => clean(org.slug) ? `/admin/org/${encodeURIComponent(clean(org.slug))}/book-studio` : '/portal/book-studio', moduleKey: 'bookStudio', portalModuleKey: 'bookStudio',
    resources: {
      project: { collection: 'book_studio_projects', exactHref: (id, base) => `${base}/${encodeURIComponent(id)}` },
      book: { collection: 'book_studio_projects', exactHref: (id, base) => `${base}/${encodeURIComponent(id)}` },
    },
  },
  youtube_studio: {
    label: 'YouTube Studio', route: '/portal/youtube-studio', adminRoute: (org) => clean(org.slug) ? `/admin/org/${encodeURIComponent(clean(org.slug))}/youtube-studio` : '/portal/youtube-studio', moduleKey: 'youtubeStudio', portalModuleKey: 'youtubeStudio',
    resources: {
      video_project: { collection: 'youtube_video_projects', exactHref: (id, base) => `${base}/editor/${encodeURIComponent(id)}` },
      project: { collection: 'youtube_video_projects', exactHref: (id, base) => `${base}/editor/${encodeURIComponent(id)}` },
    },
  },
  mobile_apps: {
    label: 'Mobile Apps', route: '/portal/mobile-apps', adminRoute: (org) => clean(org.slug) ? `/admin/org/${encodeURIComponent(clean(org.slug))}/mobile-apps` : '/portal/mobile-apps', moduleKey: 'mobileApps', portalModuleKey: 'mobileApps',
    resources: {
      app: { collection: 'mobile_apps', exactHref: (id, base) => `${base}?appId=${encodeURIComponent(id)}` },
    },
  },
}

function studioKindFrom(value: string): StudioKind | null {
  return Object.prototype.hasOwnProperty.call(STUDIO_DEFINITIONS, value) ? value as StudioKind : null
}

function studioArtifactReferenceId(studioKind: StudioKind, orgId: string, resourceType: string, resourceId: string): string {
  return studioKind === 'marketing_studio' || studioKind === 'mobile_apps'
    ? studioArtifactContextId({ studioKind, orgId, resourceType, resourceId })
    : `${studioKind}:${resourceType}:${encodeURIComponent(resourceId)}`
}

function portalSettingsFrom(data: RawDoc): { portalModules?: Partial<Record<PortalModuleKey, boolean>> } | undefined {
  if (!data.settings || typeof data.settings !== 'object' || Array.isArray(data.settings)) return undefined
  const settings = data.settings as Record<string, unknown>
  if (!settings.portalModules || typeof settings.portalModules !== 'object' || Array.isArray(settings.portalModules)) return {}
  const raw = settings.portalModules as Record<string, unknown>
  const portalModules: Partial<Record<PortalModuleKey, boolean>> = {}
  for (const key of ['mobileApps', 'youtubeStudio', 'bookStudio'] as PortalModuleKey[]) {
    if (typeof raw[key] === 'boolean') portalModules[key] = raw[key] as boolean
  }
  return { portalModules }
}

async function canUseStudio(user: ApiUser, orgId: string, definition: StudioDefinition, orgData: RawDoc): Promise<boolean> {
  if (!canUseOrg(user, orgId)) return false
  if (user.role !== 'client') return true
  if (!canAccessModule(user.memberAccessPolicy, definition.moduleKey)) return false
  if (definition.portalModuleKey && !isPortalModuleEnabled(portalSettingsFrom(orgData), definition.portalModuleKey)) return false
  const policy = await assertUserCanPerformOrganizationModuleAction(
    user, orgId, definition.moduleKey, 'visibility', 'Forbidden', orgData,
  )
  return policy.ok
}

function clean(value: unknown, max = 260): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : ''
}

function nestedClean(value: unknown, key: string, max = 260): string {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? clean((value as Record<string, unknown>)[key], max)
    : ''
}

function contactDisplayName(data: RawDoc): string {
  const firstName = clean(data.firstName) || clean(data.givenName)
  const lastName = clean(data.lastName) || clean(data.familyName) || clean(data.surname)
  const partsName = [firstName, lastName].filter(Boolean).join(' ')
  return clean(data.name) ||
    clean(data.fullName) ||
    clean(data.displayName) ||
    partsName ||
    clean(data.email)
}

function compactSummary(parts: Array<unknown>, max = MAX_CONTEXT_SUMMARY_CHARS): string {
  return parts
    .map((part) => clean(part, max))
    .filter(Boolean)
    .join(' | ')
    .slice(0, max)
}

// Context references are persisted on conversations.  Keep the presentation
// metadata deliberately small, serialisable, and derived from canonical fields
// only; it is refreshed by every chat-context read and never includes a raw
// domain record.
function safeIso(value: unknown): string | undefined {
  const date = value instanceof Date
    ? value
    : value && typeof value === 'object' && typeof (value as { toDate?: unknown }).toDate === 'function'
      ? (value as { toDate: () => Date }).toDate()
      : typeof value === 'string' || typeof value === 'number'
        ? new Date(value)
        : null
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : undefined
}

function presentationActivity(id: string, type: 'pickup' | 'running' | 'waiting' | 'dependency_released' | 'failure' | 'blocked' | 'approval_required' | 'input_required' | 'review_required' | 'verified_complete', label: string, occurredAt: unknown, detail?: string) {
  const timestamp = safeIso(occurredAt)
  return timestamp ? { id, type, label, occurredAt: timestamp, ...(detail ? { detail: clean(detail, 240) } : {}) } : null
}

function relationSeed(type: ContextReferenceType, id: unknown, relation: string) {
  const safeId = clean(id, 200)
  return safeId ? { type, id: safeId, relation: clean(relation, 80) || 'Related' } : null
}

function origin(seed: ContextReferenceSeed): ContextReferenceOrigin {
  return seed.origin ?? 'manual'
}

function expectedOrgId(seed: ContextReferenceSeed, defaultOrgId?: string): string | undefined {
  return defaultOrgId || seed.orgId
}

function sameOrg(data: RawDoc, orgId?: string): boolean {
  if (!orgId) return true
  return clean(data.orgId) === orgId ||
    clean(data.clientOrgId) === orgId ||
    clean(data.clientId) === orgId ||
    clean(data.sourceOrgId) === orgId ||
    clean(data.recipientOrgId) === orgId ||
    clean(data.targetOrgId) === orgId
}

function docOrgId(data: RawDoc, fallback?: string): string {
  return clean(data.orgId) ||
    clean(data.clientOrgId) ||
    clean(data.clientId) ||
    clean(data.sourceOrgId) ||
    clean(data.recipientOrgId) ||
    clean(data.targetOrgId) ||
    fallback ||
    ''
}

function canUseOrg(user: ApiUser, orgId: string): boolean {
  return canAccessOrg(user, orgId)
}

async function actorCanReadCrmRecord(
  user: ApiUser,
  orgId: string,
  type: 'contact' | 'company' | 'deal' | 'invoice' | 'quote',
  id: string,
  data: RawDoc,
): Promise<boolean> {
  const ctx = await resolveBillingCrmAuthContext(user, orgId)
  if (isCrmPrivilegedActor(ctx)) return true
  const record = { id, ...data, orgId: data.orgId ?? orgId } as AssignableCrmRecord
  if (type === 'company') return crmActorCanReadCompanyRecord(ctx, id, record)
  if (type === 'invoice' || type === 'quote') return crmActorCanReadBillingRecord(ctx, record)
  const companyIds = new Set(crmRecordCompanyIds(record))
  const contactIds = new Set(crmRecordContactIds(record))
  const [companies, contacts] = await Promise.all([
    loadCompanyAssignmentMap(orgId, companyIds),
    loadContactAssignmentMap(orgId, contactIds),
  ])
  return crmActorCanReadRecord(ctx, record, { companies, contacts })
}

async function filterSearchDocsForRecordScope(
  user: ApiUser,
  orgId: string,
  type: ContextReferenceType,
  docs: FirestoreDoc[],
): Promise<FirestoreDoc[]> {
  if (type === 'project') {
    const rows = docs.map((doc) => ({ id: doc.id, ...(doc.data() ?? {}) }))
    const allowed = await filterProjectsForMemberScope(user, rows)
    const allowedIds = new Set(allowed.map((row) => row.id))
    return docs.filter((doc) => allowedIds.has(doc.id))
  }

  if (type === 'product') {
    const ctx = await resolveBillingCrmAuthContext(user, orgId)
    return canAccessModule(ctx.accessPolicy, 'crm') ? docs : []
  }

  if (type === 'calendar_event') {
    const actorEmails = await loadCalendarActorEmails(user)
    return docs.filter((doc) => {
      const data = doc.data() ?? {}
      return calendarEventVisibleToActor(
        { ...data, orgId: docOrgId(data, orgId) } as unknown as CalendarEvent,
        user,
        actorEmails,
      )
    })
  }

  if (type !== 'contact' && type !== 'company' && type !== 'deal' && type !== 'invoice' && type !== 'quote') {
    return docs
  }

  const ctx = await resolveBillingCrmAuthContext(user, orgId)
  if (isCrmPrivilegedActor(ctx)) return docs

  const rows = docs.map((doc) => ({ id: doc.id, ...(doc.data() ?? {}), orgId: (doc.data() ?? {}).orgId ?? orgId }) as AssignableCrmRecord)

  if (type === 'invoice' || type === 'quote') {
    const recipientQuoteIds = type === 'quote'
      ? new Set(rows.filter((row) => {
          const raw = row as RawDoc
          const sourceOrg = clean(raw.sourceOrgId) || clean(raw.orgId)
          const recipients = [clean(raw.recipientOrgId), clean(raw.targetOrgId)]
          return sourceOrg !== orgId && recipients.includes(orgId)
        }).map((row) => row.id).filter(Boolean))
      : new Set<string>()
    const senderRows = rows.filter((row) => !row.id || !recipientQuoteIds.has(row.id))
    const allowed = await filterBillingRecordsForCrmActor(ctx, senderRows)
    const allowedIds = new Set(allowed.map((row) => row.id).filter(Boolean))
    for (const id of recipientQuoteIds) allowedIds.add(id)
    return docs.filter((doc) => allowedIds.has(doc.id))
  }

  if (type === 'company') {
    const allowed = filterCrmRowsForActor(ctx, rows)
    const allowedIds = new Set(allowed.map((row) => row.id).filter(Boolean))
    // Companies readable via assigned contacts still need crmActorCanReadCompanyRecord.
    const maybeHidden = docs.filter((doc) => !allowedIds.has(doc.id))
    const recovered: FirestoreDoc[] = []
    for (const doc of maybeHidden) {
      const data = doc.data() ?? {}
      if (await crmActorCanReadCompanyRecord(ctx, doc.id, { id: doc.id, ...data } as AssignableCrmRecord)) {
        recovered.push(doc)
      }
    }
    return [...docs.filter((doc) => allowedIds.has(doc.id)), ...recovered]
  }

  const companyIds = new Set<string>()
  const contactIds = new Set<string>()
  for (const row of rows) {
    for (const id of crmRecordCompanyIds(row)) companyIds.add(id)
    for (const id of crmRecordContactIds(row)) contactIds.add(id)
  }
  const [companies, contacts] = await Promise.all([
    loadCompanyAssignmentMap(orgId, companyIds),
    loadContactAssignmentMap(orgId, contactIds),
  ])
  const allowed = filterCrmRowsForActor(ctx, rows, { companies, contacts })
  const allowedIds = new Set(allowed.map((row) => row.id).filter(Boolean))
  return docs.filter((doc) => allowedIds.has(doc.id))
}

function isDeleted(data: RawDoc): boolean {
  return data.deleted === true || data.archived === true
}

function calendarEventHref(id: string, data: RawDoc): string {
  const eventParam = `event=${encodeURIComponent(id)}`
  const orgId = docOrgId(data)
  const orgParam = orgId ? `&orgId=${encodeURIComponent(orgId)}` : ''
  const related = data.relatedTo && typeof data.relatedTo === 'object' && !Array.isArray(data.relatedTo)
    ? data.relatedTo as RawDoc
    : {}
  const relatedType = clean(related.type)
  const relatedId = clean(related.id)
  if (relatedType === 'contact' && relatedId) return `/portal/contacts/${encodeURIComponent(relatedId)}?${eventParam}${orgParam}`
  if (relatedType === 'deal' && relatedId) return `/portal/deals/${encodeURIComponent(relatedId)}?${eventParam}${orgParam}`
  if (relatedType === 'project' && relatedId) return `/portal/projects/${encodeURIComponent(relatedId)}?${eventParam}${orgParam}`
  return `/portal/dashboard?${eventParam}${orgParam}`
}

function mailboxMessageHref(id: string, data: RawDoc, user?: ApiUser): string {
  const folder = clean(data.folder, 20)
  const params = new URLSearchParams()
  if (folder) params.set('folder', folder)
  params.set('messageId', id)
  const orgId = docOrgId(data)
  if (user?.role === 'client' && orgId) params.set('orgId', orgId)
  const base = user?.role === 'client' ? '/portal/email' : '/admin/email/mailbox'
  return `${base}?${params.toString()}`
}

function href(type: ContextReferenceType, id: string, data: RawDoc, seedHref?: string, user?: ApiUser): string {
  if (seedHref) return seedHref
  const slug = clean(data.orgSlug) || clean(data.slug)
  switch (type) {
    case 'studio':
    case 'studio_artifact':
      return ''
    case 'project':
      return slug ? `/admin/org/${slug}/projects/${id}` : `/admin/projects/${id}`
    case 'task': {
      const projectId = clean(data.projectId)
      return projectId ? `/admin/projects/${projectId}?taskId=${encodeURIComponent(id)}` : `/admin/tasks/${id}`
    }
    case 'contact':
      return `/admin/crm/contacts/${id}`
    case 'company':
      return `/admin/crm/companies/${id}`
    case 'product':
      return '/portal/settings/products'
    case 'document':
      return `/admin/documents/${id}`
    case 'research':
      return `/admin/research/${id}`
    case 'social':
      return `/admin/social/history/${id}`
    case 'campaign':
      return `/admin/campaigns/${id}`
    case 'email':
      return mailboxMessageHref(id, data, user)
    case 'support':
      return `/admin/support/${id}`
    case 'deal':
      return `/admin/crm/pipeline?dealId=${encodeURIComponent(id)}`
    case 'invoice':
      return `/admin/invoices/${id}`
    case 'quote':
      return `/admin/quotes/${id}`
    case 'property':
      return `/admin/properties/${id}`
    case 'seo_sprint':
      return `/admin/seo/sprints/${id}`
    case 'workspace_folder':
      return `/admin/workspace/folders/${id}`
    case 'workspace_artifact':
      return `/admin/workspace/artifacts/${id}`
    case 'workspace_connection':
      return `/admin/workspace/connections/${id}`
    case 'workspace_broker_job':
      return `/admin/workspace/broker/jobs/${id}`
    case 'file':
      return `/admin/files/${id}`
    case 'report':
      return `/admin/reports/${id}`
    case 'calendar_event':
      return calendarEventHref(id, data)
  }
}

function makeRef(args: {
  type: ContextReferenceType
  id: string
  orgId: string
  label: string
  origin: ContextReferenceOrigin
  summary?: string
  href?: string
  metadata?: Record<string, unknown>
}): ContextReference {
  return normalizeContextReference({
    type: args.type,
    id: args.id,
    orgId: args.orgId,
    label: args.label || args.id,
    origin: args.origin,
    ...(args.href ? { href: args.href } : {}),
    ...(args.summary ? { summary: args.summary } : {}),
    ...(args.metadata ? { metadata: args.metadata } : {}),
    resolvedAt: new Date().toISOString(),
  })
}

async function getDoc(collection: string, id: string): Promise<FirestoreDoc | null> {
  const snap = await adminDb.collection(collection).doc(id).get()
  if (!snap.exists) return null
  return snap as FirestoreDoc
}

async function queryByOrg(collection: string, orgId: string, limit: number) {
  const snap = await adminDb
    .collection(collection)
    .where('orgId', '==', orgId)
    .limit(Math.max(limit, 30))
    .get()
  return snap.docs as FirestoreDoc[]
}

async function queryBillingByOrg(collection: 'invoices' | 'quotes', orgId: string, limit: number) {
  const fields = ['orgId', 'sourceOrgId', 'recipientOrgId', 'targetOrgId'] as const
  const batches = await Promise.all(fields.map(async (field) => {
    const snap = await adminDb
      .collection(collection)
      .where(field, '==', orgId)
      .limit(Math.max(limit, 30))
      .get()
    return snap.docs as FirestoreDoc[]
  }))
  const byId = new Map<string, FirestoreDoc>()
  for (const doc of batches.flat()) byId.set(doc.id, doc)
  return Array.from(byId.values()).slice(0, Math.max(limit, 30))
}

async function queryDocumentsByOrg(orgId: string, limit: number) {
  const collection = adminDb.collection(CLIENT_DOCUMENTS_COLLECTION)
  const queryLimit = Math.max(limit, 30)
  const batches = await Promise.all([
    collection.where('orgId', '==', orgId).limit(queryLimit).get(),
    collection.where('linked.clientOrgId', '==', orgId).limit(queryLimit).get(),
    collection.where('linked.clientOrgIds', 'array-contains', orgId).limit(queryLimit).get(),
  ])
  const byId = new Map<string, FirestoreDoc>()
  for (const doc of batches.flatMap((batch) => batch.docs as FirestoreDoc[])) byId.set(doc.id, doc)
  return Array.from(byId.values()).slice(0, queryLimit)
}

async function queryStudioByOrg(collection: string, orgId: string, limit: number) {
  const snap = await adminDb.collection(collection).where('orgId', '==', orgId).limit(limit).get()
  return snap.docs as FirestoreDoc[]
}

function matchesQuery(data: RawDoc, q: string): boolean {
  if (!q) return true
  const haystack = [
    data.name,
    data.title,
    data.subject,
    data.invoiceNumber,
    data.quoteNumber,
    data.fileName,
    data.originalName,
    data.displayName,
    data.fullName,
    data.firstName,
    data.lastName,
    data.givenName,
    data.familyName,
    data.surname,
    data.operation,
    nestedClean(data.input, 'title'),
    nestedClean(data.google, 'url'),
    data.email,
    data.company,
    data.companyName,
    data.jobTitle,
    data.phone,
    data.website,
    data.sku,
    data.description,
    data.summary,
    data.notes,
    data.body,
    data.content,
  ].join(' ').toLowerCase()
  return haystack.includes(q.toLowerCase())
}

async function resolveProject(input: ResolverInput): Promise<ContextReference | null> {
  const access = await getProjectForUser(input.seed.id, input.user)
  if (!access.ok) return null
  const data = access.doc.data() ?? {}
  const orgId = docOrgId(data, input.seed.orgId ?? input.defaultOrgId)
  if (!orgId || !sameOrg(data, expectedOrgId(input.seed, input.defaultOrgId)) || !canUseOrg(input.user, orgId)) return null
  return makeRef({
    type: 'project',
    id: access.doc.id,
    orgId,
    label: clean(data.name) || clean(data.title) || input.seed.label || access.doc.id,
    origin: origin(input.seed),
    href: href('project', access.doc.id, data, input.seed.href),
    summary: compactSummary([
      `status: ${clean(data.status)}`,
      data.description,
      data.ownerName ? `owner: ${clean(data.ownerName)}` : '',
    ]),
  })
}

async function resolveTask(input: ResolverInput): Promise<ContextReference | null> {
  let projectId = clean(input.seed.metadata?.projectId)
  let doc: FirestoreDoc | null = null
  if (projectId) {
    const projectAccess = await getProjectForUser(projectId, input.user)
    if (!projectAccess.ok) return null
    const snap = await adminDb.collection('projects').doc(projectId).collection('tasks').doc(input.seed.id).get()
    doc = snap.exists ? (snap as FirestoreDoc) : null
    // A project-scoped reference is an identity, not a search hint. Falling
    // back to the global task collection here could resolve an unrelated
    // same-id task under this project's access policy.
    if (!doc) return null
  }
  if (!doc) doc = await getDoc('tasks', input.seed.id)
  if (!doc) return null
  const data = doc.data() ?? {}
  projectId = projectId || clean(data.projectId)

  // A direct task lookup must apply the same project-item visibility policy as
  // the Project canvas.  Organisation membership alone is not sufficient for
  // internal, restricted, or private project tasks.
  let projectOrgId = ''
  if (projectId) {
    const projectAccess = await getProjectForUser(projectId, input.user)
    if (!projectAccess.ok) return null
    const projectData = projectAccess.doc.data() ?? {}
    projectOrgId = docOrgId(projectData)
    if (filterProjectItemsForAccess([{ ...data, id: doc.id }], { projectAccess: projectAccess.projectAccess, user: input.user }).length === 0) return null
  } else if (input.user.role === 'client' && (
    data.internalOnly === true || ['internal', 'restricted', 'private'].includes(clean(data.visibility).toLowerCase())
  )) {
    return null
  }

  if (isDeleted(data)) return null
  const orgId = docOrgId(data, projectOrgId || input.seed.orgId || input.defaultOrgId)
  const expected = expectedOrgId(input.seed, input.defaultOrgId)
  if (!orgId || (expected && orgId !== expected) || !canUseOrg(input.user, orgId)) return null
  return makeRef({
    type: 'task',
    id: doc.id,
    orgId,
    label: clean(data.title) || clean(data.name) || input.seed.label || doc.id,
    origin: origin(input.seed),
    href: href('task', doc.id, data, input.seed.href),
    summary: compactSummary([
      data.status ? `status: ${clean(data.status)}` : '',
      data.priority ? `priority: ${clean(data.priority)}` : '',
      data.assigneeName ? `assignee: ${clean(data.assigneeName)}` : '',
      data.description,
    ]),
    metadata: {
      ...(projectId ? { projectId } : {}),
      presentation: {
        metrics: [
          ...(clean(data.priority) ? [{ id: 'priority', label: 'Priority', value: clean(data.priority) }] : []),
          ...(clean(data.agentStatus) ? [{ id: 'agent-status', label: 'Agent status', value: clean(data.agentStatus) }] : []),
          ...(clean(data.reviewStatus) ? [{ id: 'review-status', label: 'Review', value: clean(data.reviewStatus) }] : []),
        ],
        activity: [
          presentationActivity('task-completed', 'verified_complete', 'Task completed', data.agentOutput && typeof data.agentOutput === 'object' ? (data.agentOutput as RawDoc).completedAt : data.completedAt),
          presentationActivity('task-updated', clean(data.agentStatus).toLowerCase() === 'blocked' ? 'blocked' : 'running', clean(data.agentStatus).toLowerCase() === 'blocked' ? 'Task blocked' : 'Task updated', data.updatedAt),
          presentationActivity('task-created', 'pickup', 'Task created', data.createdAt),
        ].filter(Boolean),
      },
    },
  })
}

async function resolveCrm(type: 'contact' | 'company', input: ResolverInput): Promise<ContextReference | null> {
  const collection = type === 'contact' ? 'contacts' : 'companies'
  const doc = await getDoc(collection, input.seed.id)
  if (!doc) return null
  const data = doc.data() ?? {}
  const orgId = docOrgId(data, input.seed.orgId ?? input.defaultOrgId)
  if (isDeleted(data) || !orgId || !sameOrg(data, expectedOrgId(input.seed, input.defaultOrgId)) || !canUseOrg(input.user, orgId)) return null
  if (!(await actorCanReadCrmRecord(input.user, orgId, type, doc.id, data))) return null
  const relationshipSeeds = type === 'contact'
    ? [
        relationSeed('company', data.companyId, 'Company'),
        ...(Array.isArray(data.companyLinks) ? data.companyLinks.map((link) => relationSeed('company', link && typeof link === 'object' ? (link as RawDoc).companyId : undefined, 'Company')) : []),
      ].filter(Boolean)
    : [relationSeed('company', data.parentCompanyId, 'Parent company')].filter(Boolean)
  const activity = type === 'contact'
    ? [
        presentationActivity('contact-replied', 'verified_complete', 'Reply received', data.lastRepliedAt),
        presentationActivity('contact-contacted', 'running', 'Contacted', data.lastContactedAt),
        presentationActivity('contact-updated', 'running', 'Contact updated', data.updatedAt),
        presentationActivity('contact-created', 'pickup', 'Contact added', data.createdAt),
      ].filter(Boolean)
    : [
        presentationActivity('company-updated', 'running', 'Company updated', data.updatedAt),
        presentationActivity('company-created', 'pickup', 'Company added', data.createdAt),
      ].filter(Boolean)
  return makeRef({
    type,
    id: doc.id,
    orgId,
    label: type === 'contact'
      ? contactDisplayName(data) || input.seed.label || doc.id
      : clean(data.name) || clean(data.companyName) || clean(data.displayName) || input.seed.label || doc.id,
    origin: origin(input.seed),
    href: href(type, doc.id, data, input.seed.href),
    summary: compactSummary([
      data.email,
      data.phone,
      data.company,
      data.companyName,
      data.jobTitle,
      data.website,
      data.status ? `status: ${clean(data.status)}` : '',
      data.notes,
    ]),
    metadata: {
      ...(relationshipSeeds.length > 0 ? { relationshipSeeds } : {}),
      presentation: {
        metrics: type === 'contact'
          ? [
              ...(clean(data.stage) ? [{ id: 'stage', label: 'Stage', value: clean(data.stage) }] : []),
              ...(clean(data.type) ? [{ id: 'type', label: 'Type', value: clean(data.type) }] : []),
              ...(typeof data.leadScore === 'number' && Number.isFinite(data.leadScore) ? [{ id: 'lead-score', label: 'Lead score', value: data.leadScore }] : []),
            ]
          : [
              ...(clean(data.lifecycleStage) ? [{ id: 'lifecycle', label: 'Lifecycle', value: clean(data.lifecycleStage) }] : []),
              ...(clean(data.industry) ? [{ id: 'industry', label: 'Industry', value: clean(data.industry) }] : []),
              ...(typeof data.healthScore === 'number' && Number.isFinite(data.healthScore) ? [{ id: 'health-score', label: 'Health score', value: data.healthScore }] : []),
            ],
        activity,
      },
    },
  })
}

function productPriceSummary(data: RawDoc): string {
  const price = clean(data.unitPrice)
  if (!price) return ''
  const currency = clean(data.currency)
  const unit = clean(data.unit)
  return `${currency ? `${currency} ` : ''}${price}${unit ? ` / ${unit}` : ''}`
}

async function resolveProduct(input: ResolverInput): Promise<ContextReference | null> {
  const doc = await getDoc('products', input.seed.id)
  if (!doc) return null
  const data = doc.data() ?? {}
  const orgId = docOrgId(data, input.seed.orgId ?? input.defaultOrgId)
  if (isDeleted(data) || !orgId || !sameOrg(data, expectedOrgId(input.seed, input.defaultOrgId)) || !canUseOrg(input.user, orgId)) return null
  const ctx = await resolveBillingCrmAuthContext(input.user, orgId)
  if (!canAccessModule(ctx.accessPolicy, 'crm')) return null
  return makeRef({
    type: 'product',
    id: doc.id,
    orgId,
    label: clean(data.name) || input.seed.label || doc.id,
    origin: origin(input.seed),
    href: `/portal/settings/products?product=${encodeURIComponent(doc.id)}&orgId=${encodeURIComponent(orgId)}`,
    summary: compactSummary([
      productPriceSummary(data),
      data.sku ? `sku: ${clean(data.sku)}` : '',
      data.active === false ? 'inactive' : '',
      data.description,
    ]),
  })
}

async function resolveCalendarEvent(input: ResolverInput): Promise<ContextReference | null> {
  const doc = await getDoc('calendar_events', input.seed.id)
  if (!doc) return null
  const data = doc.data() ?? {}
  const orgId = docOrgId(data, input.seed.orgId ?? input.defaultOrgId)
  if (
    isDeleted(data)
    || !orgId
    || !sameOrg(data, expectedOrgId(input.seed, input.defaultOrgId))
    || !canUseOrg(input.user, orgId)
  ) return null
  const actorEmails = await loadCalendarActorEmails(input.user)
  if (!calendarEventVisibleToActor({ ...data, orgId } as unknown as CalendarEvent, input.user, actorEmails)) return null
  return makeRef({
    type: 'calendar_event',
    id: doc.id,
    orgId,
    label: clean(data.title) || input.seed.label || doc.id,
    origin: origin(input.seed),
    href: calendarEventHref(doc.id, { ...data, orgId }),
    summary: compactSummary([
      data.startAt,
      data.endAt,
      data.timezone,
      data.location,
      data.description,
    ]),
  })
}

async function resolveDocument(input: ResolverInput): Promise<ContextReference | null> {
  const access = await getAccessibleClientDocument(input.seed.id, input.user)
  if (!access.ok) return null
  const doc = access.document
  const expectedOrg = expectedOrgId(input.seed, input.defaultOrgId)
  const holderOrgId = clean(doc.orgId)
  const linkedClientOrgIds = explicitLinkedClientOrgIds(doc)
  const expectedIsHolder = Boolean(expectedOrg && expectedOrg === holderOrgId)
  const expectedIsVisibleClient = Boolean(
    expectedOrg
    && linkedClientOrgIds.includes(expectedOrg)
    && isClientVisibleToOrg(doc, expectedOrg),
  )
  if (expectedOrg && !expectedIsHolder && !expectedIsVisibleClient) return null
  const orgId = expectedOrg || holderOrgId
  if (!orgId || !canUseOrg(input.user, orgId)) return null
  const linked = doc.linked ?? {}
  const relationshipSeeds: Array<{ type: ContextReferenceType; id: string; relation: string }> = []
  const addRelationshipSeeds = (type: ContextReferenceType, relation: string, ids: Array<string | undefined>) => {
    for (const id of ids) {
      const cleanId = clean(id)
      if (cleanId && !relationshipSeeds.some((item) => item.type === type && item.id === cleanId)) relationshipSeeds.push({ type, id: cleanId, relation })
      if (relationshipSeeds.length >= 12) return
    }
  }
  addRelationshipSeeds('project', 'Project', [linked.projectId, ...(linked.projectIds ?? [])])
  addRelationshipSeeds('company', 'Company', [linked.companyId, linked.sourceCompanyId, ...(linked.companyIds ?? [])])
  addRelationshipSeeds('contact', 'Contact', [linked.contactId, ...(linked.contactIds ?? [])])
  addRelationshipSeeds('campaign', 'Campaign', [linked.campaignId])
  addRelationshipSeeds('deal', 'Deal', [linked.dealId, ...(linked.dealIds ?? [])])
  addRelationshipSeeds('research', 'Research', linked.researchItemIds ?? [])
  addRelationshipSeeds('invoice', 'Invoice', [linked.invoiceId])
  addRelationshipSeeds('report', 'Report', [linked.reportId])
  addRelationshipSeeds('seo_sprint', 'SEO sprint', [linked.seoSprintId])
  addRelationshipSeeds('task', 'Approval task', [linked.approvalGateTaskId])
  return makeRef({
    type: 'document',
    id: doc.id,
    orgId,
    label: clean(doc.title) || input.seed.label || doc.id,
    origin: origin(input.seed),
    href: `/portal/documents/${encodeURIComponent(doc.id)}?orgId=${encodeURIComponent(orgId)}`,
    summary: compactSummary([
      `type: ${clean(doc.type)}`,
      `status: ${clean(doc.status)}`,
      doc.approvalMode ? `approval: ${clean(doc.approvalMode)}` : '',
    ]),
    metadata: relationshipSeeds.length > 0 ? { relationshipSeeds } : undefined,
  })
}

async function resolveResearch(input: ResolverInput): Promise<ContextReference | null> {
  const item = await getResearchItem(input.seed.id, expectedOrgId(input.seed, input.defaultOrgId))
  if (!item) return null
  if (input.user.role === 'client' && item.visibility !== 'client_visible') return null
  if (!canUseOrg(input.user, item.orgId)) return null
  return makeRef({
    type: 'research',
    id: item.id,
    orgId: item.orgId,
    label: clean(item.title) || input.seed.label || item.id,
    origin: origin(input.seed),
    href: href('research', item.id, item as unknown as RawDoc, input.seed.href),
    summary: compactSummary([
      `kind: ${item.kind}`,
      `status: ${item.status}`,
      `visibility: ${item.visibility}`,
      item.summary,
      item.findings?.[0]?.title,
      item.recommendations?.[0]?.title,
    ]),
  })
}

async function resolveGeneric(
  type: Exclude<ContextReferenceType, 'project' | 'task' | 'contact' | 'company' | 'product' | 'document' | 'research' | 'support'>,
  input: ResolverInput,
): Promise<ContextReference | null> {
  const collection = COLLECTION_BY_TYPE[type]
  if (!collection) return null
  const doc = await getDoc(collection, input.seed.id)
  if (!doc) return null
  const data = doc.data() ?? {}
  const expectedOrg = expectedOrgId(input.seed, input.defaultOrgId)
  // Billing records can belong to a sender organisation while being operated
  // from the recipient organisation. Preserve the explicitly authorised
  // conversation perspective instead of collapsing every record to data.orgId.
  const billingPerspectiveOrg = (type === 'invoice' || type === 'quote')
    && expectedOrg
    && sameOrg(data, expectedOrg)
    ? expectedOrg
    : ''
  const orgId = billingPerspectiveOrg || docOrgId(data, input.seed.orgId ?? input.defaultOrgId)
  if (isDeleted(data) || !orgId || !sameOrg(data, expectedOrg) || !canUseOrg(input.user, orgId)) return null
  if (type === 'email' && clean(data.uid) !== ownerUidFrom(input.user)) return null
  if ((type === 'workspace_connection' || type === 'workspace_broker_job') && input.user.role === 'client') return null
  if (type === 'workspace_artifact' && !canReadWorkspaceArtifact({
    orgId,
    visibility: clean(data.visibility) as never,
    lifecycleStatus: clean(data.lifecycleStatus) as never,
    permissions: data.permissions && typeof data.permissions === 'object' && !Array.isArray(data.permissions)
      ? data.permissions as never
      : { allowedAgentIds: [] } as never,
  }, input.user)) return null
  const quoteRecipientPerspective = type === 'quote'
    && orgId !== (clean(data.sourceOrgId) || clean(data.orgId))
    && [clean(data.recipientOrgId), clean(data.targetOrgId)].includes(orgId)
  if ((type === 'deal' || type === 'invoice' || (type === 'quote' && !quoteRecipientPerspective)) &&
    !(await actorCanReadCrmRecord(input.user, orgId, type, doc.id, data))) {
    return null
  }
  const label = clean(data.name) ||
    clean(data.title) ||
    clean(data.subject) ||
    clean(data.invoiceNumber) ||
    clean(data.quoteNumber) ||
    clean(data.fileName) ||
    clean(data.originalName) ||
    clean(data.displayName) ||
    clean(data.operation) ||
    nestedClean(data.input, 'title') ||
    clean(data.content, 80) ||
    input.seed.label ||
    doc.id
  return makeRef({
    type,
    id: doc.id,
    orgId,
    label,
    origin: origin(input.seed),
    href: href(type, doc.id, data, input.seed.href, input.user),
    summary: compactSummary([
      data.status ? `status: ${clean(data.status)}` : '',
      data.lifecycleStatus ? `lifecycle: ${clean(data.lifecycleStatus)}` : '',
      data.stage ? `stage: ${clean(data.stage)}` : '',
      data.total ? `total: ${clean(data.currency)} ${clean(data.total)}` : '',
      data.value ? `value: ${clean(data.currency)} ${clean(data.value)}` : '',
      data.artifactType ? `artifact: ${clean(data.artifactType)}` : '',
      data.connectionType ? `connection: ${clean(data.connectionType)}` : '',
      data.tokenStatus ? `token: ${clean(data.tokenStatus)}` : '',
      data.requiredCapability ? `capability: ${clean(data.requiredCapability)}` : '',
      type === 'social' ? data.platform : '',
      type === 'email' ? data.fromEmail || data.from : '',
      type === 'email' ? data.snippet || data.body : '',
      type === 'campaign' ? data.description : '',
      data.clientName,
      data.contactName,
      data.address,
      data.description,
      data.summary,
      data.notes,
      data.content,
      nestedClean(data.google, 'url', 500),
      nestedClean(data.input, 'title'),
    ]),
  })
}

async function resolveSupport(input: ResolverInput): Promise<ContextReference | null> {
  const ticket = await getSupportTicket(input.seed.id)
  if (!ticket) return null
  const orgId = clean(ticket.orgId) || input.seed.orgId || input.defaultOrgId || ''
  if (!orgId || orgId !== expectedOrgId(input.seed, input.defaultOrgId) || !canUseOrg(input.user, orgId)) return null
  if (input.user.role === 'client' && clean(ticket.createdBy) !== input.user.uid) return null
  const relationshipSeeds: Array<{ type: ContextReferenceType; id: string; relation: string }> = []
  const addRelationshipSeeds = (type: ContextReferenceType, relation: string, ids: Array<string | null | undefined>) => {
    for (const id of ids) {
      const cleanId = clean(id)
      if (cleanId && !relationshipSeeds.some((item) => item.type === type && item.id === cleanId)) {
        relationshipSeeds.push({ type, id: cleanId, relation })
      }
      if (relationshipSeeds.length >= 12) return
    }
  }
  addRelationshipSeeds('project', 'Project', [ticket.projectId, ...(ticket.projectIds ?? [])])
  addRelationshipSeeds('company', 'Company', [ticket.companyId, ...(ticket.companyIds ?? [])])
  addRelationshipSeeds('contact', 'Contact', [ticket.contactId, ...(ticket.contactIds ?? [])])
  addRelationshipSeeds('deal', 'Deal', [ticket.dealId, ...(ticket.dealIds ?? [])])
  addRelationshipSeeds('research', 'Research', ticket.researchItemIds ?? [])
  addRelationshipSeeds('social', 'Social post', ticket.socialPostIds ?? [])
  addRelationshipSeeds('email', 'Email thread', ticket.emailThreadIds ?? [])
  return makeRef({
    type: 'support',
    id: ticket.id,
    orgId,
    label: clean(ticket.subject) || input.seed.label || ticket.id,
    origin: origin(input.seed),
    href: input.user.role === 'client'
      ? `/portal/dashboard?support=open&ticket=${encodeURIComponent(ticket.id)}&orgId=${encodeURIComponent(orgId)}`
      : `/admin/support?ticket=${encodeURIComponent(ticket.id)}`,
    summary: compactSummary([
      `status: ${clean(ticket.status)}`,
      `priority: ${clean(ticket.priority)}`,
      ticket.description,
    ]),
    metadata: relationshipSeeds.length > 0 ? { relationshipSeeds } : undefined,
  })
}

async function loadStudioOrg(input: ResolverInput, orgId: string, definition: StudioDefinition) {
  const expected = expectedOrgId(input.seed, input.defaultOrgId)
  if (!orgId || (expected && orgId !== expected) || (input.defaultOrgId && input.seed.orgId && input.seed.orgId !== input.defaultOrgId)) return null
  const orgDoc = await getDoc('organizations', orgId)
  if (!orgDoc) return null
  const orgData = orgDoc.data() ?? {}
  if (isDeleted(orgData) || !await canUseStudio(input.user, orgId, definition, orgData)) return null
  return orgData
}

async function resolveStudio(input: ResolverInput): Promise<ContextReference | null> {
  const parts = input.seed.id.split(':')
  if (parts.length !== 2 || parts.some((part) => !part)) return null
  const studioKind = studioKindFrom(parts[0])
  if (!studioKind) return null
  const definition = STUDIO_DEFINITIONS[studioKind]
  const orgId = parts[1]
  const orgData = await loadStudioOrg(input, orgId, definition)
  if (!orgData) return null
  const canonicalRoute = input.user.role === 'client' ? definition.route : definition.adminRoute?.(orgData) ?? definition.route
  return makeRef({
    type: 'studio', id: `${studioKind}:${orgId}`, orgId, label: definition.label,
    origin: origin(input.seed), href: canonicalRoute,
  })
}

async function resolveStudioArtifact(input: ResolverInput): Promise<ContextReference | null> {
  const marketingIdentity = parseMarketingCanvasContextId(input.seed.id)
  const canonicalIdentity = parseStudioArtifactContextId(input.seed.id)
  const parts = input.seed.id.split(':')
  if (!marketingIdentity && !canonicalIdentity && (parts.length !== 3 || parts.some((part) => !part))) return null
  const studioKind = marketingIdentity ? 'marketing_studio' : canonicalIdentity?.studioKind ?? studioKindFrom(parts[0])
  if (!studioKind) return null
  const definition = STUDIO_DEFINITIONS[studioKind]
  const resourceType = marketingIdentity ? 'canvas' : canonicalIdentity?.resourceType ?? parts[1]
  let resourceId = ''
  if (marketingIdentity) resourceId = marketingIdentity.canvasId
  else if (canonicalIdentity) resourceId = canonicalIdentity.resourceId
  else try { resourceId = decodeURIComponent(parts[2]) } catch { return null }
  if (!resourceId) return null
  const resource = definition.resources[resourceType]
  if (!resource?.exactHref) return null
  const knownOrgId = canonicalIdentity?.orgId ?? marketingIdentity?.orgId ?? expectedOrgId(input.seed, input.defaultOrgId)
  const preloadedOrgData = knownOrgId ? await loadStudioOrg(input, knownOrgId, definition) : null
  if (knownOrgId && !preloadedOrgData) return null
  const record = await getDoc(resource.collection, resourceId)
  if (!record) return null
  const data = record.data() ?? {}
  const orgId = docOrgId(data)
  const lifecycle = clean(data.lifecycleStatus || data.status).toLowerCase()
  const encodedOrgId = marketingIdentity?.orgId ?? canonicalIdentity?.orgId
  if (!orgId || (knownOrgId && knownOrgId !== orgId) || (encodedOrgId && encodedOrgId !== orgId) || isDeleted(data) || lifecycle === 'deleted' || (lifecycle === 'archived' && studioKind !== 'video_editor')) return null
  const orgData = preloadedOrgData ?? await loadStudioOrg(input, orgId, definition)
  if (!orgData) return null
  const canonicalRoute = input.user.role === 'client' ? definition.route : definition.adminRoute?.(orgData) ?? definition.route
  const rawHref = resource.exactHref(record.id, canonicalRoute, data)
  const exactHref = studioKind === 'marketing_studio' ? `${rawHref}&orgId=${encodeURIComponent(orgId)}` : rawHref
  if (/(?:\?|&)[^=]+=(&|$)/.test(exactHref) || exactHref.startsWith(`${canonicalRoute}/?`)) return null
  const label = clean(data.title) || clean(data.name) || clean(data.label) || `${definition.label} ${resourceType.replace(/_/g, ' ')}`
  return makeRef({
    type: 'studio_artifact', id: studioArtifactReferenceId(studioKind, orgId, resourceType, record.id), orgId, label,
    origin: origin(input.seed), href: exactHref,
    summary: resourceType.replace(/_/g, ' '),
  })
}

async function resolveOne(
  seed: ContextReferenceSeed,
  user: ApiUser,
  defaultOrgId?: string,
  conversationId?: string,
): Promise<ContextReference | null> {
  if (isWorkbenchPathContextSeed(seed)) {
    return resolveWorkbenchPathContextReference(seed, user, defaultOrgId, conversationId)
  }
  switch (seed.type) {
    case 'project':
      return resolveProject({ seed, user, defaultOrgId })
    case 'task':
      return resolveTask({ seed, user, defaultOrgId })
    case 'contact':
      return resolveCrm('contact', { seed, user, defaultOrgId })
    case 'company':
      return resolveCrm('company', { seed, user, defaultOrgId })
    case 'product':
      return resolveProduct({ seed, user, defaultOrgId })
    case 'document':
      return resolveDocument({ seed, user, defaultOrgId })
    case 'research':
      return resolveResearch({ seed, user, defaultOrgId })
    case 'social':
    case 'campaign':
    case 'email':
    case 'deal':
    case 'invoice':
    case 'quote':
    case 'property':
    case 'seo_sprint':
    case 'workspace_folder':
    case 'workspace_artifact':
    case 'workspace_connection':
    case 'workspace_broker_job':
    case 'file':
    case 'report':
      return resolveGeneric(seed.type, { seed, user, defaultOrgId })
    case 'calendar_event':
      return resolveCalendarEvent({ seed, user, defaultOrgId })
    case 'support':
      return resolveSupport({ seed, user, defaultOrgId })
    case 'studio':
      return resolveStudio({ seed, user, defaultOrgId })
    case 'studio_artifact':
      return resolveStudioArtifact({ seed, user, defaultOrgId })
  }
}

export async function resolveContextReferences(
  refs: unknown,
  user: ApiUser,
  defaultOrgId?: string,
  options: { conversationId?: string } = {},
): Promise<ContextReference[]> {
  const seeds = sanitizeContextReferenceSeeds(refs)
  const resolved: ContextReference[] = []
  const seen = new Set<string>()
  for (const seed of seeds) {
    const ref = await resolveOne(seed, user, defaultOrgId, options.conversationId)
    if (!ref) continue
    const key = contextReferenceKey(ref)
    if (seen.has(key)) continue
    seen.add(key)
    resolved.push(ref)
    if (resolved.length >= MAX_CONTEXT_REFS) break
  }
  return resolved
}

function refFromSearchRow(
  type: ContextReferenceType,
  id: string,
  data: RawDoc,
  user: ApiUser,
  metadata?: Record<string, unknown>,
): ContextReference | null {
  if (isDeleted(data)) return null
  const orgId = docOrgId(data)
  if (!orgId || !canUseOrg(user, orgId)) return null
  if (type === 'research' && user.role === 'client' && clean(data.visibility) !== 'client_visible') return null
  if (type === 'email' && clean(data.uid) !== ownerUidFrom(user)) return null
  if (type === 'support' && user.role === 'client' && clean(data.createdBy) !== user.uid) return null
  if ((type === 'workspace_connection' || type === 'workspace_broker_job') && user.role === 'client') return null
  if (type === 'workspace_artifact' && !canReadWorkspaceArtifact({
    orgId,
    visibility: clean(data.visibility) as never,
    lifecycleStatus: clean(data.lifecycleStatus) as never,
    permissions: data.permissions && typeof data.permissions === 'object' && !Array.isArray(data.permissions)
      ? data.permissions as never
      : { allowedAgentIds: [] } as never,
  }, user)) return null

  const label = type === 'contact' ? contactDisplayName(data) : ''
  const fallbackLabel = clean(data.name) ||
    clean(data.title) ||
    clean(data.subject) ||
    clean(data.invoiceNumber) ||
    clean(data.quoteNumber) ||
    clean(data.fileName) ||
    clean(data.originalName) ||
    clean(data.displayName) ||
    clean(data.operation) ||
    nestedClean(data.input, 'title') ||
    clean(data.email) ||
    clean(data.content, 80) ||
    id
  return makeRef({
    type,
    id,
    orgId,
    label: label || fallbackLabel,
    origin: 'mention',
    href: href(type, id, data, undefined, user),
    summary: compactSummary([
      type === 'product' ? productPriceSummary(data) : '',
      data.status ? `status: ${clean(data.status)}` : '',
      data.lifecycleStatus ? `lifecycle: ${clean(data.lifecycleStatus)}` : '',
      data.stage ? `stage: ${clean(data.stage)}` : '',
      data.total ? `total: ${clean(data.currency)} ${clean(data.total)}` : '',
      data.value ? `value: ${clean(data.currency)} ${clean(data.value)}` : '',
      data.artifactType ? `artifact: ${clean(data.artifactType)}` : '',
      data.connectionType ? `connection: ${clean(data.connectionType)}` : '',
      data.tokenStatus ? `token: ${clean(data.tokenStatus)}` : '',
      data.requiredCapability ? `capability: ${clean(data.requiredCapability)}` : '',
      data.clientName,
      data.contactName,
      data.address,
      data.company,
      data.companyName,
      data.jobTitle,
      data.phone,
      data.website,
      data.description,
      data.summary,
      data.notes,
      data.content,
      data.email,
      data.sku ? `sku: ${clean(data.sku)}` : '',
      nestedClean(data.google, 'url', 500),
      nestedClean(data.input, 'title'),
    ]),
    ...(metadata ? { metadata } : {}),
  })
}

function refFromSearchDoc(
  type: ContextReferenceType,
  doc: FirestoreDoc,
  user: ApiUser,
  metadata?: Record<string, unknown>,
): ContextReference | null {
  return refFromSearchRow(type, doc.id, doc.data() ?? {}, user, metadata)
}

export async function searchContextReferences(input: SearchContextReferencesInput): Promise<ContextReference[]> {
  if (!input.orgId || !canUseOrg(input.user, input.orgId)) return []
  const type = contextReferenceTypeFrom(input.type)
  if (!type) return []
  const limit = Math.min(Math.max(input.limit ?? 8, 1), MAX_CONTEXT_REFS)
  const query = clean(input.query, 120).toLowerCase()

  if ((type === 'studio' || type === 'studio_artifact') && query.length < 2) return []

  if (type === 'studio') {
    const refs = await resolveContextReferences(
      (Object.keys(STUDIO_DEFINITIONS) as StudioKind[]).map((kind) => ({ type: 'studio', id: `${kind}:${input.orgId}`, orgId: input.orgId, origin: 'mention' })),
      input.user,
      input.orgId,
    )
    return refs.filter((ref) => matchesQuery({ name: ref.label }, query)).slice(0, limit)
  }

  if (type === 'studio_artifact') {
    const sources = (Object.entries(STUDIO_DEFINITIONS) as Array<[StudioKind, StudioDefinition]>)
      .flatMap(([studioKind, definition]) => Object.entries(definition.resources).map(([resourceType, resource]) => ({ studioKind, resourceType, resource })))
      .filter((source, index, all) => all.findIndex((candidate) => candidate.resource.collection === source.resource.collection) === index)
    const orgDoc = await getDoc('organizations', input.orgId)
    if (!orgDoc) return []
    const orgData = orgDoc.data() ?? {}
    if (isDeleted(orgData)) return []
    const accessEntries = await Promise.all((Object.entries(STUDIO_DEFINITIONS) as Array<[StudioKind, StudioDefinition]>).map(async ([kind, definition]) => (
      [kind, await canUseStudio(input.user, input.orgId, definition, orgData)] as const
    )))
    const accessByStudio = new Map(accessEntries)
    const batches = await Promise.all(sources.filter((source) => accessByStudio.get(source.studioKind)).map(async (source) => ({
      source,
      docs: await queryStudioByOrg(source.resource.collection, input.orgId, 24),
    })))
    const refs: ContextReference[] = []
    for (const { source, docs } of batches) {
      const definition = STUDIO_DEFINITIONS[source.studioKind]
      const canonicalRoute = input.user.role === 'client' ? definition.route : definition.adminRoute?.(orgData) ?? definition.route
      for (const doc of docs) {
        const data = doc.data() ?? {}
        const lifecycle = clean(data.lifecycleStatus || data.status).toLowerCase()
        if (!matchesQuery(data, query) || isDeleted(data) || lifecycle === 'archived' || lifecycle === 'deleted' || docOrgId(data) !== input.orgId) continue
        const rawHref = source.resource.exactHref?.(doc.id, canonicalRoute, data)
        if (!rawHref) continue
        const exactHref = source.studioKind === 'marketing_studio' ? `${rawHref}&orgId=${encodeURIComponent(input.orgId)}` : rawHref
        refs.push(makeRef({
          type: 'studio_artifact', id: studioArtifactReferenceId(source.studioKind, input.orgId, source.resourceType, doc.id),
          orgId: input.orgId, label: clean(data.title) || clean(data.name) || clean(data.label) || `${definition.label} ${source.resourceType.replace(/_/g, ' ')}`,
          origin: 'mention', href: exactHref, summary: source.resourceType.replace(/_/g, ' '),
        }))
      }
    }
    return refs.slice(0, limit)
  }

  if (type === 'task' && input.projectId) {
    const projectAccess = await getProjectForUser(input.projectId, input.user)
    if (!projectAccess.ok) return []
    const projectData = projectAccess.doc.data() ?? {}
    const projectOrgId = docOrgId(projectData, input.orgId)
    if (projectOrgId !== input.orgId || !canUseOrg(input.user, projectOrgId)) return []
    const snap = await adminDb
      .collection('projects')
      .doc(input.projectId)
      .collection('tasks')
      .get()
    return (snap.docs as FirestoreDoc[])
      .map((doc) => refFromSearchDoc('task', doc, input.user, { projectId: input.projectId }))
      .filter((ref): ref is ContextReference => Boolean(ref))
      .filter((ref) => matchesQuery({ name: ref.label, summary: ref.summary }, query))
      .slice(0, limit)
  }

  if (type === 'project') {
    const docs = await queryByOrg('projects', input.orgId, 80)
    const scopedDocs = await filterSearchDocsForRecordScope(input.user, input.orgId, 'project', docs)
    return scopedDocs
      .map((doc) => refFromSearchDoc('project', doc, input.user))
      .filter((ref): ref is ContextReference => Boolean(ref))
      .filter((ref) => matchesQuery({ name: ref.label, summary: ref.summary }, query))
      .slice(0, limit)
  }

  if (type === 'document' && input.contextType === 'company' && input.contextId) {
    const companyDoc = await getDoc('companies', input.contextId)
    if (companyDoc) {
      const companyData = companyDoc.data() ?? {}
      const companyOrgId = docOrgId(companyData, input.orgId)
      const canUseCompany = !isDeleted(companyData) &&
        companyOrgId &&
        sameOrg(companyData, input.orgId) &&
        canUseOrg(input.user, companyOrgId) &&
        await actorCanReadCrmRecord(input.user, companyOrgId, 'company', companyDoc.id, companyData)
      if (canUseCompany) {
        const rows = await listCompanyDocuments({
          id: companyDoc.id,
          ...companyData,
          orgId: companyOrgId,
          name: clean(companyData.name) || companyDoc.id,
          tags: Array.isArray(companyData.tags) ? companyData.tags : [],
          notes: clean(companyData.notes, 1000),
          createdAt: null,
          updatedAt: null,
        } as Company, { limit: 80 })
        const refs = await resolveContextReferences(
          rows.map((row) => ({ type: 'document' as const, id: row.id, orgId: input.orgId, origin: 'mention' as const })),
          input.user,
          input.orgId,
        )
        return refs
          .filter((ref): ref is ContextReference => Boolean(ref))
          .filter((ref) => matchesQuery({ name: ref.label, summary: ref.summary }, query))
          .slice(0, limit)
      }
    }
  }

  const collection = COLLECTION_BY_TYPE[type]
  if (!collection) return []
  const docs = type === 'invoice' || type === 'quote'
    ? await queryBillingByOrg(collection as 'invoices' | 'quotes', input.orgId, SEARCH_SCAN_LIMIT_BY_TYPE[type] ?? 80)
    : type === 'document'
      ? await queryDocumentsByOrg(input.orgId, SEARCH_SCAN_LIMIT_BY_TYPE[type] ?? 80)
      : await queryByOrg(collection, input.orgId, SEARCH_SCAN_LIMIT_BY_TYPE[type] ?? 80)
  const scopedDocs = await filterSearchDocsForRecordScope(input.user, input.orgId, type, docs)
  if (type === 'invoice' || type === 'quote' || type === 'document' || type === 'support') {
    const refs = await resolveContextReferences(
      scopedDocs.map((doc) => ({ type, id: doc.id, orgId: input.orgId, origin: 'mention' as const })),
      input.user,
      input.orgId,
    )
    return refs
      .filter((ref) => matchesQuery({ name: ref.label, summary: ref.summary }, query))
      .slice(0, limit)
  }
  return scopedDocs
    .map((doc) => refFromSearchDoc(type, doc, input.user))
    .filter((ref): ref is ContextReference => Boolean(ref))
    .filter((ref) => matchesQuery({ name: ref.label, summary: ref.summary }, query))
    .slice(0, limit)
}

export function buildAttachedContextBlock(refs: ContextReference[]): string {
  if (!refs.length) return ''
  const lines = ['[Attached context]']
  for (const ref of refs.slice(0, MAX_CONTEXT_REFS)) {
    lines.push(`- ${ref.type}: ${ref.label}`)
    lines.push(`  id: ${ref.id}`)
    lines.push(`  orgId: ${ref.orgId}`)
    if (ref.href) lines.push(`  href: ${ref.href}`)
    if (ref.summary) lines.push(`  summary: ${ref.summary.slice(0, MAX_CONTEXT_SUMMARY_CHARS)}`)
    if (ref.metadata?.contextKind === 'workbench_path' && typeof ref.metadata.path === 'string') {
      lines.push(`  linkedWorkspacePath: ${ref.metadata.path}`)
    }
  }
  lines.push('---', '')
  return `${lines.join('\n').slice(0, MAX_ATTACHED_CONTEXT_CHARS)}\n\n`
}

export async function patchConversationContextRefs(input: PatchConversationContextRefsInput): Promise<ContextReference[]> {
  let nextRefs = input.currentRefs ?? []

  if (input.action === 'clear') {
    nextRefs = []
  } else if (input.action === 'remove') {
    const removeKeys = new Set(sanitizeContextReferenceSeeds(input.refs).map(contextReferenceKey))
    nextRefs = nextRefs.filter((ref) => !removeKeys.has(contextReferenceKey(ref)))
  } else if (input.action === 'add') {
    const resolved = await resolveContextReferences(
      input.refs ?? [],
      input.user,
      input.orgId,
      { conversationId: input.convId },
    )
    const byKey = new Map<string, ContextReference>()
    for (const ref of [...nextRefs, ...resolved]) byKey.set(contextReferenceKey(ref), ref)
    nextRefs = Array.from(byKey.values()).slice(0, MAX_CONTEXT_REFS)
  }

  await convDoc(input.convId).update({
    contextRefs: nextRefs,
    updatedAt: FieldValue.serverTimestamp(),
  })
  return nextRefs
}
