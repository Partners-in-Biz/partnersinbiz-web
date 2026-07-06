import { getBookFormat } from './format-registry'
import { resolveTrimSpec } from './trim'
import type { BookStudioBridgeLinkType, BookStudioChannel, BookStudioContentStatus, BookStudioGateStatus, BookStudioPageKind, BookStudioRecord, BookStudioResourceConfig, BookStudioResourceKey, BookStudioStage, BookStudioStatus } from './types'

export class BookStudioValidationError extends Error {
  status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'BookStudioValidationError'
    this.status = status
  }
}

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
  chapters: { collection: 'book_studio_chapters', label: 'chapter', titleField: 'title', defaultStatus: 'draft' },
  pages: { collection: 'book_studio_pages', label: 'page', titleField: 'title', defaultStatus: 'draft' },
}

const STAGES: BookStudioStage[] = ['intake', 'research', 'brief', 'quality_gates', 'publishing_packet', 'manual_upload_review', 'analytics_reconciliation']
const STATUSES: BookStudioStatus[] = [
  'not_started',
  'draft',
  'internal_review',
  'client_review',
  'approved',
  'needs_review',
  'blocked',
  'ready_for_human_review',
  'approved_for_manual_next_step',
  'archived',
]
const PUBLISHING_READINESS_STATUSES = ['not_started', 'draft', 'needs_review', 'blocked', 'ready_for_human_review', 'approved_for_manual_next_step'] as const
const GATE_STATUSES: BookStudioGateStatus[] = ['pass', 'warning', 'block', 'not_applicable', 'missing_evidence']
const CHANNELS: BookStudioChannel[] = ['kdp', 'google_play_books', 'apple_books', 'kobo', 'draft2digital', 'ingram', 'acx', 'manual_handoff', 'local_publisher']
const APPROVAL_STATUSES = ['not_requested', 'requested', 'approved', 'changes_requested', 'rejected', 'blocked'] as const
const RIGHTS_STATUSES = ['unknown', 'needs_review', 'cleared', 'blocked', 'licensed', 'public_domain', 'owned'] as const
const ANALYTICS_SOURCES = ['manual_import', 'kdp_report', 'google_play_books_report', 'apple_books_report', 'kobo_report', 'draft2digital_report', 'ingram_report', 'local_publisher_report'] as const
const BRIDGE_LINK_TYPES: BookStudioBridgeLinkType[] = ['research', 'client_document', 'project_task', 'artifact', 'evidence', 'approval']
const CONTENT_STATUSES: BookStudioContentStatus[] = ['draft', 'generated', 'edited', 'approved']
const PAGE_KINDS: BookStudioPageKind[] = ['illustration', 'colouring', 'comic', 'puzzle', 'activity', 'text', 'front_matter', 'back_matter']
const MANIFEST_FILE_ROLES = ['interior_pdf', 'cover_pdf', 'epub'] as const
export const CHAPTER_BODY_MAX_CHARS = 900_000
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

// Set for the duration of a sanitizeBookStudioRecordPatch() call so pick()/
// pickOptional() know "this key was explicitly provided by the caller" vs
// "this key is absent and we should use a create-time default." In patch
// mode, a provided-but-invalid enum value must 400 instead of silently
// falling back or being dropped — see BookStudioValidationError below.
let patchMode = false

/**
 * Enum-ish whitelist helper. In create mode (patchMode === false), an
 * unrecognised value silently falls back to `fallback` (unchanged behaviour).
 * In patch mode, a value that is present (not undefined) but fails the
 * whitelist check throws BookStudioValidationError naming `fieldLabel`
 * instead of silently rewriting the record to the fallback.
 */
function pick<T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number], fieldLabel?: string): T[number] {
  if (allowed.includes(value as T[number])) return value as T[number]
  if (patchMode && value !== undefined && fieldLabel) {
    throw new BookStudioValidationError(`invalid value for ${fieldLabel}`)
  }
  return fallback
}

function pickOptional<T extends readonly string[]>(value: unknown, allowed: T, fieldLabel?: string): T[number] | undefined {
  if (allowed.includes(value as T[number])) return value as T[number]
  if (patchMode && value !== undefined && fieldLabel) {
    throw new BookStudioValidationError(`invalid value for ${fieldLabel}`)
  }
  return undefined
}

function cleanInt(value: unknown): number | undefined {
  const num = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value)
      : NaN
  return Number.isFinite(num) ? Math.trunc(num) : undefined
}

function cleanNonNegativeInt(value: unknown): number | undefined {
  const int = cleanInt(value)
  return int !== undefined && int >= 0 ? int : undefined
}

