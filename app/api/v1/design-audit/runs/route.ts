import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/api/auth'
import { routeActorKind, routeActorLabel } from '@/lib/api/route-actor'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { resolveRouteOrgId } from '@/lib/api/org-scope-route'
import { handoffDesignAuditCardFromCreate } from '@/lib/design-audit/audit-card'
import { createDesignAuditRun, listDesignAuditRuns } from '@/lib/design-audit/audit-runs'
import {
  designAuditUrlRejectionReason,
  fetchDesignAuditPage,
  runDesignAuditForPage,
  sanitizeDesignAuditUrl,
} from '@/lib/design-audit/live-audit'
import type { DesignSystem } from '@/lib/design-audit/types'

export const dynamic = 'force-dynamic'

function cleanString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed && trimmed.length <= max ? trimmed : null
}

function cleanScope(value: unknown): 'all' | 'type' | 'layout' {
  return value === 'type' || value === 'layout' ? value : 'all'
}

function cleanStringArray(value: unknown, max = 100, maxItems = 50): string[] | null | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) return null
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (trimmed && trimmed.length <= max) out.push(trimmed)
    if (out.length >= maxItems) break
  }
  return out
}

function cleanComputedStyles(value: unknown): Record<string, Record<string, string>> | null | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const out: Record<string, Record<string, string>> = {}
  for (const [path, styles] of Object.entries(value as Record<string, unknown>)) {
    if (!path || path.length > 400) continue
    if (!styles || typeof styles !== 'object' || Array.isArray(styles)) continue
    const clean: Record<string, string> = {}
    for (const [prop, val] of Object.entries(styles as Record<string, unknown>)) {
      if (!prop || prop.length > 120) continue
      if (typeof val === 'string' && val.length <= 500) clean[prop] = val
    }
    if (Object.keys(clean).length) out[path] = clean
  }
  return out
}

function cleanDesignSystem(value: unknown): DesignSystem | null | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const rec = value as Record<string, unknown>
  const palette = Array.isArray(rec.palette)
    ? rec.palette.map((item) => typeof item === 'string' ? item.trim().toLowerCase() : '').filter((item) => item && item.length <= 40).slice(0, 100)
    : []
  const fonts = Array.isArray(rec.fonts)
    ? rec.fonts.map((item) => typeof item === 'string' ? item.trim() : '').filter((item) => item && item.length <= 200).slice(0, 50)
    : []
  const radii = Array.isArray(rec.radii)
    ? rec.radii.map((item) => typeof item === 'number' && Number.isFinite(item) ? item : typeof item === 'string' ? Number(item) : NaN).filter((item) => Number.isFinite(item) && item >= 0 && item <= 500).slice(0, 50)
    : []
  const fontSize = Array.isArray(rec.fontSize)
    ? rec.fontSize.map((item) => typeof item === 'number' && Number.isFinite(item) ? item : typeof item === 'string' ? Number(item) : NaN).filter((item) => Number.isFinite(item) && item >= 1 && item <= 400).slice(0, 50)
    : []
  if (palette.length === 0 && fonts.length === 0 && radii.length === 0 && fontSize.length === 0) return null
  return {
    palette,
    fonts,
    radii,
    fontSize,
    source: typeof rec.source === 'string' && rec.source.length <= 500 ? rec.source : 'design-context',
  }
}

/**
 * POST /api/v1/design-audit/runs
 * Creates a design audit run for a live URL: validates the URL (http/https,
 * private-network guarded, optional allowlist), fetches the page server-side
 * with strict caps, runs the T1 deterministic engine (with optional
 * browser-mode hooks), persists the org-scoped run, and returns the Messages
 * action card presentation (richParts + uiActions + contextRef) attached to
 * the in-flight assistant message when handoff ids are supplied.
 *
 * Tenant safety:
 * - orgId is resolved from the authenticated user context and validated via
 *   resolveRouteOrgId — a body-supplied orgId must pass canAccessOrg.
 * - Private-network fetching (`allowPrivateNetwork`) is a human-only grant:
 *   agent callers (X-Agent-Actor present) are rejected with 403, mirroring
 *   the workbench allow-private route.
 */
