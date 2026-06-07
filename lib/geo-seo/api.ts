import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { apiError, apiSuccess } from '@/lib/api/response'
import { withAuth } from '@/lib/api/auth'
import { withIdempotency } from '@/lib/api/idempotency'
import { actorFrom, lastActorFrom } from '@/lib/api/actor'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import type { ApiUser } from '@/lib/api/types'
import { buildProjectTaskCreateData } from '@/lib/projects/taskPayload'

export type GeoSeoCollectionConfig = {
  collection: string
  required: string[]
  defaults?: Record<string, unknown>
}

const WORKSPACE_STATUSES = new Set(['active', 'paused', 'archived'])
const WORKSPACE_MODES = new Set(['audit_only', 'foundation_sprint', 'monitoring', 'combined_growth_search'])

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => stripUndefined(item)) as T
  if (!isPlainRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .map(([key, entryValue]) => [key, stripUndefined(entryValue)]),
  ) as T
}

function normalizeDomain(siteUrl: string): string {
  try {
    const host = new URL(siteUrl).hostname.toLowerCase()
    return host.startsWith('www.') ? host.slice(4) : host
  } catch {
    return ''
  }
}

function createdAtMillis(value: unknown): number {
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  if (typeof value === 'object') {
    const source = value as { toMillis?: () => number; seconds?: number; _seconds?: number }
    if (typeof source.toMillis === 'function') return source.toMillis()
    const seconds = source.seconds ?? source._seconds
    if (typeof seconds === 'number') return seconds * 1000
  }
  return 0
}

async function parseBody(req: NextRequest): Promise<Record<string, unknown>> {
  let body: unknown = {}
  try {
    body = await req.clone().json()
  } catch {
    try {
      const text = await req.clone().text()
      body = text ? JSON.parse(text) : {}
    } catch {
      body = {}
    }
  }
  return isPlainRecord(body) ? body : {}
}

export function resolveStrictGeoOrg(req: NextRequest, user: ApiUser, body?: Record<string, unknown>): { ok: true; orgId: string } | { ok: false; response: Response } {
  const headerOrgId = cleanString(req.headers.get('x-org-id'))
  if (!headerOrgId) return { ok: false, response: apiError('X-Org-Id header is required for GEO SEO routes', 400) }

  const url = new URL(req.url)
  const queryOrgId = cleanString(url.searchParams.get('orgId'))
  if (queryOrgId && queryOrgId !== headerOrgId) {
    return { ok: false, response: apiError('X-Org-Id must match orgId query for GEO SEO routes', 400) }
  }

  const bodyOrgId = cleanString(body?.orgId)
  if (bodyOrgId && bodyOrgId !== headerOrgId) {
    return { ok: false, response: apiError('X-Org-Id must match body orgId for GEO SEO routes', 400) }
  }

  if (!canAccessOrg(user, headerOrgId)) return { ok: false, response: apiError('Forbidden', 403) }
  return { ok: true, orgId: headerOrgId }
}

function validateRequired(body: Record<string, unknown>, fields: string[]): string | null {
  for (const field of fields) {
    const value = body[field]
    if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) return `${field} is required`
  }
  return null
}

function geoMetadata(body: Record<string, unknown>) {
  return stripUndefined({
    clientOrgId: cleanString(body.clientOrgId) || undefined,
    recipientOrgId: cleanString(body.recipientOrgId) || cleanString(body.clientOrgId) || undefined,
    companyId: cleanString(body.companyId) || undefined,
    sourceCompanyId: cleanString(body.sourceCompanyId) || cleanString(body.companyId) || undefined,
    sourceCompanyName: cleanString(body.sourceCompanyName) || undefined,
    sourceDocumentId: cleanString(body.sourceDocumentId) || undefined,
    sourceSpecVersion: cleanString(body.sourceSpecVersion) || undefined,
    approvalGateTaskId: cleanString(body.approvalGateTaskId) || undefined,
    projectId: cleanString(body.projectId) || undefined,
    sourceDocumentSectionId: cleanString(body.sourceDocumentSectionId) || undefined,
    riskLevel: cleanString(body.riskLevel) || undefined,
    requiredCapability: cleanString(body.requiredCapability) || undefined,
    reviewerAgentId: cleanString(body.reviewerAgentId) || undefined,
    expectedArtifacts: Array.isArray(body.expectedArtifacts)
      ? body.expectedArtifacts.map(cleanString).filter(Boolean)
      : undefined,
  })
}


