import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/api/auth'
import { routeActorLabel } from '@/lib/api/route-actor'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { resolveRouteOrgId } from '@/lib/api/org-scope-route'
import { handoffDesignIterationCardFromCreate } from '@/lib/design-iteration/iteration-card'
import {
  cleanDesignIterationVariant,
  type DesignIterationElementRef,
} from '@/lib/design-iteration/types'
import {
  createDesignIterationSession,
  listDesignIterationSessions,
} from '@/lib/design-iteration/store'

export const dynamic = 'force-dynamic'

const MAX_URL_LENGTH = 2_048
const MAX_INSTRUCTION_LENGTH = 2_000
const MAX_VARIANTS_PER_CREATE = 3

function cleanString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed && trimmed.length <= max ? trimmed : null
}

function cleanElementRefs(value: unknown): DesignIterationElementRef[] | null {
  if (value === undefined) return []
  if (!Array.isArray(value)) return null
  const out: DesignIterationElementRef[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const raw = item as Record<string, unknown>
    const ref = typeof raw.ref === 'string' ? raw.ref.trim().slice(0, 64) : ''
    if (!ref) continue
    out.push({
      ref,
      ...(typeof raw.role === 'string' && raw.role.trim() ? { role: raw.role.trim().slice(0, 120) } : {}),
      ...(typeof raw.name === 'string' && raw.name.trim() ? { name: raw.name.trim().slice(0, 200) } : {}),
    })
    if (out.length >= 20) break
  }
  return out
}

function sanitizeVariantUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) return null
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  if (parsed.username || parsed.password) return null
  return parsed.toString()
}

/**
 * POST /api/v1/design-iteration/sessions
 * Creates a "Design this page" iteration session (variant deck) for a live
 * URL. The agent supplies the baseline (url, instruction, element refs,
 * screenshot) and up to 3 archetype-distinct variants; the response carries
 * the Messages card presentation (richParts + uiActions + contextRef)
 * attached to the in-flight assistant message when handoff ids are supplied.
 */
export const POST = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const requestedOrgId = typeof body.orgId === 'string' && body.orgId.trim()
      ? body.orgId.trim()
      : (user.activeOrgId ?? user.orgId ?? null)
    const scope = resolveRouteOrgId(user, requestedOrgId)
    if (!scope.ok) return apiError(scope.error, scope.status)
    const orgId = scope.orgId

    const url = cleanString(body.url, MAX_URL_LENGTH)
    if (!url) return apiError('url is required', 400)
    if (!sanitizeVariantUrl(url)) return apiError('url must be an http(s) URL without embedded credentials', 400)

    const instruction = cleanString(body.instruction, MAX_INSTRUCTION_LENGTH)
    if (!instruction) return apiError('instruction is required (freeform or element pick)', 400)

    const title = body.title !== undefined ? cleanString(body.title, 500) : null
    if (body.title !== undefined && !title) return apiError('title must be a non-empty string', 400)

    const browserSessionId = body.browserSessionId !== undefined ? cleanString(body.browserSessionId, 200) : null
    if (body.browserSessionId !== undefined && !browserSessionId) return apiError('browserSessionId must be a non-empty string', 400)

    const screenshotUrl = body.screenshotUrl !== undefined ? sanitizeVariantUrl(body.screenshotUrl) : null
    if (body.screenshotUrl !== undefined && !screenshotUrl) return apiError('screenshotUrl must be an http(s) URL', 400)

    const elementRefs = cleanElementRefs(body.elementRefs)
    if (elementRefs === null) return apiError('elementRefs must be an array of { ref, role?, name? } objects', 400)

    const nowMs = Date.now()
    const variants = Array.isArray(body.variants)
      ? body.variants
        .map((variant, index) => cleanDesignIterationVariant(variant, nowMs, index))
        .filter((variant): variant is NonNullable<typeof variant> => Boolean(variant))
        .slice(0, MAX_VARIANTS_PER_CREATE)
      : []
    if (body.variants !== undefined && !Array.isArray(body.variants)) {
      return apiError('variants must be an array', 400)
    }

    const session = await createDesignIterationSession({
      orgId,
      url,
      ...(title ? { title } : {}),
      ...(browserSessionId ? { browserSessionId } : {}),
      ...(screenshotUrl ? { screenshotUrl } : {}),
      instruction,
      elementRefs,
      variants,
      createdBy: routeActorLabel(req.headers.get('x-agent-actor'), user),
      nowMs,
    })

    const presentation = await handoffDesignIterationCardFromCreate({
      orgId,
      body,
      session,
      label: `Design this page — ${url}`,
    })

    return apiSuccess({ session, presentation }, 201)
  } catch (err) {
    return apiErrorFromException(err)
  }
})

/**
 * GET /api/v1/design-iteration/sessions?limit=N
 * Lists the org's most recent design-iteration sessions (descending).
 */
export const GET = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  try {
    const url = new URL(req.url)
    const requestedOrgId = url.searchParams.get('orgId') ?? user.activeOrgId ?? user.orgId ?? null
    const scope = resolveRouteOrgId(user, requestedOrgId)
    if (!scope.ok) return apiError(scope.error, scope.status)
    const rawLimit = Number(url.searchParams.get('limit') ?? 20)
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 100) : 20
    const sessions = await listDesignIterationSessions(scope.orgId, limit)
    return apiSuccess({ sessions })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
