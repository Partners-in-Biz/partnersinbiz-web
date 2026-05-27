import { adminDb } from '@/lib/firebase/admin'
import type { AgentEntityCandidate, AgentEntityResolutionResult, AgentMemorySourceType } from './types'
import { normalizeLookupText } from './text'

type FirestoreDoc = { id: string; data: () => Record<string, unknown> }
type FirestoreQuery = {
  where: (field: string, op: string, value: unknown) => FirestoreQuery
  limit: (limit: number) => FirestoreQuery
  get: () => Promise<{ docs: FirestoreDoc[] }>
}

export interface ResolveAgentEntitiesInput {
  query: string
  orgId: string
  limit?: number
  allowedOrganizationIds?: string[] | 'all'
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function tokens(value: string): string[] {
  return normalizeLookupText(value).split(' ').filter(Boolean)
}

function scoreLabel(label: string, query: string, aliases: string[] = []): Pick<AgentEntityCandidate, 'score' | 'matchReason'> | null {
  const normalizedLabel = normalizeLookupText(label)
  const normalizedAliases = aliases.map(normalizeLookupText).filter(Boolean)
  if (!query || !normalizedLabel) return null
  if (normalizedLabel === query) return { score: 100, matchReason: 'exact_name' }
  if (normalizedAliases.includes(query)) return { score: 96, matchReason: 'alias' }
  if (normalizedLabel.includes(query)) return { score: 86, matchReason: 'contains' }

  const queryTokens = tokens(query)
  const labelTokens = new Set(tokens(normalizedLabel))
  if (queryTokens.length === 0) return null
  const matched = queryTokens.filter((token) => labelTokens.has(token)).length
  if (matched === 0) return null
  const ratio = matched / queryTokens.length
  if (ratio < 0.5) return null
  return { score: Math.round(50 + ratio * 25), matchReason: 'token_match' }
}

const TYPE_RANK: Record<AgentEntityCandidate['type'], number> = {
  organization: 4,
  company: 3,
  contact: 2,
  deal: 1,
  project: 1,
}

function isOrganizationLookup(query: string): boolean {
  return /\b(client|customer|org|organization|tenant)\b/i.test(query)
}

function canResolveOrganization(docId: string, allowedOrganizationIds: ResolveAgentEntitiesInput['allowedOrganizationIds']) {
  return allowedOrganizationIds === 'all' || !allowedOrganizationIds || allowedOrganizationIds.includes(docId)
}

function candidateFromDoc(args: {
  doc: FirestoreDoc
  data: Record<string, unknown>
  query: string
  type: AgentEntityCandidate['type']
  sourceType: AgentMemorySourceType
  orgId: string
  label: string
  subtitle?: string
  sourcePath?: string
  aliases?: string[]
}): AgentEntityCandidate | null {
  if (!args.label) return null
  if (args.data.deleted === true || args.data.archived === true) return null
  const scored = scoreLabel(args.label, args.query, args.aliases)
  if (!scored) return null
  return {
    type: args.type,
    id: args.doc.id,
    orgId: args.orgId,
    label: args.label,
    subtitle: args.subtitle,
    sourcePath: args.sourcePath,
    sourceType: args.sourceType,
    ...scored,
  }
}

async function getDocs(collectionName: string, orgId?: string): Promise<FirestoreDoc[]> {
  let query = adminDb.collection(collectionName) as unknown as FirestoreQuery
  if (orgId) query = query.where('orgId', '==', orgId)
  const snap = await query.limit(1000).get()
  return snap.docs as FirestoreDoc[]
}

export async function resolveAgentEntities(input: ResolveAgentEntitiesInput): Promise<AgentEntityResolutionResult> {
  const query = normalizeLookupText(input.query)
  const limit = Math.min(Math.max(input.limit ?? 8, 1), 20)
  const [orgDocs, companyDocs, contactDocs] = await Promise.all([
    getDocs('organizations'),
    getDocs('companies', input.orgId),
    getDocs('contacts', input.orgId),
  ])

  const candidates: AgentEntityCandidate[] = []
  for (const doc of orgDocs) {
    const data = doc.data()
    if (data.type === 'platform_owner' && doc.id !== input.orgId) continue
    if (!canResolveOrganization(doc.id, input.allowedOrganizationIds)) continue
    const label = asString(data.name) || asString(data.displayName) || asString(data.slug)
    const candidate = candidateFromDoc({
      doc,
      data,
      query,
      type: 'organization',
      sourceType: 'organization',
      orgId: doc.id,
      label,
      subtitle: asString(data.industry) || asString(data.slug),
      sourcePath: `/admin/org/${asString(data.slug) || doc.id}`,
      aliases: [asString(data.slug), ...(Array.isArray(data.aliases) ? data.aliases.filter((item): item is string => typeof item === 'string') : [])],
    })
    if (candidate) candidates.push(candidate)
  }

  for (const doc of companyDocs) {
    const data = doc.data()
    const label = asString(data.name)
    const candidate = candidateFromDoc({
      doc,
      data,
      query,
      type: 'company',
      sourceType: 'company',
      orgId: asString(data.orgId) || input.orgId,
      label,
      subtitle: asString(data.website) || asString(data.industry),
      sourcePath: `/portal/crm/companies/${doc.id}`,
      aliases: [asString(data.domain), asString(data.website)],
    })
    if (candidate) candidates.push(candidate)
  }

  for (const doc of contactDocs) {
    const data = doc.data()
    const label = asString(data.name) || asString(data.email)
    const candidate = candidateFromDoc({
      doc,
      data,
      query,
      type: 'contact',
      sourceType: 'contact',
      orgId: asString(data.orgId) || input.orgId,
      label,
      subtitle: [asString(data.company), asString(data.email)].filter(Boolean).join(' · '),
      sourcePath: `/portal/crm/contacts/${doc.id}`,
      aliases: [asString(data.email), asString(data.company), asString(data.phone)],
    })
    if (candidate) candidates.push(candidate)
  }

  const sorted = candidates
    .sort((a, b) => b.score - a.score || TYPE_RANK[b.type] - TYPE_RANK[a.type] || a.label.localeCompare(b.label))
    .slice(0, limit)
  const top = sorted[0] ?? null
  const second = sorted[1] ?? null
  const exactMatches = sorted.filter((candidate) => candidate.matchReason === 'exact_name')
  const exactOrganizationMatches = exactMatches.filter((candidate) => candidate.type === 'organization')
  const selectedEntity =
    exactMatches.length === 1
      ? exactMatches[0]
      : exactOrganizationMatches.length === 1 && isOrganizationLookup(input.query)
        ? exactOrganizationMatches[0]
      : top && top.score >= 86 && (!second || top.score - second.score >= 15)
        ? top
        : null

  return {
    intent: sorted.length > 0 ? 'entity_lookup' : 'memory_search',
    entityCandidates: sorted,
    selectedEntity,
    nextActions: sorted.length > 1 && !selectedEntity
      ? ['Choose one of the matching entities before taking action.']
      : [],
  }
}