const CLASSIC_SEO_CATEGORIES = new Set([
  'crawlability',
  'indexability',
  'technical',
  'technical_seo',
  'pagespeed',
  'core_web_vitals',
  'schema',
  'content',
  'keyword',
  'keywords',
  'backlink',
  'backlinks',
])

const CLASSIC_SEO_METRIC_RE = /\b(rankings?|clicks?|impressions?|keywords?|organic traffic|gsc|bing|indexability|indexed|crawlability|crawl budget|core web vitals|cwv|page ?speed|backlinks?)\b/i

function requestedProjectTask(body: Record<string, unknown>): boolean {
  return body.createProjectTask === true || isPlainRecord(body.projectTask)
}

function requestedSeoBridge(body: Record<string, unknown>): boolean {
  return body.createSeoSprintTask === true || body.bridgeToSeoSprint === true || isPlainRecord(body.seoBridge)
}

function fieldFrom(source: Record<string, unknown> | undefined, key: string): unknown {
  return source && key in source ? source[key] : undefined
}

function seoBridgeSource(body: Record<string, unknown>): Record<string, unknown> {
  return isPlainRecord(body.seoBridge) ? body.seoBridge : {}
}

function projectTaskSource(body: Record<string, unknown>): Record<string, unknown> {
  return isPlainRecord(body.projectTask) ? body.projectTask : {}
}

function cleanStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map(cleanString).filter(Boolean)))
}

function classicSeoBridgeCriteria(body: Record<string, unknown>): boolean {
  const bridge = seoBridgeSource(body)
  if (bridge.classicSeo === true || body.classicSeo === true) return true
  const category = cleanString(body.category).toLowerCase()
  if (category && CLASSIC_SEO_CATEGORIES.has(category)) return true
  const taskType = cleanString(fieldFrom(bridge, 'taskType') ?? body.taskType).toLowerCase()
  if (taskType && CLASSIC_SEO_CATEGORIES.has(taskType)) return true
  const metricText = [
    body.successMetric,
    body.successMetrics,
    body.recommendation,
    body.description,
    fieldFrom(bridge, 'successMetric'),
    fieldFrom(bridge, 'successMetrics'),
  ]
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .map((value) => typeof value === 'string' ? value : '')
    .join(' ')
  return CLASSIC_SEO_METRIC_RE.test(metricText)
}

async function workspaceFor(body: Record<string, unknown>, orgId: string): Promise<Record<string, unknown> | null> {
  const workspaceId = cleanString(body.workspaceId)
  if (!workspaceId) return null
  const snap = await adminDb.collection('geo_workspaces').doc(workspaceId).get()
  if (!snap.exists) return null
  const data = snap.data() ?? {}
  if (data.orgId !== orgId || data.deleted === true) return null
  return { id: workspaceId, ...data }
}