function cleanPositiveInt(value: unknown): number | undefined {
  const int = cleanInt(value)
  return int !== undefined && int >= 1 ? int : undefined
}

function cleanBookFormat(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const format = typeof value === 'string' ? value.trim() : ''
  if (!format || !getBookFormat(format)) throw new BookStudioValidationError('unknown book format')
  return format
}

function cleanTrim(value: unknown) {
  const source = cleanObject(value)
  if (!Object.keys(source).length) return undefined
  const presetId = cleanString(source.presetId)
  if (!presetId || !resolveTrimSpec(presetId)) throw new BookStudioValidationError('unknown trim preset')
  return compact({
    presetId,
    widthIn: cleanNumber(source.widthIn),
    heightIn: cleanNumber(source.heightIn),
    bleed: cleanNumber(source.bleed),
  })
}

function cleanChapterBody(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  if (!value.trim() && !patchMode) return undefined
  if (value.length > CHAPTER_BODY_MAX_CHARS) {
    throw new BookStudioValidationError(`chapter body exceeds the ${CHAPTER_BODY_MAX_CHARS} character limit`)
  }
  return value
}

function countWords(body: string): number {
  return body.trim().split(/\s+/).filter(Boolean).length
}

function cleanPuzzleParams(value: unknown) {
  const source = cleanObject(value)
  const entries = Object.entries(source).flatMap(([key, entry]): Array<[string, string | number | string[]]> => {
    if (isForbiddenKey(key)) return []
    if (typeof entry === 'string') return [[key, entry]]
    if (typeof entry === 'number' && Number.isFinite(entry)) return [[key, entry]]
    if (Array.isArray(entry)) {
      const strings = entry.filter((item): item is string => typeof item === 'string')
      return strings.length ? [[key, strings]] : []
    }
    return []
  })
  return entries.length ? Object.fromEntries(entries) : undefined
}

function cleanPuzzle(value: unknown) {
  const source = cleanObject(value)
  if (!Object.keys(source).length) return undefined
  const kind = cleanString(source.kind)
  if (!kind) return undefined
  return compact({
    kind,
    seed: cleanInt(source.seed),
    difficulty: cleanString(source.difficulty),
    params: cleanPuzzleParams(source.params),
    solutionRef: cleanString(source.solutionRef),
  })
}

function cleanSharedMetadata(value: unknown) {
  const source = cleanObject(value)
  if (!Object.keys(source).length) return undefined
  return compact({
    authorName: cleanString(source.authorName),
    imprint: cleanString(source.imprint),
    keywords: cleanStringArray(source.keywords),
    categories: cleanStringArray(source.categories),
  })
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
      type: pick(source.type ?? source.resourceType, BRIDGE_LINK_TYPES, 'artifact', 'bridgeLinks[].type'),
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
      status: pick(source.status, GATE_STATUSES, 'missing_evidence', 'gates[].status'),
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
    status: pick(source.status, RIGHTS_STATUSES, 'needs_review', 'rightsLedger.status'),
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
    status: pick(source.status, APPROVAL_STATUSES, 'not_requested', 'approvalState.status'),
    snapshotHash: cleanString(source.snapshotHash),
    evidenceId: cleanString(source.evidenceId),
    decidedAt: cleanString(source.decidedAt),
  })
}

function cleanPublishingReadinessStatus(value: unknown, fieldLabel = 'publishingReadinessStatus') {
  if (value === undefined || value === null || value === '') return undefined
  return pick(value, PUBLISHING_READINESS_STATUSES, 'draft', fieldLabel)
}

function cleanManifestFiles(value: unknown) {
  if (!Array.isArray(value)) return undefined
  const files = value.map((item) => {
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
      role: pickOptional(source.role, MANIFEST_FILE_ROLES, 'packageManifest.files[].role'),
      storagePath: cleanString(source.storagePath),
      bytes: cleanNonNegativeInt(source.bytes),
      pageCount: cleanNonNegativeInt(source.pageCount),
    })
  }).filter(Boolean)
  return files.length ? files : undefined
}

function cleanPackageManifest(value: unknown) {
  const source = cleanObject(value)
  if (!Object.keys(source).length) return undefined
  return compact({
    status: cleanPublishingReadinessStatus(source.status, 'packageManifest.status'),
    version: cleanString(source.version),
    checksum: cleanString(source.checksum),
    files: cleanManifestFiles(source.files),
    qaStatus: pick(source.qaStatus, GATE_STATUSES, 'missing_evidence', 'packageManifest.qaStatus'),
    generatedAt: cleanString(source.generatedAt),
  })
}

