export const CONTEXT_REFERENCE_TYPES = [
  'project',
  'task',
  'contact',
  'company',
  'product',
  'document',
  'research',
  'social',
  'campaign',
  'email',
  'support',
] as const

export type ContextReferenceType = (typeof CONTEXT_REFERENCE_TYPES)[number]

export type ContextReferenceOrigin = 'current_page' | 'mention' | 'manual'

export interface ContextReferenceSeed {
  type: ContextReferenceType
  id: string
  orgId?: string
  label?: string
  href?: string
  origin?: ContextReferenceOrigin
  summary?: string
  metadata?: Record<string, unknown>
}

export interface ContextReference extends Omit<ContextReferenceSeed, 'orgId' | 'label' | 'origin'> {
  orgId: string
  label: string
  origin: ContextReferenceOrigin
  summary?: string
  resolvedAt?: string
}

export const MAX_CONTEXT_REFS = 8
export const MAX_CONTEXT_SUMMARY_CHARS = 700
export const MAX_ATTACHED_CONTEXT_CHARS = 5000

const TYPE_ALIASES: Record<string, ContextReferenceType> = {
  project: 'project',
  projects: 'project',
  task: 'task',
  tasks: 'task',
  contact: 'contact',
  contacts: 'contact',
  business: 'company',
  businesses: 'company',
  company: 'company',
  companies: 'company',
  product: 'product',
  products: 'product',
  doc: 'document',
  docs: 'document',
  document: 'document',
  documents: 'document',
  research: 'research',
  social: 'social',
  post: 'social',
  posts: 'social',
  campaign: 'campaign',
  campaigns: 'campaign',
  email: 'email',
  emails: 'email',
  mailbox: 'email',
  support: 'support',
  ticket: 'support',
  tickets: 'support',
}

export function contextReferenceTypeFrom(value: unknown): ContextReferenceType | null {
  if (typeof value !== 'string') return null
  return TYPE_ALIASES[value.trim().toLowerCase()] ?? null
}

export function contextReferenceKey(ref: Pick<ContextReferenceSeed, 'type' | 'id'>) {
  return `${ref.type}:${ref.id}`
}

function cleanText(value: unknown, max = 240) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

export function sanitizeContextReferenceSeeds(value: unknown): ContextReferenceSeed[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const refs: ContextReferenceSeed[] = []

  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const raw = item as Record<string, unknown>
    const type = contextReferenceTypeFrom(raw.type)
    const id = cleanText(raw.id, 160)
    if (!type || !id) continue
    const key = `${type}:${id}`
    if (seen.has(key)) continue
    seen.add(key)
    const origin = raw.origin === 'current_page' || raw.origin === 'mention' || raw.origin === 'manual'
      ? raw.origin
      : undefined
    const metadata = raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata)
      ? raw.metadata as Record<string, unknown>
      : undefined
    refs.push({
      type,
      id,
      ...(cleanText(raw.orgId, 160) ? { orgId: cleanText(raw.orgId, 160) } : {}),
      ...(cleanText(raw.label) ? { label: cleanText(raw.label) } : {}),
      ...(cleanText(raw.href, 500) ? { href: cleanText(raw.href, 500) } : {}),
      ...(origin ? { origin } : {}),
      ...(cleanText(raw.summary, MAX_CONTEXT_SUMMARY_CHARS) ? { summary: cleanText(raw.summary, MAX_CONTEXT_SUMMARY_CHARS) } : {}),
      ...(metadata ? { metadata } : {}),
    })
    if (refs.length >= MAX_CONTEXT_REFS) break
  }

  return refs
}

export function normalizeContextReference(ref: ContextReference): ContextReference {
  return {
    type: ref.type,
    id: ref.id,
    orgId: ref.orgId,
    label: ref.label,
    origin: ref.origin,
    ...(ref.href ? { href: ref.href } : {}),
    ...(ref.summary ? { summary: ref.summary.slice(0, MAX_CONTEXT_SUMMARY_CHARS) } : {}),
    ...(ref.metadata ? { metadata: ref.metadata } : {}),
    ...(ref.resolvedAt ? { resolvedAt: ref.resolvedAt } : {}),
  }
}