function sourceLinkage(body: Record<string, unknown>, findingId: string, workspace?: Record<string, unknown> | null) {
  return stripUndefined({
    sourceDocumentId: cleanString(body.sourceDocumentId) || cleanString(workspace?.sourceDocumentId) || undefined,
    sourceDocumentSectionId: cleanString(body.sourceDocumentSectionId) || undefined,
    sourceSpecVersion: cleanString(body.sourceSpecVersion) || cleanString(workspace?.sourceSpecVersion) || undefined,
    approvalGateTaskId: cleanString(body.approvalGateTaskId) || cleanString(workspace?.approvalGateTaskId) || undefined,
    sourceResearchItemId: cleanString(body.sourceResearchItemId) || undefined,
    geoWorkspaceId: cleanString(body.workspaceId) || cleanString(workspace?.id) || undefined,
    geoAuditId: cleanString(body.auditId) || cleanString(body.sourceAuditId) || undefined,
    geoFindingId: findingId,
    seoSprintId: cleanString(body.seoSprintId) || cleanString(body.linkedSeoSprintId) || cleanString(workspace?.linkedSeoSprintId) || undefined,
    riskLevel: cleanString(body.riskLevel) || undefined,
    requiredCapability: cleanString(body.requiredCapability) || undefined,
    requestedByAgentId: cleanString(body.requestedByAgentId) || undefined,
    expectedArtifacts: cleanStringList(body.expectedArtifacts).length ? cleanStringList(body.expectedArtifacts) : undefined,
  })
}