function cleanAnalyticsSnapshot(value: unknown) {
  const source = cleanObject(value)
  if (!Object.keys(source).length) return undefined
  return compact({
    source: pick(source.source, ANALYTICS_SOURCES, 'manual_import', 'analyticsSnapshot.source'),
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

function contentModelFields(resource: BookStudioResourceKey, source: PlainRecord): PlainRecord {
  if (resource === 'projects') {
    return {
      format: cleanBookFormat(source.format),
      trim: cleanTrim(source.trim),
      pageTarget: cleanNonNegativeInt(source.pageTarget),
      stylePrompt: cleanString(source.stylePrompt),
      creativeCanvasId: cleanString(source.creativeCanvasId),
      seriesVolumeNumber: cleanPositiveInt(source.seriesVolumeNumber),
      coverImageUrl: cleanUrl(source.coverImageUrl),
    }
  }

  if (resource === 'series') {
    return {
      volumeOrder: cleanStringArray(source.volumeOrder),
      sharedMetadata: cleanSharedMetadata(source.sharedMetadata),
      sharedStylePrompt: cleanString(source.sharedStylePrompt),
    }
  }

  if (resource === 'chapters' || resource === 'pages') {
    const shared: PlainRecord = {
      // Content units are project-scoped documents: the pipeline stage/channel
      // machinery does not apply, so suppress the generic defaults.
      stage: undefined,
      channel: undefined,
      status: pick(source.status, CONTENT_STATUSES, 'draft', 'status'),
      order: cleanNonNegativeInt(source.order),
      canvasRunId: cleanString(source.canvasRunId),
    }

    if (resource === 'chapters') {
      const body = cleanChapterBody(source.body)
      return {
        ...shared,
        body,
        // Server-computed — client-supplied wordCount is never trusted.
        wordCount: body === undefined ? undefined : countWords(body),
      }
    }

    return {
      ...shared,
      kind: pickOptional(source.kind, PAGE_KINDS, 'kind'),
      imageUrl: cleanUrl(source.imageUrl),
      imageStoragePath: cleanString(source.imageStoragePath),
      caption: cleanString(source.caption),
      prompt: cleanString(source.prompt),
      puzzle: cleanPuzzle(source.puzzle),
    }
  }

  return {}
}

export function sanitizeBookStudioRecordInput(resource: BookStudioResourceKey, input: PlainRecord, orgId: string): BookStudioRecord {
  const config = BOOK_STUDIO_RESOURCES[resource]
  const source = stripForbidden(cleanObject(input)) as PlainRecord
  const isContentUnit = resource === 'chapters' || resource === 'pages'
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
    // Chapters/pages are content-unit documents: their `status` is validated
    // against CONTENT_STATUSES (and stage/channel are suppressed entirely)
    // inside contentModelFields() below, which fully overrides these three
    // keys. Passing a fieldLabel here for those two resources would make an
    // out-of-range STATUSES/STAGES/CHANNELS value 400 before the correct,
    // content-model-specific validation ever runs — so only enable the
    // patch-mode throw for resources where these top-level fields are real.
    status: pick(source.status, STATUSES, config.defaultStatus, isContentUnit ? undefined : 'status'),
    stage: pick(source.stage, STAGES, 'intake', isContentUnit ? undefined : 'stage'),
    channel: pick(source.channel, CHANNELS, 'manual_handoff', isContentUnit ? undefined : 'channel'),
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
    publishingReadinessStatus: cleanPublishingReadinessStatus(source.publishingReadinessStatus ?? source.readinessStatus),
    evidenceIds: cleanStringArray(source.evidenceIds),
    researchItemIds: cleanStringArray(source.researchItemIds),
    clientDocumentIds: cleanStringArray(source.clientDocumentIds ?? source.documentIds),
    projectTaskIds: cleanStringArray(source.projectTaskIds ?? source.taskIds),
    artifactIds: cleanStringArray(source.artifactIds),
    sourceDocumentId: cleanString(source.sourceDocumentId),
    sourceSpecVersion: cleanString(source.sourceSpecVersion),
    approvalGateTaskId: cleanString(source.approvalGateTaskId),
    ...contentModelFields(resource, source),
  }) as BookStudioRecord
}

// Maps sanitized output keys back to the request-body keys (including aliases)
// that produce them, so PATCH only touches fields the client actually sent.
const PATCH_SOURCE_KEYS: Record<string, string[]> = {
  safeSummary: ['safeSummary', 'summary'],
  artifactLinks: ['artifactLinks', 'artifacts'],
  bridgeLinks: ['bridgeLinks', 'links'],
  href: ['href', 'url'],
  gates: ['gates', 'approvalGates'],
  rightsLedger: ['rightsLedger', 'rights'],
  packageManifest: ['packageManifest', 'manifest'],
  analyticsSnapshot: ['analyticsSnapshot', 'analytics'],
  publishingReadinessStatus: ['publishingReadinessStatus', 'readinessStatus'],
  clientDocumentIds: ['clientDocumentIds', 'documentIds'],
  projectTaskIds: ['projectTaskIds', 'taskIds'],
  wordCount: ['body'],
}

const PATCH_CLEARABLE_COMMON_KEYS = [
  'seriesId',
  'briefId',
  'packetId',
  'safeSummary',
  'nextAction',
  'description',
  'audience',
  'bookType',
  'artifactLinks',
  'bridgeLinks',
  'href',
  'gates',
  'rightsLedger',
  'metadata',
  'packageManifest',
  'analyticsSnapshot',
  'approvalState',
  'publishingReadinessStatus',
  'evidenceIds',
  'researchItemIds',
  'clientDocumentIds',
  'projectTaskIds',
  'artifactIds',
  'sourceDocumentId',
  'sourceSpecVersion',
  'approvalGateTaskId',
]

const PATCH_CLEARABLE_KEYS: Record<BookStudioResourceKey, string[]> = {
  projects: [
    ...PATCH_CLEARABLE_COMMON_KEYS,
    'format',
    'trim',
    'pageTarget',
    'stylePrompt',
    'creativeCanvasId',
    'seriesVolumeNumber',
    'coverImageUrl',
  ],
  briefs: PATCH_CLEARABLE_COMMON_KEYS,
  series: [...PATCH_CLEARABLE_COMMON_KEYS, 'volumeOrder', 'sharedMetadata', 'sharedStylePrompt'],
  'artifact-links': PATCH_CLEARABLE_COMMON_KEYS,
  'publishing-packets': PATCH_CLEARABLE_COMMON_KEYS,
  'rights-ledgers': PATCH_CLEARABLE_COMMON_KEYS,
  'package-manifests': PATCH_CLEARABLE_COMMON_KEYS,
  'analytics-imports': PATCH_CLEARABLE_COMMON_KEYS,
  'decision-logs': PATCH_CLEARABLE_COMMON_KEYS,
  chapters: [...PATCH_CLEARABLE_COMMON_KEYS, 'order', 'canvasRunId'],
  pages: [...PATCH_CLEARABLE_COMMON_KEYS, 'order', 'canvasRunId', 'kind', 'imageUrl', 'imageStoragePath', 'caption', 'prompt', 'puzzle'],
}

function isClearPatchValue(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '')
}

