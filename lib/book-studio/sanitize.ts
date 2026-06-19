import type { BookStudioBridgeLinkType, BookStudioChannel, BookStudioGateStatus, BookStudioRecord, BookStudioResourceConfig, BookStudioResourceKey, BookStudioStage, BookStudioStatus } from './types'

export const BOOK_STUDIO_RESOURCES: Record<BookStudioResourceKey, BookStudioResourceConfig> = {
  projects: { collection: 'book_studio_projects', label: 'book project', titleField: 'title', defaultStatus: 'draft' },
  briefs: { collection: 'book_studio_briefs', label: 'book brief', titleField: 'title', defaultStatus: 'draft' },
  series: { collection: 'book_studio_series', label: 'series', titleField: 'name', defaultStatus: 'draft' },
  'artifact-links': { collection: 'book_studio_artifact_links', label: 'artifact link', titleField: 'label', defaultStatus: 'draft' },
  'publishing-packets': { collection: 'book_studio_publishing_packets', label: 'publishing packet', titleField: 'title', defaultStatus: 'draft' },
  'rights-ledgers': { collection: 'book_studio_rights_ledgers', label: 'rights ledger', titleField: 'title', defaultStatus: 'draft' },
  'package-manifests': { collection: 'book_studio_package_manifests', label: 'package manifest', titleField: 'title', defaultStatus: 'draft' },
  'analytics-imports': { collection: 'book_studio_analytics_imports', label: 'analytics import', titleField: 'importLabel', defaultStatus: 'draft' },
  'decision-logs': { collection: 'book_studio_decision_logs', label: 'decision log', titleField: 'decision', defaultStatus: 'draft' },
}

const STAGES: BookStudioStage[] = ['intake', 'research', 'brief', 'quality_gates', 'publishing_packet', 'manual_upload_review', 'analytics_reconciliation']
const STATUSES: BookStudioStatus[] = ['draft', 'internal_review', 'client_review', 'approved', 'blocked', 'archived']
const GATE_STATUSES: BookStudioGateStatus[] = ['pass', 'warning', 'block', 'not_applicable', 'missing_evidence']
const CHANNELS: BookStudioChannel[] = ['kdp', 'google_play_books', 'apple_books', 'kobo', 'draft2digital', 'ingram', 'acx', 'manual_handoff', 'local_publisher']
const APPROVAL_STATUSES = ['not_requested', 'requested', 'approved', 'changes_requested', 'rejected', 'blocked'] as const
const RIGHTS_STATUSES = ['unknown', 'needs_review', 'cleared', 'blocked', 'licensed', 'public_domain', 'owned'] as const
const ANALYTICS_SOURCES = ['manual_import', 'kdp_report', 'google_play_books_report', 'apple_books_report', 'kobo_report', 'draft2digital_report', 'ingram_report', 'local_publisher_report'] as const
const BRIDGE_LINK_TYPES: BookStudioBridgeLinkType[] = ['research', 'client_document', 'project_task', 'artifact', 'evidence', 'approval']
const FORBIDDEN_KEYS = new Set([
  'marketplaceCredential',
  'marketplaceCredentials',
  'credentialId',
  'accessToken',
  'refreshToken',
  'apiKey',
  'secret',
  'password',
  'marketplaceMetadataPatch',
  'metadataPatch',
  'publishNow',
  'submitToStore',
  'storeSubmissionPayload',
  'runtimeMetadataMutation',
  'keywordScrapeJobId',
  'categoryAutomationJobId',
  'internalNotes',
  'privateNotes',
  'rawPrompt',
  'rawOutput',
  'rawHermesOutput',
  'unsafeRecommendation',
  'unsupportedClaim',
  'parserError',
])

function normalizedKey(value: string): string {
  return value.replace(/[^a-z0-9]/gi, '').toLowerCase()
}

const FORBIDDEN_KEY_NORMALIZED = new Set(Array.from(FORBIDDEN_KEYS).map(normalizedKey))
const FORBIDDEN_KEY_FRAGMENTS = [
  'credential',
  'accesstoken',
  'refreshtoken',
  'apikey',
  'clientsecret',
  'secret',
  'password',
  'publishtostore',
  'submitstore',
  'submittostore',
  'publishnow',
  'marketplacemetadatapatch',
  'metadatapatch',
  'runtime metadatamutation',
].map((value) => value.replace(/[^a-z0-9]/gi, '').toLowerCase())

function isForbiddenKey(key: string): boolean {
  const normalized = normalizedKey(key)
  return FORBIDDEN_KEY_NORMALIZED.has(normalized) || FORBIDDEN_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment))
}