async function createLinkedSeoTask(args: {
  body: Record<string, unknown>
  orgId: string
  findingId: string
  findingRef: FirebaseFirestore.DocumentReference
  user: ApiUser
  workspace?: Record<string, unknown> | null
}): Promise<string | null | Response> {
  if (!requestedSeoBridge(args.body)) return null
  if (!classicSeoBridgeCriteria(args.body)) {
    return apiError('GEO findings may bridge to SEO Sprint Manager only for classic SEO remediation criteria: rankings, clicks, impressions, keyword movement, organic traffic, technical crawlability, indexability, GSC/Bing/PageSpeed, or backlink execution.', 400)
  }
  const bridge = seoBridgeSource(args.body)
  const sprintId = cleanString(fieldFrom(bridge, 'seoSprintId'))
    || cleanString(args.body.seoSprintId)
    || cleanString(args.body.linkedSeoSprintId)
    || cleanString(args.workspace?.linkedSeoSprintId)
  if (!sprintId) return apiError('seoSprintId is required when bridgeToSeoSprint is requested for a GEO finding', 400)
  const sprintSnap = await adminDb.collection('seo_sprints').doc(sprintId).get()
  if (!sprintSnap.exists) return apiError('Linked SEO sprint not found', 404)
  const sprint = sprintSnap.data() ?? {}
  if (sprint.orgId !== args.orgId || sprint.deleted === true) return apiError('Linked SEO sprint not found', 404)

  const linkage = sourceLinkage(args.body, args.findingId, args.workspace)
  const ref = adminDb.collection('seo_tasks').doc()
  await ref.set(stripUndefined({
    orgId: args.orgId,
    sprintId,
    week: typeof fieldFrom(bridge, 'week') === 'number' ? fieldFrom(bridge, 'week') : 1,
    phase: fieldFrom(bridge, 'phase') ?? 4,
    focus: cleanString(fieldFrom(bridge, 'focus')) || 'GEO bridge remediation',
    title: cleanString(fieldFrom(bridge, 'title')) || cleanString(args.body.title) || `SEO remediation for GEO finding ${args.findingId}`,
    description: cleanString(fieldFrom(bridge, 'description')) || cleanString(args.body.recommendation) || cleanString(args.body.description),
    taskType: cleanString(fieldFrom(bridge, 'taskType')) || cleanString(args.body.taskType) || 'geo-seo-remediation',
    autopilotEligible: fieldFrom(bridge, 'autopilotEligible') === true,
    status: 'not_started',
    source: 'geo_finding',
    geoWorkspaceId: linkage.geoWorkspaceId,
    geoAuditId: linkage.geoAuditId,
    geoFindingId: args.findingId,
    sourceDocumentId: linkage.sourceDocumentId,
    sourceDocumentSectionId: linkage.sourceDocumentSectionId,
    sourceSpecVersion: linkage.sourceSpecVersion,
    approvalGateTaskId: linkage.approvalGateTaskId,
    riskLevel: linkage.riskLevel,
    requiredCapability: linkage.requiredCapability || 'seo',
    reviewerAgentId: cleanString(args.body.reviewerAgentId) || 'qa-release',
    expectedArtifacts: linkage.expectedArtifacts || ['seo_task_update', 'evidence_link'],
    deleted: false,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    ...actorFrom(args.user),
  }))
  await args.findingRef.set({ linkedSeoTaskId: ref.id, seoSprintId: sprintId, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  return ref.id
}

async function createLinkedProjectTask(args: {
  body: Record<string, unknown>
  orgId: string
  findingId: string
  findingRef: FirebaseFirestore.DocumentReference
  user: ApiUser
  workspace?: Record<string, unknown> | null
  linkedSeoTaskId?: string | null
}): Promise<string | null | Response> {
  if (!requestedProjectTask(args.body)) return null
  const taskInput = projectTaskSource(args.body)
  const projectId = cleanString(fieldFrom(taskInput, 'projectId'))
    || cleanString(args.body.projectId)
    || cleanString(args.workspace?.projectId)
  if (!projectId) return apiError('projectId is required when createProjectTask is requested for a GEO finding', 400)

  const linkage = sourceLinkage(args.body, args.findingId, args.workspace)
  const title = cleanString(fieldFrom(taskInput, 'title')) || cleanString(args.body.title) || `Resolve GEO finding ${args.findingId}`
  const description = cleanString(fieldFrom(taskInput, 'description'))
    || cleanString(args.body.recommendation)
    || cleanString(args.body.description)
    || 'Resolve the linked GEO SEO finding and attach evidence.'
  const existingAgentInput = isPlainRecord(fieldFrom(taskInput, 'agentInput'))
    ? fieldFrom(taskInput, 'agentInput') as Record<string, unknown>
    : {}
  const existingContext = isPlainRecord(existingAgentInput.context) ? existingAgentInput.context : {}
  const payload = {
    ...taskInput,
    title,
    description,
    priority: cleanString(fieldFrom(taskInput, 'priority')) || cleanString(args.body.priority) || 'medium',
    labels: Array.from(new Set([
      'geo-seo',
      'geo-finding',
      ...cleanStringList(fieldFrom(taskInput, 'labels')),
    ])),
    assigneeAgentId: cleanString(fieldFrom(taskInput, 'assigneeAgentId')) || cleanString(args.body.assigneeAgentId) || 'seo',
    reviewerAgentId: cleanString(fieldFrom(taskInput, 'reviewerAgentId')) || cleanString(args.body.reviewerAgentId) || 'qa-release',
    riskLevel: cleanString(fieldFrom(taskInput, 'riskLevel')) || cleanString(linkage.riskLevel) || 'medium',
    requiredCapability: cleanString(fieldFrom(taskInput, 'requiredCapability')) || cleanString(linkage.requiredCapability) || 'geo_seo',
    expectedArtifacts: cleanStringList(fieldFrom(taskInput, 'expectedArtifacts')).length
      ? cleanStringList(fieldFrom(taskInput, 'expectedArtifacts'))
      : (Array.isArray(linkage.expectedArtifacts) ? linkage.expectedArtifacts : ['geo_record_update', 'evidence_link', 'completion_note']),
    ...linkage,
    ...(args.linkedSeoTaskId ? { linkedSeoTaskId: args.linkedSeoTaskId, seoTaskId: args.linkedSeoTaskId } : {}),
    agentInput: {
      ...existingAgentInput,
      spec: cleanString(existingAgentInput.spec) || description,
      context: {
        ...existingContext,
        ...linkage,
        ...(args.linkedSeoTaskId ? { linkedSeoTaskId: args.linkedSeoTaskId, seoTaskId: args.linkedSeoTaskId } : {}),
      },
    },
  }
  const built = buildProjectTaskCreateData(payload, projectId, args.orgId)
  if (!built.ok) return apiError(built.error, built.status ?? 400)
  const ref = adminDb.collection('projects').doc(projectId).collection('tasks').doc()
  await ref.set({
    ...built.value,
    reporterId: args.user.uid,
    createdBy: args.user.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })
  await args.findingRef.set({ projectTaskId: ref.id, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  return ref.id
}

function workspacePayload(body: Record<string, unknown>) {
  const siteUrl = cleanString(body.siteUrl)
  const status = cleanString(body.status) || 'active'
  const mode = cleanString(body.mode) || 'audit_only'
  return stripUndefined({
    ...geoMetadata(body),
    siteUrl,
    siteName: cleanString(body.siteName),
    domain: normalizeDomain(siteUrl),
    status: WORKSPACE_STATUSES.has(status) ? status : 'active',
    mode: WORKSPACE_MODES.has(mode) ? mode : 'audit_only',
    currentGeoScore: typeof body.currentGeoScore === 'number' ? body.currentGeoScore : null,
    previousGeoScore: typeof body.previousGeoScore === 'number' ? body.previousGeoScore : null,
    lastAuditAt: body.lastAuditAt ?? null,
    nextAuditAt: body.nextAuditAt ?? null,
    linkedSeoSprintId: cleanString(body.linkedSeoSprintId) || undefined,
    latestAuditId: cleanString(body.latestAuditId) || undefined,
    latestReportId: cleanString(body.latestReportId) || undefined,
    visibility: cleanString(body.visibility) || 'internal',
  })
}

function genericPayload(body: Record<string, unknown>, config: GeoSeoCollectionConfig) {
  const allowed: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body)) {
    if (['id', 'orgId', 'deleted', 'createdAt', 'updatedAt', 'createdBy', 'createdByType', 'updatedBy', 'updatedByType'].includes(key)) continue
    allowed[key] = value
  }
  return stripUndefined({ ...config.defaults, ...geoMetadata(body), ...allowed })
}

function payloadFor(config: GeoSeoCollectionConfig, body: Record<string, unknown>) {
  return config.collection === 'geo_workspaces' ? workspacePayload(body) : genericPayload(body, config)
}

export function createGeoSeoCollectionHandlers(config: GeoSeoCollectionConfig) {
  const GET = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
    const org = resolveStrictGeoOrg(req, user)
    if (org.ok === false) return org.response
    const { searchParams } = new URL(req.url)
    const workspaceId = cleanString(searchParams.get('workspaceId'))
    const auditId = cleanString(searchParams.get('auditId'))
    const status = cleanString(searchParams.get('status'))

    // Keep Firestore queries index-light: tenant query only, then in-memory filters.
    const snap = await adminDb.collection(config.collection).where('orgId', '==', org.orgId).get()
    const data = snap.docs
      .map((doc: { id: string; data: () => Record<string, unknown> }) => ({ id: doc.id, ...doc.data() }))
      .filter((item: Record<string, unknown>) => item.deleted !== true)
      .filter((item: Record<string, unknown>) => !workspaceId || item.workspaceId === workspaceId)
      .filter((item: Record<string, unknown>) => !auditId || item.auditId === auditId)
      .filter((item: Record<string, unknown>) => !status || item.status === status)
      .sort((a: Record<string, unknown>, b: Record<string, unknown>) => createdAtMillis(b.createdAt) - createdAtMillis(a.createdAt))

    return apiSuccess(data, 200, { total: data.length, page: 1, limit: data.length })
  })

  const POST = withAuth('admin', withIdempotency(async (req: NextRequest, user: ApiUser) => {
    const body = await parseBody(req)
    const org = resolveStrictGeoOrg(req, user, body)
    if (org.ok === false) return org.response
    const missing = validateRequired(body, config.required)
    if (missing) return apiError(missing, 400)

    const workspace = config.collection === 'geo_findings' ? await workspaceFor(body, org.orgId) : null
    const seoBridgePreflight = config.collection === 'geo_findings' && requestedSeoBridge(body) && !classicSeoBridgeCriteria(body)
    if (seoBridgePreflight) {
      return apiError('GEO findings may bridge to SEO Sprint Manager only for classic SEO remediation criteria: rankings, clicks, impressions, keyword movement, organic traffic, technical crawlability, indexability, GSC/Bing/PageSpeed, or backlink execution.', 400)
    }

    const payload = payloadFor(config, body)
    const ref = await adminDb.collection(config.collection).add({
      ...payload,
      orgId: org.orgId,
      deleted: false,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      ...actorFrom(user),
    })

    let linkedSeoTaskId: string | null = null
    let projectTaskId: string | null = null
    if (config.collection === 'geo_findings') {
      const seoTaskResult = await createLinkedSeoTask({ body, orgId: org.orgId, findingId: ref.id, findingRef: ref, user, workspace })
      if (seoTaskResult instanceof Response) return seoTaskResult
      linkedSeoTaskId = seoTaskResult
      const projectTaskResult = await createLinkedProjectTask({ body, orgId: org.orgId, findingId: ref.id, findingRef: ref, user, workspace, linkedSeoTaskId })
      if (projectTaskResult instanceof Response) return projectTaskResult
      projectTaskId = projectTaskResult
    }

    return apiSuccess(
      config.collection === 'geo_findings'
        ? stripUndefined({ id: ref.id, linkedSeoTaskId: linkedSeoTaskId ?? undefined, projectTaskId: projectTaskId ?? undefined })
        : { id: ref.id },
      201,
    )
  }))

  return { GET, POST }
}