/**
 * Sanitizes a PATCH body: same whitelist/cleaning as create, but only fields
 * that were present in the request survive (no create-time defaults leak in),
 * and orgId/projectId can never be changed through a patch.
 */
export function sanitizeBookStudioRecordPatch(resource: BookStudioResourceKey, input: PlainRecord, orgId: string): PlainRecord {
  patchMode = true
  try {
    const sanitized = sanitizeBookStudioRecordInput(resource, input, orgId) as PlainRecord
    const source = stripForbidden(cleanObject(input)) as PlainRecord

    return Object.fromEntries(Object.entries(sanitized).filter(([key]) => {
      if (key === 'orgId' || key === 'projectId') return false
      const sourceKeys = PATCH_SOURCE_KEYS[key] ?? [key]
      return sourceKeys.some((sourceKey) => sourceKey in source)
    }))
  } finally {
    patchMode = false
  }
}

export function bookStudioPatchDeletes(
  resource: BookStudioResourceKey,
  input: PlainRecord,
  deleteValue: () => unknown,
): PlainRecord {
  const source = stripForbidden(cleanObject(input)) as PlainRecord
  const clearable = PATCH_CLEARABLE_KEYS[resource] ?? []
  return Object.fromEntries(clearable.flatMap((key) => {
    const sourceKeys = PATCH_SOURCE_KEYS[key] ?? [key]
    const shouldClear = sourceKeys.some((sourceKey) => sourceKey in source && isClearPatchValue(source[sourceKey]))
    return shouldClear ? [[key, deleteValue()]] : []
  }))
}

export function serializeBookStudioRecord(id: string, data: FirebaseFirestore.DocumentData): BookStudioRecord {
  const json = JSON.parse(JSON.stringify(stripForbidden(data))) as BookStudioRecord
  return { id, ...json }
}