export const POST = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  try {
    const actorKind = routeActorKind(req.headers.get('x-agent-actor'))
    const body = await req.json().catch(() => ({})) as Record<string, unknown>

    const requestedOrgId = typeof body.orgId === 'string' && body.orgId.trim()
      ? body.orgId.trim()
      : (user.activeOrgId ?? user.orgId ?? null)
    const scope = resolveRouteOrgId(user, requestedOrgId)
    if (!scope.ok) return apiError(scope.error, scope.status)
    const orgId = scope.orgId

    const rawUrl = cleanString(body.url, 2_048)
    if (!rawUrl) return apiError('url is required', 400)
    const url = sanitizeDesignAuditUrl(rawUrl)
    if (!url) return apiError('url must be an http(s) URL without embedded credentials', 400)

    // B2: private-network access is a human grant only — an agent can never
    // self-grant it (mirrors the allow-private 403 precedent).
    const allowPrivateNetwork = body.allowPrivateNetwork === true
    if (allowPrivateNetwork && actorKind === 'agent') {
      return apiError('Only the human can grant private-network access to the agent', 403)
    }
    const allowHosts = cleanStringArray(body.allowHosts, 200, 50)
    if (allowHosts === null) return apiError('allowHosts must be an array of host strings', 400)
    const rejection = designAuditUrlRejectionReason(url, {
      allowPrivateNetwork,
      ...(allowHosts?.length ? { allowHosts } : {}),
    })
    if (rejection) return apiError(rejection, 400)

    const scopeValue = cleanScope(body.scope)
    const runtimeErrors = cleanStringArray(body.runtimeErrors, 500, 100)
    if (runtimeErrors === null) return apiError('runtimeErrors must be an array of strings', 400)
    const computedStyles = cleanComputedStyles(body.computedStyles)
    if (computedStyles === null) return apiError('computedStyles must be an object of element style maps', 400)
    const designSystem = cleanDesignSystem(body.designSystem)
    if (designSystem === null) return apiError('designSystem must be a palette/fonts/radii/fontSize object', 400)
    const screenshotUrl = body.screenshotUrl !== undefined ? sanitizeDesignAuditUrl(body.screenshotUrl) : undefined
    if (body.screenshotUrl !== undefined && !screenshotUrl) return apiError('screenshotUrl must be an http(s) URL without embedded credentials', 400)

    const fetchResult = await fetchDesignAuditPage(url, { policy: { allowPrivateNetwork, ...(allowHosts?.length ? { allowHosts } : {}) } })
    if (!fetchResult.ok) return apiError(fetchResult.error, 502)

    const result = runDesignAuditForPage(fetchResult.html, {
      scope: scopeValue,
      runtimeErrors,
      computedStyles,
      designSystem,
      fileName: 'live-url',
      maxFindingsPerRule: 50,
    })

    const run = await createDesignAuditRun({
      orgId,
      url,
      scope: scopeValue,
      result,
      ...(screenshotUrl ? { screenshotUrl } : {}),
      createdBy: routeActorLabel(req.headers.get('x-agent-actor'), user),
    })

    const presentation = await handoffDesignAuditCardFromCreate({
      orgId,
      body,
      run,
      label: `Design audit — ${url}`,
    })

    return apiSuccess({ run, presentation }, 201)
  } catch (err) {
    return apiErrorFromException(err)
  }
})

/**
 * GET /api/v1/design-audit/runs?orgId=...&limit=...
 * Lists the org's most recent design audit runs (descending). Org scope is
 * resolved from the authenticated user (query orgId must pass canAccessOrg).
 */
export const GET = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  try {
    const url = new URL(req.url)
    const requestedOrgId = url.searchParams.get('orgId') ?? user.activeOrgId ?? user.orgId ?? null
    const scope = resolveRouteOrgId(user, requestedOrgId)
    if (!scope.ok) return apiError(scope.error, scope.status)
    const rawLimit = Number(url.searchParams.get('limit') ?? 20)
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 100) : 20
    const runs = await listDesignAuditRuns(scope.orgId, limit)
    return apiSuccess({ runs })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
