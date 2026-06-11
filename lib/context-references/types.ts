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
  'deal',
  'invoice',
  'quote',
  'property',
  'seo_sprint',
  'workspace_folder',
  'workspace_artifact',
  'workspace_connection',
  'workspace_broker_job',
  'file',
  'report',
  'calendar_event',
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
  deal: 'deal',
  deals: 'deal',
  opportunity: 'deal',
  opportunities: 'deal',
  invoice: 'invoice',
  invoices: 'invoice',
  quote: 'quote',
  quotes: 'quote',
  property: 'property',
  properties: 'property',
  seo: 'seo_sprint',
  'seo sprint': 'seo_sprint',
  'seo sprints': 'seo_sprint',
  seo_sprint: 'seo_sprint',
  seo_sprints: 'seo_sprint',
  sprint: 'seo_sprint',
  sprints: 'seo_sprint',
  workspace: 'workspace_artifact',
  workspaces: 'workspace_artifact',
  'workspace folder': 'workspace_folder',
  'workspace folders': 'workspace_folder',
  workspace_folder: 'workspace_folder',
  workspace_folders: 'workspace_folder',
  workspacefolder: 'workspace_folder',
  workspacefolders: 'workspace_folder',
  folder: 'workspace_folder',
  folders: 'workspace_folder',
  artifact: 'workspace_artifact',
  artifacts: 'workspace_artifact',
  'workspace artifact': 'workspace_artifact',
  'workspace artifacts': 'workspace_artifact',
  workspace_artifact: 'workspace_artifact',
  workspace_artifacts: 'workspace_artifact',
  workspaceartifact: 'workspace_artifact',
  workspaceartifacts: 'workspace_artifact',
  connection: 'workspace_connection',
  connections: 'workspace_connection',
  'workspace connection': 'workspace_connection',
  'workspace connections': 'workspace_connection',
  workspace_connection: 'workspace_connection',
  workspace_connections: 'workspace_connection',
  workspaceconnection: 'workspace_connection',
  workspaceconnections: 'workspace_connection',
  'broker job': 'workspace_broker_job',
  'broker jobs': 'workspace_broker_job',
  brokerjob: 'workspace_broker_job',
  brokerjobs: 'workspace_broker_job',
  workspace_broker_job: 'workspace_broker_job',
  workspace_broker_jobs: 'workspace_broker_job',
  file: 'file',
  files: 'file',
  upload: 'file',
  uploads: 'file',
  report: 'report',
  reports: 'report',
  calendar: 'calendar_event',
  event: 'calendar_event',
  events: 'calendar_event',
  calendar_event: 'calendar_event',
  calendar_events: 'calendar_event',
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
