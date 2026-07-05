import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { getCreativeCanvas } from '@/lib/creative-canvas/store'
import { buildCreativeCanvasAgentTask } from '@/lib/creative-canvas/agent-bridge'
import {
  createCreativeCanvasRun,
  completeCreativeCanvasRun,
  appendCreativeCanvasRunOutputNode,
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
import { resolveCreativeProviderCredential } from '@/lib/creative-canvas/connections/resolve'
import type { CreativeCanvasActor } from '@/lib/creative-canvas/types'

// Providers whose runs can require a caller/org credential. agent_task and
// manual_upload never need one, so the resolver is skipped for them (it would
// wrongly return connection_required).
const CREDENTIAL_PROVIDERS = ['higgsfield', 'xai', 'google', 'fal', 'recraft']

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
    sourceNodeIds,
    model,
    prompt,
    aspectRatio,
    resolution,
    quality,
    duration,
    generateAudio,
    batch,
    referenceImageUrls,
  } = body as {
    nodeId?: string
    sourceNodeIds?: string[]
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

  // Resolve WHICH credential this run uses, once. BYOK (user/org key) bypasses
  // platform credits entirely; the shared platform path charges them as before.
  const needsCredentialResolution = CREDENTIAL_PROVIDERS.includes(m.providerKey)
  let byok = false
  let byokCredentials: Record<string, unknown> | undefined
  let byokConnectionId: string | undefined
  if (needsCredentialResolution) {
    const resolved = await resolveCreativeProviderCredential({ provider: m.providerKey, orgId, uid: user.uid })
    if (resolved.kind === 'connection_required') {
      return apiError(`Connect a ${m.providerKey} account in Creative providers to use this model`, 400)
    }
    if (resolved.kind === 'byok') {
      byok = true
      byokCredentials = resolved.credentials as Record<string, unknown>
      byokConnectionId = resolved.connection.id
    }
  }

  // Credit metering: blocks only when the org has a configured limit (default
  // limit is null → always allowed, so existing generation never regresses).
  // BYOK runs are the user's own key — they never touch platform credits.
  if (!byok) {
    const credits = await getCanvasCredits(orgId)
    if (!hasSufficientCredits(credits, m.creditCost)) {
      return apiError('Insufficient creative canvas credits', 402)
    }
  }

  const recordUsage = (runId: string, variantsGenerated: number) =>
    byok
      ? Promise.resolve(undefined)
      : recordCanvasCreditUsage(orgId, m.creditCost * Math.max(1, variantsGenerated), { runId, model: m.id }).catch(() => undefined)

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
      sourceNodeIds: Array.isArray(sourceNodeIds) && sourceNodeIds.length
        ? [...new Set([...(nodeId ? [nodeId] : []), ...sourceNodeIds.filter((value): value is string => typeof value === 'string')])]
        : nodeId ? [nodeId] : [],
      sourceArtifactIds: [],
      aspectRatio,
      outputKind: m.kind,
      durationSeconds: duration,
      variantCount: batch,
      ...(resolution ? { format: resolution } : {}),
      ...(typeof quality === 'string' && quality ? { quality } : {}),
      ...(typeof generateAudio === 'boolean' ? { generateAudio } : {}),
      ...(referenceUrls.length ? { referenceImageUrls: referenceUrls } : {}),
    },
    // Stamp BYOK provenance so run history / spend panel can tell the lanes
    // apart: byok runs cost 0 platform credits and carry a `byok:<provider>`
    // label + the connection id. Shared runs leave provenance to the sanitizer.
    ...(byok
      ? { provenance: { costUnits: 0, costLabel: `byok:${m.providerKey}`, ...(byokConnectionId ? { connectionId: byokConnectionId } : {}) } }
      : {}),
  }

  if (m.execution === 'sync') {
    let run: Awaited<ReturnType<typeof createCreativeCanvasRun>>
    try {
      run = await createCreativeCanvasRun(runPayload, orgId, actor)
    } catch (err) {
      return apiError(err instanceof Error ? err.message : 'Failed to create run', 500)
    }

    // Batch size for this sync run. Capped at 4 concurrent inline generations
    // per request regardless of the model's configured maxBatch, since each
    // variant is an independent provider call made serially here.
    const requestedVariantCount = run.input.variantCount ?? 1
    const variantCount = Math.max(1, Math.min(4, requestedVariantCount))

    type InlineResult = { url?: string; mimeType: string; text?: string }
    const results: InlineResult[] = []
    let firstError: unknown

    for (let index = 0; index < variantCount; index += 1) {
      try {
        const result = await generateInline({
          providerKey: m.providerKey,
          model: m.id,
          prompt: promptSummary ?? '',
          aspectRatio,
          ...(byok ? { credentials: byokCredentials } : {}),
        })
        results.push(result)
      } catch (err) {
        if (err instanceof InlineNotSupportedError) {
          // Inline not available for this provider — fall back to queued async run.
          // Only relevant on the first attempt; if it happens later something
          // is very wrong with the provider, but we still fall back safely.
          await recordUsage(run.id, 1)
          await dispatchCreativeCanvasRunNow(run, { uid: user.uid }).catch(() => undefined)
          const agentTaskDraft = buildCreativeCanvasAgentTask(run, canvas)
          return apiSuccess({ run, agentTaskDraft, pending: true }, 201)
        }
        // The inline layer throws Error('connection_required') when it can't
        // find a usable key mid-flight — surface it as a friendly 400, not a 500.
        if (err instanceof Error && err.message === 'connection_required') {
          return apiError(`Connect a ${m.providerKey} account in Creative providers to use this model`, 400)
        }
        firstError = err
        break
      }
    }

    if (!results.length) {
      return apiError(firstError instanceof Error ? firstError.message : 'Inline generation failed', 500)
    }

    const [primaryResult, ...extraResults] = results
    let completed: Awaited<ReturnType<typeof completeCreativeCanvasRun>>
    try {
      completed = await completeCreativeCanvasRun(
        run.id,
        orgId,
        {
          output: primaryResult.text
            // Text results carry the copy inline — there is no artifact URL.
            ? { kind: 'copy', textPreview: primaryResult.text }
            : { kind: m.kind, url: primaryResult.url },
        },
        actor,
      )
    } catch (err) {
      return apiError(err instanceof Error ? err.message : 'Failed to attach inline output', 500)
    }

    // Additional batch variants: attach sibling output nodes
    // (`${nodeId}-output-2`, `-3`, ...) without overwriting the run's primary
    // output. Best-effort — a failure to attach a variant node doesn't fail
    // the whole request since the primary output already completed.
    const extraNodes: Awaited<ReturnType<typeof appendCreativeCanvasRunOutputNode>>[] = []
    for (let i = 0; i < extraResults.length; i += 1) {
      const result = extraResults[i]
      const variantIndex = i + 2 // -output-2, -output-3, ...
      try {
        const node = await appendCreativeCanvasRunOutputNode(
          completed.run,
          orgId,
          result.text
            ? { kind: 'copy', textPreview: result.text }
            : { kind: m.kind, url: result.url },
          actor,
          `${run.nodeId}-output-${variantIndex}`,
          variantIndex - 1,
        )
        extraNodes.push(node)
      } catch {
        // Skip a variant node we couldn't attach; the successful ones remain.
      }
    }

    await recordUsage(run.id, results.length)
    return apiSuccess({
      run: completed.run,
      node: completed.outputNode,
      nodes: [completed.outputNode, ...extraNodes].filter(Boolean),
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
  await recordUsage(run.id, 1)
  // Kick the run to the Higgsfield runtime now instead of waiting for the cron.
  await dispatchCreativeCanvasRunNow(run, { uid: user.uid }).catch(() => undefined)
  const agentTaskDraft = buildCreativeCanvasAgentTask(run, canvas)
  return apiSuccess({ run, agentTaskDraft, pending: true }, 201)
})
