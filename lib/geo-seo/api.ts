import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { apiError, apiSuccess } from '@/lib/api/response'
import { withAuth } from '@/lib/api/auth'
import { withIdempotency } from '@/lib/api/idempotency'
import { actorFrom, lastActorFrom } from '@/lib/api/actor'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import type { ApiUser } from '@/lib/api/types'

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
  return Boolean(value) && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype
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
  const body = await req.json().catch(() => ({}))
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
  })
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
    if (!org.ok) return org.response
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
    if (!org.ok) return org.response
    const missing = validateRequired(body, config.required)
    if (missing) return apiError(missing, 400)

    const payload = payloadFor(config, body)
    const ref = await adminDb.collection(config.collection).add({
      ...payload,
      orgId: org.orgId,
      deleted: false,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      ...actorFrom(user),
    })

    return apiSuccess({ id: ref.id }, 201)
  }))

  return { GET, POST }
}

export function createGeoSeoItemHandlers(config: GeoSeoCollectionConfig) {
  const GET = withAuth('admin', async (req: NextRequest, user: ApiUser, context?: { params?: Promise<{ id: string }> }) => {
    const org = resolveStrictGeoOrg(req, user)
    if (!org.ok) return org.response
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
    if (!org.ok) return org.response
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
