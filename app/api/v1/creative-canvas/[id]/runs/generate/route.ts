import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { getCreativeCanvas } from '@/lib/creative-canvas/store'
import { buildCreativeCanvasAgentTask } from '@/lib/creative-canvas/agent-bridge'
import {
  createCreativeCanvasRun,
  completeCreativeCanvasRun,
} from '@/lib/creative-canvas/runs'
import { getCanvasModel } from '@/lib/creative-canvas/model-registry'
import {
  getCanvasCredits,
  hasSufficientCredits,
  recordCanvasCreditUsage,
} from '@/lib/creative-canvas/credits'
import {
  generateInline,
  InlineNotSupportedError,
} from '@/lib/creative-canvas/inline-generation'
import { dispatchCreativeCanvasRunNow } from '@/lib/creative-canvas/provider-runtime'
import type { CreativeCanvasActor } from '@/lib/creative-canvas/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

function resolveOrgId(req: NextRequest, user: ApiUser): string | null {
  const url = new URL(req.url)
  return url.searchParams.get('orgId') ?? req.headers.get('x-org-id') ?? user.orgId ?? user.orgIds?.[0] ?? null
}

function actorFromUser(user: ApiUser): CreativeCanvasActor {
  return {
    uid: user.role === 'ai' && user.agentId ? `agent:${user.agentId}` : user.uid,
    type: user.role === 'ai' ? 'agent' : 'user',
  }
}

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser, context?: unknown) => {
  const { id } = await (context as RouteContext).params
  const orgId = resolveOrgId(req, user)
  if (!orgId) return apiError('orgId is required', 400)
  const canvas = await getCreativeCanvas(id, orgId)
  if (!canvas) return apiError('Creative canvas not found', 404)

  const body = await req.json().catch(() => null)
  if (!body) return apiError('Malformed JSON body', 400)

  const {
    nodeId,
    model,
    prompt,
    aspectRatio,
    resolution,
    duration,
    batch,
    referenceImageUrls,
  } = body as {
    nodeId?: string
    model?: string
    prompt?: string
    aspectRatio?: string
    resolution?: string
    quality?: string
    duration?: number
    generateAudio?: boolean
    batch?: number
    referenceImageUrls?: string[]
  }

  const referenceUrls = Array.isArray(referenceImageUrls)
    ? referenceImageUrls.filter((url): url is string => typeof url === 'string' && url.length > 0)
    : []

  const m = getCanvasModel(typeof model === 'string' ? model : '')
  if (!m) return apiError('Unknown creative canvas model', 400)

  // Credit metering: blocks only when the org has a configured limit (default
  // limit is null → always allowed, so existing generation never regresses).
  const credits = await getCanvasCredits(orgId)
  if (!hasSufficientCredits(credits, m.creditCost)) {
    return apiError('Insufficient creative canvas credits', 402)
  }

  const recordUsage = (runId: string) =>
    recordCanvasCreditUsage(orgId, m.creditCost, { runId, model: m.id }).catch(() => undefined)

  const actor = actorFromUser(user)
  const promptSummary = typeof prompt === 'string' ? prompt : undefined

  // Shared run-creation payload mirroring the create `/runs` route.
  const runPayload = {
    canvasId: id,
    nodeId,
    providerKey: m.providerKey,
    model: m.id,
    input: {
      promptSummary,
      sourceNodeIds: nodeId ? [nodeId] : [],
      sourceArtifactIds: [],
      aspectRatio,
      outputKind: m.kind,
      durationSeconds: duration,
      variantCount: batch,
      ...(resolution ? { format: resolution } : {}),
      ...(referenceUrls.length ? { referenceImageUrls: referenceUrls } : {}),
    },
  }

  if (m.execution === 'sync') {
    let inlineResult: { url?: string; mimeType: string; text?: string }
    let run: Awaited<ReturnType<typeof createCreativeCanvasRun>>
    try {
      run = await createCreativeCanvasRun(runPayload, orgId, actor)
    } catch (err) {
      return apiError(err instanceof Error ? err.message : 'Failed to create run', 500)
    }

    try {
      inlineResult = await generateInline({
        providerKey: m.providerKey,
        model: m.id,
        prompt: promptSummary ?? '',
        aspectRatio,
      })
    } catch (err) {
      if (err instanceof InlineNotSupportedError) {
        // Inline not available for this provider — fall back to queued async run.
        await recordUsage(run.id)
        // Kick the run to the Higgsfield runtime now instead of waiting for the cron.
        await dispatchCreativeCanvasRunNow(run).catch(() => undefined)
        const agentTaskDraft = buildCreativeCanvasAgentTask(run, canvas)
        return apiSuccess({ run, agentTaskDraft, pending: true }, 201)
      }
      return apiError(err instanceof Error ? err.message : 'Inline generation failed', 500)
    }

    let completed: Awaited<ReturnType<typeof completeCreativeCanvasRun>>
    try {
      completed = await completeCreativeCanvasRun(
        run.id,
        orgId,
        {
          output: inlineResult.text
            // Text results carry the copy inline — there is no artifact URL.
            ? { kind: 'copy', textPreview: inlineResult.text }
            : { kind: m.kind, url: inlineResult.url },
        },
        actor,
      )
    } catch (err) {
      return apiError(err instanceof Error ? err.message : 'Failed to attach inline output', 500)
    }

    await recordUsage(run.id)
    return apiSuccess({
      run: completed.run,
      node: completed.outputNode,
      pending: false,
    })
  }

  // Async provider — queue the run exactly like the create `/runs` route.
  let run: Awaited<ReturnType<typeof createCreativeCanvasRun>>
  try {
    run = await createCreativeCanvasRun(runPayload, orgId, actor)
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to create run', 500)
  }
  await recordUsage(run.id)
  // Kick the run to the Higgsfield runtime now instead of waiting for the cron.
  await dispatchCreativeCanvasRunNow(run).catch(() => undefined)
  const agentTaskDraft = buildCreativeCanvasAgentTask(run, canvas)
  return apiSuccess({ run, agentTaskDraft, pending: true }, 201)
})
