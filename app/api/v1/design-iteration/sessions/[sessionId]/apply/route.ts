import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/api/auth'
import { routeActorLabel } from '@/lib/api/route-actor'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { resolveRouteOrgId } from '@/lib/api/org-scope-route'
import { applyDesignIteration } from '@/lib/design-iteration/store'

export const dynamic = 'force-dynamic'

function cleanString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed && trimmed.length <= max ? trimmed : null
}

function cleanStringArray(value: unknown, max = 500, maxItems = 200): string[] | null {
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

/**
 * POST /api/v1/design-iteration/sessions/[sessionId]/apply
 * Records the repo write after an explicit Accept. The agent writes the
 * change to the approved repo (development branch only), runs the T1
 * detector, and posts the evidence here: repo, branch, files changed, diff
 * summary, detector exit code + finding count. The route refuses to apply
 * when no variant has been accepted — repo writes happen only after an
 * explicit human Accept. OrgId is resolved from auth + validated;
 * X-Agent-Actor is forwarded into the apply record.
 */
export const POST = withAuth('client', async (req: NextRequest, user: ApiUser, ctx?: unknown) => {
  try {
    const params = await (ctx as { params: Promise<{ sessionId: string }> }).params
    const sessionId = params.sessionId.trim()
    if (!sessionId) return apiError('sessionId is required', 400)

    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const requestedOrgId = typeof body.orgId === 'string' && body.orgId.trim()
      ? body.orgId.trim()
      : (user.activeOrgId ?? user.orgId ?? null)
    const scope = resolveRouteOrgId(user, requestedOrgId)
    if (!scope.ok) return apiError(scope.error, scope.status)
    const orgId = scope.orgId

    const repo = cleanString(body.repo, 300)
    const branch = cleanString(body.branch, 120)
    const diffSummary = cleanString(body.diffSummary, 4_000)
    if (!repo || !branch || !diffSummary) {
      return apiError('repo, branch, and diffSummary are required', 400)
    }
    if (branch === 'main' || branch === 'master') {
      return apiError('apply records are development-branch only — refusing production branch', 400)
    }
    const commitSha = body.commitSha !== undefined ? cleanString(body.commitSha, 100) : null
    if (body.commitSha !== undefined && !commitSha) return apiError('commitSha must be a non-empty string', 400)
    const filesChanged = cleanStringArray(body.filesChanged)
    if (filesChanged === null) return apiError('filesChanged must be an array of file path strings', 400)

    let detectorExitCode: number | null | undefined
    if (body.detectorExitCode !== undefined) {
      if (body.detectorExitCode === null) {
        detectorExitCode = null
      } else if (body.detectorExitCode === 0 || body.detectorExitCode === 1 || body.detectorExitCode === 2) {
        detectorExitCode = body.detectorExitCode as number
      } else {
        return apiError('detectorExitCode must be 0, 1, 2, or null', 400)
      }
    }
    let detectorFindings: number | undefined
    if (body.detectorFindings !== undefined) {
      if (typeof body.detectorFindings !== 'number' || !Number.isFinite(body.detectorFindings) || body.detectorFindings < 0 || body.detectorFindings > 10_000) {
        return apiError('detectorFindings must be a non-negative number', 400)
      }
      detectorFindings = Math.trunc(body.detectorFindings)
    }
    const detectorSummary = body.detectorSummary !== undefined ? cleanString(body.detectorSummary, 2_000) : null
    if (body.detectorSummary !== undefined && !detectorSummary) return apiError('detectorSummary must be a non-empty string', 400)

    const session = await applyDesignIteration({
      orgId,
      sessionId,
      apply: {
        repo,
        branch,
        ...(commitSha ? { commitSha } : {}),
        filesChanged,
        diffSummary,
        ...(detectorExitCode !== undefined ? { detectorExitCode } : {}),
        ...(detectorFindings !== undefined ? { detectorFindings } : {}),
        ...(detectorSummary ? { detectorSummary } : {}),
        appliedAtMs: Date.now(),
        appliedBy: routeActorLabel(req.headers.get('x-agent-actor'), user),
      },
    })
    if (!session) return apiError('Design iteration session not found (or no variant accepted yet)', 409)
    return apiSuccess({ session }, 200)
  } catch (err) {
    return apiErrorFromException(err)
  }
})
