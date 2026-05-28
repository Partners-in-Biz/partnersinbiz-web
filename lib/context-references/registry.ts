import { FieldValue } from 'firebase-admin/firestore'

import { canAccessOrg } from '@/lib/api/platformAdmin'
import type { ApiUser } from '@/lib/api/types'
import { CLIENT_DOCUMENTS_COLLECTION, getClientDocument } from '@/lib/client-documents/store'
import { convDoc } from '@/lib/conversations/conversations'
import { adminDb } from '@/lib/firebase/admin'
import { getProjectForUser } from '@/lib/projects/access'
import { getResearchItem, RESEARCH_COLLECTION } from '@/lib/research/store'
import { getSupportTicket, SUPPORT_TICKETS_COLLECTION } from '@/lib/support/store'
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
  document: CLIENT_DOCUMENTS_COLLECTION,
  research: RESEARCH_COLLECTION,
  social: 'social_posts',
  campaign: 'campaigns',
  email: 'mailbox_messages',
  support: SUPPORT_TICKETS_COLLECTION,
  task: 'tasks',
}

function clean(value: unknown, max = 260): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : ''
}

function compactSummary(parts: Array<unknown>, max = MAX_CONTEXT_SUMMARY_CHARS): string {
  return parts
    .map((part) => clean(part, max))
    .filter(Boolean)
    .join(' | ')
    .slice(0, max)
}

function origin(seed: ContextReferenceSeed): ContextReferenceOrigin {
  return seed.origin ?? 'manual'
}