type PlainRecord = Record<string, unknown>

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function cleanNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function cleanBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function cleanObject(value: unknown): PlainRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as PlainRecord : {}
}

function compact<T extends PlainRecord>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>
}

function cleanStringArray(value: unknown): string[] | undefined {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[\n,]+/)
      : []
  const values = raw.map(cleanString).filter((item): item is string => Boolean(item))
  return values.length ? values : undefined
}

function isSafeUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return ['http:', 'https:'].includes(parsed.protocol)
  } catch {
    return false
  }
}

function cleanUrl(value: unknown): string | undefined {
  const url = cleanString(value)
  return url && isSafeUrl(url) ? url : undefined
}

function pick<T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number]): T[number] {
  return allowed.includes(value as T[number]) ? value as T[number] : fallback
}

function stripForbidden(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripForbidden).filter((entry) => entry !== undefined)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value as PlainRecord).flatMap(([key, entry]) => {
      if (isForbiddenKey(key)) return []
      if (entry === undefined) return []
      const cleaned = stripForbidden(entry)
      return cleaned === undefined ? [] : [[key, cleaned]]
    })
  )
}

function cleanArtifactLinks(value: unknown) {
  if (!Array.isArray(value)) return undefined
  const links = value.map((item) => {
    const source = cleanObject(item)
    const href = cleanUrl(source.href ?? source.url)
    if (!href) return null
    return compact({
      id: cleanString(source.id),
      label: cleanString(source.label) ?? 'Open artifact',
      href,
      type: cleanString(source.type),
      checksum: cleanString(source.checksum),
      version: cleanString(source.version),
    })
  }).filter(Boolean)
  return links.length ? links : undefined
}

function cleanBridgeLinks(value: unknown) {
  if (!Array.isArray(value)) return undefined
  const links = value.map((item) => {
    const source = cleanObject(item)
    const ref = cleanString(source.ref ?? source.id ?? source.resourceId ?? source.documentId ?? source.taskId)
    if (!ref) return null
    return compact({
      id: cleanString(source.id),
      type: pick(source.type ?? source.resourceType, BRIDGE_LINK_TYPES, 'artifact'),
      label: cleanString(source.label) ?? cleanString(source.title) ?? 'Linked evidence',
      ref,
      href: cleanUrl(source.href ?? source.url),
      status: cleanString(source.status),
      version: cleanString(source.version ?? source.sourceSpecVersion),
      checksum: cleanString(source.checksum),
      requiredForApproval: cleanBoolean(source.requiredForApproval ?? source.blocksApproval),
    })
  }).filter(Boolean)
  return links.length ? links : undefined
}

function cleanGates(value: unknown) {
  if (!Array.isArray(value)) return undefined
  const gates = value.map((item, index) => {
    const source = cleanObject(item)
    return compact({
      id: cleanString(source.id) ?? `gate-${index + 1}`,
      label: cleanString(source.label) ?? 'Quality gate',
      status: pick(source.status, GATE_STATUSES, 'missing_evidence'),
      ownerAgentId: cleanString(source.ownerAgentId),
      owner: cleanString(source.owner),
      evidenceIds: cleanStringArray(source.evidenceIds ?? source.evidence),
      blocksPublishing: cleanBoolean(source.blocksPublishing),
    })
  })
  return gates.length ? gates : undefined
}

function cleanRightsLedger(value: unknown) {
  const source = cleanObject(value)
  if (!Object.keys(source).length) return undefined
  return compact({
    status: pick(source.status, RIGHTS_STATUSES, 'needs_review'),
    owner: cleanString(source.owner),
    author: cleanString(source.author),
    contributorIds: cleanStringArray(source.contributorIds),
    sourceUrls: cleanStringArray(source.sourceUrls)?.filter(isSafeUrl),
    licenseIds: cleanStringArray(source.licenseIds),
    aiDisclosureRequired: cleanBoolean(source.aiDisclosureRequired),
    notes: cleanString(source.notes),
  })
}

function cleanMetadata(value: unknown) {
  const source = cleanObject(value)
  if (!Object.keys(source).length) return undefined
  return compact({
    title: cleanString(source.title),
    subtitle: cleanString(source.subtitle),
    description: cleanString(source.description),
    authorName: cleanString(source.authorName),
    imprint: cleanString(source.imprint),
    language: cleanString(source.language),
    isbn: cleanString(source.isbn),
    keywords: cleanStringArray(source.keywords),
    categories: cleanStringArray(source.categories),
    aiDisclosure: cleanString(source.aiDisclosure),
    matureContent: cleanBoolean(source.matureContent),
  })
}