export function createGeoSeoItemHandlers(config: GeoSeoCollectionConfig) {
  const GET = withAuth('admin', async (req: NextRequest, user: ApiUser, context?: { params?: Promise<{ id: string }> }) => {
    const org = resolveStrictGeoOrg(req, user)
    if (org.ok === false) return org.response
    const id = cleanString((await context?.params)?.id)
    if (!id) return apiError('id is required', 400)
    const snap = await adminDb.collection(config.collection).doc(id).get()
    if (!snap.exists) return apiError('GEO SEO record not found', 404)
    const data = snap.data() ?? {}
    if (data.orgId !== org.orgId || data.deleted === true) return apiError('GEO SEO record not found', 404)
    return apiSuccess({ id, ...data })
  })

  const PATCH = withAuth('admin', async (req: NextRequest, user: ApiUser, context?: { params?: Promise<{ id: string }> }) => {
    const body = await parseBody(req)
    const org = resolveStrictGeoOrg(req, user, body)
    if (org.ok === false) return org.response
    const id = cleanString((await context?.params)?.id)
    if (!id) return apiError('id is required', 400)

    const ref = adminDb.collection(config.collection).doc(id)
    const snap = await ref.get()
    if (!snap.exists) return apiError('GEO SEO record not found', 404)
    const existing = snap.data() ?? {}
    if (existing.orgId !== org.orgId || existing.deleted === true) return apiError('GEO SEO record not found', 404)

    const patch = payloadFor(config, body)
    await ref.update({
      ...patch,
      orgId: org.orgId,
      ...lastActorFrom(user),
    })
    return apiSuccess({ id })
  })

  return { GET, PATCH }
}

export const geoSeoConfigs = {
  workspaces: { collection: 'geo_workspaces', required: ['siteUrl', 'siteName'] },
  audits: { collection: 'geo_audits', required: ['workspaceId', 'auditType'], defaults: { status: 'draft' } },
  findings: { collection: 'geo_findings', required: ['workspaceId', 'title'], defaults: { status: 'open', severity: 'medium' } },
  scoreHistory: { collection: 'geo_score_history', required: ['workspaceId', 'score'] },
  reports: { collection: 'geo_reports', required: ['workspaceId', 'type', 'title'], defaults: { status: 'draft', visibility: 'internal' } },
  checkRuns: { collection: 'geo_check_runs', required: ['workspaceId', 'checkType'], defaults: { status: 'queued' } },
} satisfies Record<string, GeoSeoCollectionConfig>