function expectedOrgId(seed: ContextReferenceSeed, defaultOrgId?: string): string | undefined {
  return seed.orgId || defaultOrgId
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

function isDeleted(data: RawDoc): boolean {
  return data.deleted === true || data.archived === true
}

function href(type: ContextReferenceType, id: string, data: RawDoc, seedHref?: string): string {
  if (seedHref) return seedHref
  const slug = clean(data.orgSlug) || clean(data.slug)
  switch (type) {
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
    case 'document':
      return `/admin/documents/${id}`
    case 'research':
      return `/admin/research/${id}`
    case 'social':
      return `/admin/social/history/${id}`
    case 'campaign':
      return `/admin/campaigns/${id}`
    case 'email':
      return `/admin/email/mailbox/${id}`
    case 'support':
      return `/admin/support/${id}`
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

function matchesQuery(data: RawDoc, q: string): boolean {
  if (!q) return true
  const haystack = [
    data.name,
    data.title,
    data.subject,
    data.email,
    data.company,
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
  const projectId = clean(input.seed.metadata?.projectId)
  let doc: FirestoreDoc | null = null
  if (projectId) {
    const projectAccess = await getProjectForUser(projectId, input.user)
    if (!projectAccess.ok) return null
    const snap = await adminDb.collection('projects').doc(projectId).collection('tasks').doc(input.seed.id).get()
    doc = snap.exists ? (snap as FirestoreDoc) : null
  }
  if (!doc) doc = await getDoc('tasks', input.seed.id)
  if (!doc) return null
  const data = doc.data() ?? {}
  const orgId = docOrgId(data, input.seed.orgId ?? input.defaultOrgId)
  if (!orgId || !sameOrg(data, expectedOrgId(input.seed, input.defaultOrgId)) || !canUseOrg(input.user, orgId)) return null
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
    metadata: projectId ? { projectId } : undefined,
  })
}

async function resolveCrm(type: 'contact' | 'company', input: ResolverInput): Promise<ContextReference | null> {
  const collection = type === 'contact' ? 'contacts' : 'companies'
  const doc = await getDoc(collection, input.seed.id)
  if (!doc) return null
  const data = doc.data() ?? {}
  const orgId = docOrgId(data, input.seed.orgId ?? input.defaultOrgId)
  if (isDeleted(data) || !orgId || !sameOrg(data, expectedOrgId(input.seed, input.defaultOrgId)) || !canUseOrg(input.user, orgId)) return null
  return makeRef({
    type,
    id: doc.id,
    orgId,
    label: clean(data.name) || clean(data.companyName) || input.seed.label || doc.id,
    origin: origin(input.seed),
    href: href(type, doc.id, data, input.seed.href),
    summary: compactSummary([
      data.email,
      data.phone,
      data.company,
      data.website,
      data.status ? `status: ${clean(data.status)}` : '',
      data.notes,
    ]),
  })
}

async function resolveDocument(input: ResolverInput): Promise<ContextReference | null> {
  const doc = await getClientDocument(input.seed.id)
  if (!doc) return null
  const data = doc as unknown as RawDoc
  const orgId = docOrgId(data, input.seed.orgId ?? input.defaultOrgId)
  if (!orgId || !sameOrg(data, expectedOrgId(input.seed, input.defaultOrgId)) || !canUseOrg(input.user, orgId)) return null
  return makeRef({
    type: 'document',
    id: doc.id,
    orgId,
    label: clean(doc.title) || input.seed.label || doc.id,
    origin: origin(input.seed),
    href: href('document', doc.id, data, input.seed.href),
    summary: compactSummary([
      `type: ${clean(doc.type)}`,
      `status: ${clean(doc.status)}`,
      doc.approvalMode ? `approval: ${clean(doc.approvalMode)}` : '',
    ]),
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
  type: 'social' | 'campaign' | 'email',
  input: ResolverInput,
): Promise<ContextReference | null> {
  const collection = COLLECTION_BY_TYPE[type]
  if (!collection) return null
  const doc = await getDoc(collection, input.seed.id)
  if (!doc) return null
  const data = doc.data() ?? {}
  const orgId = docOrgId(data, input.seed.orgId ?? input.defaultOrgId)
  if (isDeleted(data) || !orgId || !sameOrg(data, expectedOrgId(input.seed, input.defaultOrgId)) || !canUseOrg(input.user, orgId)) return null
  if (type === 'email' && input.user.role === 'client' && clean(data.uid) !== input.user.uid) return null
  const label = clean(data.name) ||
    clean(data.title) ||
    clean(data.subject) ||
    clean(data.content, 80) ||
    input.seed.label ||
    doc.id
  return makeRef({
    type,
    id: doc.id,
    orgId,
    label,
    origin: origin(input.seed),
    href: href(type, doc.id, data, input.seed.href),
    summary: compactSummary([
      data.status ? `status: ${clean(data.status)}` : '',
      type === 'social' ? data.platform : '',
      type === 'email' ? data.fromEmail || data.from : '',
      type === 'email' ? data.snippet || data.body : '',
      type === 'campaign' ? data.description : '',
      data.content,
    ]),
  })
}

async function resolveSupport(input: ResolverInput): Promise<ContextReference | null> {
  const ticket = await getSupportTicket(input.seed.id)
  if (!ticket) return null
  const data = ticket as unknown as RawDoc
  const orgId = clean(ticket.orgId) || input.seed.orgId || input.defaultOrgId || ''
  if (!orgId || orgId !== expectedOrgId(input.seed, input.defaultOrgId) || !canUseOrg(input.user, orgId)) return null
  if (input.user.role === 'client' && clean(ticket.createdBy) !== input.user.uid) return null
  return makeRef({
    type: 'support',
    id: ticket.id,
    orgId,
    label: clean(ticket.subject) || input.seed.label || ticket.id,
    origin: origin(input.seed),
    href: href('support', ticket.id, data, input.seed.href),
    summary: compactSummary([
      `status: ${clean(ticket.status)}`,
      `priority: ${clean(ticket.priority)}`,
      ticket.description,
    ]),
  })
}

async function resolveOne(seed: ContextReferenceSeed, user: ApiUser, defaultOrgId?: string): Promise<ContextReference | null> {
  switch (seed.type) {
    case 'project':
      return resolveProject({ seed, user, defaultOrgId })
    case 'task':
      return resolveTask({ seed, user, defaultOrgId })
    case 'contact':
      return resolveCrm('contact', { seed, user, defaultOrgId })
    case 'company':
      return resolveCrm('company', { seed, user, defaultOrgId })
    case 'document':
      return resolveDocument({ seed, user, defaultOrgId })
    case 'research':
      return resolveResearch({ seed, user, defaultOrgId })
    case 'social':
    case 'campaign':
    case 'email':
      return resolveGeneric(seed.type, { seed, user, defaultOrgId })
    case 'support':
      return resolveSupport({ seed, user, defaultOrgId })
  }
}

export async function resolveContextReferences(
  refs: unknown,
  user: ApiUser,
  defaultOrgId?: string,
): Promise<ContextReference[]> {
  const seeds = sanitizeContextReferenceSeeds(refs)
  const resolved: ContextReference[] = []
  const seen = new Set<string>()
  for (const seed of seeds) {
    const ref = await resolveOne(seed, user, defaultOrgId)
    if (!ref) continue
    const key = contextReferenceKey(ref)
    if (seen.has(key)) continue
    seen.add(key)
    resolved.push(ref)
    if (resolved.length >= MAX_CONTEXT_REFS) break
  }
  return resolved
}

function refFromSearchDoc(type: ContextReferenceType, doc: FirestoreDoc, user: ApiUser): ContextReference | null {
  const data = doc.data() ?? {}
  if (isDeleted(data)) return null
  const orgId = docOrgId(data)
  if (!orgId || !canUseOrg(user, orgId)) return null
  if (type === 'research' && user.role === 'client' && clean(data.visibility) !== 'client_visible') return null
  if (type === 'email' && user.role === 'client' && clean(data.uid) !== user.uid) return null
  if (type === 'support' && user.role === 'client' && clean(data.createdBy) !== user.uid) return null

  const label = clean(data.name) ||
    clean(data.title) ||
    clean(data.subject) ||
    clean(data.email) ||
    clean(data.content, 80) ||
    doc.id
  return makeRef({
    type,
    id: doc.id,
    orgId,
    label,
    origin: 'mention',
    href: href(type, doc.id, data),
    summary: compactSummary([data.status, data.description, data.summary, data.notes, data.content, data.email]),
  })
}

export async function searchContextReferences(input: SearchContextReferencesInput): Promise<ContextReference[]> {
  if (!input.orgId || !canUseOrg(input.user, input.orgId)) return []
  const type = contextReferenceTypeFrom(input.type)
  if (!type) return []
  const limit = Math.min(Math.max(input.limit ?? 8, 1), MAX_CONTEXT_REFS)
  const query = clean(input.query, 120).toLowerCase()

  if (type === 'project') {
    const docs = await queryByOrg('projects', input.orgId, 80)
    return docs
      .map((doc) => refFromSearchDoc('project', doc, input.user))
      .filter((ref): ref is ContextReference => Boolean(ref))
      .filter((ref) => matchesQuery({ name: ref.label, summary: ref.summary }, query))
      .slice(0, limit)
  }

  const collection = COLLECTION_BY_TYPE[type]
  if (!collection) return []
  const docs = await queryByOrg(collection, input.orgId, 80)
  return docs
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
    const resolved = await resolveContextReferences(input.refs ?? [], input.user, input.orgId)
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