function cleanApprovalState(value: unknown) {
  const source = cleanObject(value)
  if (!Object.keys(source).length) return undefined
  return compact({
    status: pick(source.status, APPROVAL_STATUSES, 'not_requested'),
    snapshotHash: cleanString(source.snapshotHash),
    evidenceId: cleanString(source.evidenceId),
    decidedAt: cleanString(source.decidedAt),
  })
}

function cleanPackageManifest(value: unknown) {
  const source = cleanObject(value)
  if (!Object.keys(source).length) return undefined
  return compact({
    version: cleanString(source.version),
    checksum: cleanString(source.checksum),
    files: cleanArtifactLinks(source.files),
    qaStatus: pick(source.qaStatus, GATE_STATUSES, 'missing_evidence'),
    generatedAt: cleanString(source.generatedAt),
  })
}

function cleanAnalyticsSnapshot(value: unknown) {
  const source = cleanObject(value)
  if (!Object.keys(source).length) return undefined
  return compact({
    source: pick(source.source, ANALYTICS_SOURCES, 'manual_import'),
    importedAt: cleanString(source.importedAt),
    periodStart: cleanString(source.periodStart),
    periodEnd: cleanString(source.periodEnd),
    units: cleanNumber(source.units),
    reads: cleanNumber(source.reads),
    revenue: cleanNumber(source.revenue),
    currency: cleanString(source.currency),
    confidence: cleanString(source.confidence),
  })
}

export function sanitizeBookStudioRecordInput(resource: BookStudioResourceKey, input: PlainRecord, orgId: string): BookStudioRecord {
  const config = BOOK_STUDIO_RESOURCES[resource]
  const source = stripForbidden(cleanObject(input)) as PlainRecord
  const titleFallback = resource === 'series' ? 'Untitled series' : `Untitled ${config.label}`
  const titleValue = cleanString(source[config.titleField]) ?? cleanString(source.title) ?? cleanString(source.name) ?? cleanString(source.label)

  return compact({
    orgId,
    projectId: cleanString(source.projectId),
    seriesId: cleanString(source.seriesId),
    briefId: cleanString(source.briefId),
    packetId: cleanString(source.packetId),
    title: config.titleField === 'title' ? titleValue ?? titleFallback : cleanString(source.title),
    name: config.titleField === 'name' ? titleValue ?? titleFallback : cleanString(source.name),
    label: config.titleField === 'label' ? titleValue ?? titleFallback : cleanString(source.label),
    importLabel: config.titleField === 'importLabel' ? titleValue ?? titleFallback : cleanString(source.importLabel),
    decision: config.titleField === 'decision' ? titleValue ?? titleFallback : cleanString(source.decision),
    status: pick(source.status, STATUSES, config.defaultStatus),
    stage: pick(source.stage, STAGES, 'intake'),
    channel: pick(source.channel, CHANNELS, 'manual_handoff'),
    safeSummary: cleanString(source.safeSummary ?? source.summary),
    nextAction: cleanString(source.nextAction),
    description: cleanString(source.description),
    audience: cleanString(source.audience),
    bookType: cleanString(source.bookType),
    artifactLinks: cleanArtifactLinks(source.artifactLinks ?? source.artifacts),
    bridgeLinks: cleanBridgeLinks(source.bridgeLinks ?? source.links),
    href: cleanUrl(source.href ?? source.url),
    gates: cleanGates(source.gates ?? source.approvalGates),
    rightsLedger: cleanRightsLedger(source.rightsLedger ?? source.rights),
    metadata: cleanMetadata(source.metadata),
    packageManifest: cleanPackageManifest(source.packageManifest ?? source.manifest),
    analyticsSnapshot: cleanAnalyticsSnapshot(source.analyticsSnapshot ?? source.analytics),
    approvalState: cleanApprovalState(source.approvalState),
    evidenceIds: cleanStringArray(source.evidenceIds),
    researchItemIds: cleanStringArray(source.researchItemIds),
    clientDocumentIds: cleanStringArray(source.clientDocumentIds ?? source.documentIds),
    projectTaskIds: cleanStringArray(source.projectTaskIds ?? source.taskIds),
    artifactIds: cleanStringArray(source.artifactIds),
    sourceDocumentId: cleanString(source.sourceDocumentId),
    sourceSpecVersion: cleanString(source.sourceSpecVersion),
    approvalGateTaskId: cleanString(source.approvalGateTaskId),
  }) as BookStudioRecord
}

export function serializeBookStudioRecord(id: string, data: FirebaseFirestore.DocumentData): BookStudioRecord {
  const json = JSON.parse(JSON.stringify(stripForbidden(data))) as BookStudioRecord
  return { id, ...json }
}
