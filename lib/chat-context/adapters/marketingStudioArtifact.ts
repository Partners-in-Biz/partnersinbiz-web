import { adminDb } from '@/lib/firebase/admin'
import type { ApiRole } from '@/lib/api/types'
import type { ChatContextAdapter } from '@/lib/chat-context/access'
import type { ChatArtifactSummary, ChatContextReadModel, ContextAttentionSummary, ContextDisplayState } from '@/lib/chat-context/types'
import { marketingCanvasContextId, parseMarketingCanvasContextId } from '@/lib/chat-context/marketingCanvasIdentity'
import { buildCreativeCanvasAssetGallery } from '@/lib/creative-canvas/assets'
import { listCreativeCanvasVersions } from '@/lib/creative-canvas/collaboration'
import { getCanvasCredits, type CanvasCreditState } from '@/lib/creative-canvas/credits'
import { listCreativeCanvasRuns } from '@/lib/creative-canvas/runs'
import { CREATIVE_CANVAS_COLLECTION, getCreativeCanvas } from '@/lib/creative-canvas/store'
import type { CreativeCanvas, CreativeCanvasExport, CreativeCanvasRun, CreativeCanvasVersion } from '@/lib/creative-canvas/types'

type StoredExport = Pick<CreativeCanvasExport, 'nodeId' | 'status'> & { id: string; target?: CreativeCanvasExport['target']; createdAt?: unknown }

function dateString(value: unknown): string | undefined {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : undefined
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString()
  if (value && typeof value === 'object') {
    try { return (value as { toDate?: () => Date }).toDate?.().toISOString() } catch { return undefined }
  }
  return undefined
}

function label(value: string): string {
  return value.replace(/_/g, ' ').replace(/^./, (character) => character.toUpperCase())
}

function canvasState(status: CreativeCanvas['status']): ContextDisplayState {
  if (status === 'approved') return 'complete'
  if (status === 'archived') return 'archived'
  if (status === 'internal_review' || status === 'client_review') return 'review'
  return 'ready'
}

function outputArtifactKind(kind?: string): ChatArtifactSummary['artifactKind'] {
  if (kind === 'image' || kind === 'video' || kind === 'audio') return kind
  if (kind === 'copy' || kind === 'caption' || kind === 'blog_draft' || kind === 'document_block' || kind === 'book_artifact' || kind === 'social_post_draft') return 'document'
  if (kind === 'youtube_render') return 'video'
  if (kind === 'campaign_asset') return 'image'
  return 'collection'
}

function previewKind(kind?: string, url?: string, text?: string): NonNullable<ChatArtifactSummary['preview']>['kind'] {
  if (kind === 'image' || kind === 'video' || kind === 'audio') return kind
  if (kind === 'youtube_render') return url ? 'video' : text ? 'text' : 'none'
  if (kind === 'campaign_asset') return url ? 'image' : text ? 'text' : 'none'
  if (kind === 'copy' || kind === 'caption' || kind === 'blog_draft' || kind === 'document_block' || kind === 'book_artifact' || kind === 'social_post_draft') return url ? 'document' : 'text'
  return 'none'
}

function mutationHref(path: string, orgId: string): string {
  return `${path}?${new URLSearchParams({ orgId }).toString()}`
}

function exactHref(canvasId: string, orgId: string, role: ApiRole): string {
  const base = role === 'client' ? '/portal/creative-canvas' : '/admin/creative-canvas'
  const query = new URLSearchParams({ canvasId, orgId })
  return `${base}?${query.toString()}`
}

function runState(status: CreativeCanvasRun['status']): ContextDisplayState {
  if (status === 'queued') return 'waiting'
  if (status === 'running') return 'running'
  if (status === 'waiting_for_review') return 'review'
  if (status === 'completed') return 'ready'
  if (status === 'failed') return 'blocked'
  return 'archived'
}

function canOfferReviewActions(canvas: CreativeCanvas, node: CreativeCanvas['nodes'][number], role: ApiRole): boolean {
  const review = node.review
  if (!review || (canvas.status !== 'internal_review' && canvas.status !== 'client_review')) return false
  if (review.status === 'blocked' || review.rightsStatus === 'blocked' || review.brandStatus === 'blocked') return false
  if (role === 'admin') return true
  return role === 'client'
    && canvas.status === 'client_review'
    && Boolean(review.approvalGateTaskId)
    && !review.requiredReviewerAgentId
}

export function buildMarketingStudioCanvasModel(input: {
  canvas: CreativeCanvas & { id: string }
  runs: Array<CreativeCanvasRun & { id: string }>
  versions: Array<Partial<CreativeCanvasVersion>>
  exports: StoredExport[]
  credits: Pick<CanvasCreditState, 'used' | 'limit'>
  role: ApiRole
}): ChatContextReadModel {
  const { canvas, runs, credits, role } = input
  const assets = buildCreativeCanvasAssetGallery({ nodes: canvas.nodes, runs })
  const runByOutputNode = new Map(runs.filter((run) => run.output?.outputNodeId).map((run) => [run.output!.outputNodeId!, run]))
  const completedExportNodes = new Set(input.exports.filter((item) => item.status === 'completed').map((item) => item.nodeId))
  const artifacts: ChatArtifactSummary[] = [{
    id: marketingCanvasContextId(canvas.orgId, canvas.id),
    studioKind: 'marketing_studio', resourceType: 'canvas', resourceId: canvas.id, title: canvas.title,
    artifactKind: 'canvas', state: canvasState(canvas.status), statusLabel: label(canvas.status),
    preview: { kind: 'none' }, version: `v${canvas.activeVersion}`, updatedAt: dateString(canvas.updatedAt),
    href: exactHref(canvas.id, canvas.orgId, role), actions: [{ id: 'open', label: 'Open canvas', href: exactHref(canvas.id, canvas.orgId, role) }],
  }]

  const attention: ContextAttentionSummary[] = []
  if (!canvas.nodes.some((node) => node.type === 'source')) {
    attention.push({
      id: `input:${canvas.id}`, label: 'Add source or brand input', state: 'needs_input',
      detail: 'This canvas has no source material to ground generation.', href: exactHref(canvas.id, canvas.orgId, role),
    })
  }
  if (canvas.status === 'client_review') {
    attention.push({
      id: `approval:${canvas.id}`, label: 'Client approval required', state: 'needs_approval',
      detail: 'Provider completion does not approve the campaign artifact.', href: exactHref(canvas.id, canvas.orgId, role),
    })
  }
  for (const asset of assets.filter((item) => item.origin === 'output_node')) {
    const node = canvas.nodes.find((candidate) => candidate.id === asset.nodeId)
    if (!node) continue
    const run = runByOutputNode.get(node.id)
    const reviewBits = [
      asset.reviewStatus === 'passed' ? 'Reviewed' : asset.reviewStatus === 'blocked' ? 'Review blocked' : 'Review needed',
      asset.rightsStatus === 'cleared' ? 'Rights cleared' : asset.rightsStatus === 'blocked' ? 'Rights blocked' : 'Rights review',
      asset.brandStatus === 'passed' ? 'Brand passed' : asset.brandStatus === 'blocked' ? 'Brand blocked' : 'Brand review',
    ]
    const ready = asset.readyForExport
    const state: ContextDisplayState = ready ? 'complete' : (asset.reviewStatus === 'blocked' || asset.rightsStatus === 'blocked' || asset.brandStatus === 'blocked') ? 'blocked' : 'review'
    const nodeHref = exactHref(canvas.id, canvas.orgId, role)
    const apiBase = `/api/v1/creative-canvas/${encodeURIComponent(canvas.id)}`
    const actions: ChatArtifactSummary['actions'] = [{ id: 'open', label: 'Open canvas', href: nodeHref }]
    if (!ready) {
      if (canOfferReviewActions(canvas, node, role)) actions.push(
          { id: 'review', label: 'Review', href: mutationHref(`${apiBase}/nodes/${encodeURIComponent(node.id)}/review`, canvas.orgId), method: 'PUT', body: { action: 'approve' } },
          { id: 'request-changes', label: 'Request changes', href: mutationHref(`${apiBase}/nodes/${encodeURIComponent(node.id)}/review`, canvas.orgId), method: 'PUT', body: { action: 'request_changes' } },
        )
    } else {
      actions.push({ id: 'export', label: completedExportNodes.has(node.id) ? 'Export again' : 'Export', href: mutationHref(`${apiBase}/exports/draft`, canvas.orgId), method: 'POST', body: { nodeId: node.id, target: asset.suggestedExportTarget ?? 'campaign_asset' } })
    }
    artifacts.push({
      id: `marketing_studio:asset:${encodeURIComponent(asset.id)}`, studioKind: 'marketing_studio', resourceType: 'canvas_output', resourceId: node.id,
      title: asset.title, artifactKind: outputArtifactKind(asset.outputKind), state,
      statusLabel: ready ? 'Export ready' : reviewBits.join(' · '),
      preview: { kind: previewKind(asset.outputKind, asset.url, asset.textPreview), url: asset.url, thumbnailUrl: asset.thumbnailUrl, text: asset.textPreview },
      version: `v${canvas.activeVersion}`, updatedAt: dateString(node.updatedAt) ?? dateString(canvas.updatedAt),
      provenance: run ? { agentId: run.provenance.agentId, provider: run.providerKey, model: run.model ?? run.provenance.model, sourceIds: run.input.sourceNodeIds } : undefined,
      review: { required: !ready, status: reviewBits.join(' · '), reviewer: node.review?.requiredReviewerAgentId, approvalGateTaskId: node.review?.approvalGateTaskId }, href: nodeHref, actions,
    })
    if (!ready) attention.push({
      id: `review:${node.id}`, label: `${node.title} needs review`, state: state === 'blocked' ? 'blocked' : 'review',
      detail: reviewBits.join(' · '), href: nodeHref, actions,
    })
  }

  for (const asset of assets.filter((item) => item.origin === 'run_output' && !canvas.nodes.some((node) => node.type === 'output' && node.id === item.nodeId))) {
    const run = runs.find((item) => item.id === asset.runId)
    if (!run) continue
    const waiting = run.status === 'waiting_for_review'
    const runHref = exactHref(canvas.id, canvas.orgId, role)
    artifacts.push({
      id: `marketing_studio:run:${encodeURIComponent(run.id)}`, studioKind: 'marketing_studio', resourceType: 'run_output', resourceId: run.id,
      title: asset.title, artifactKind: outputArtifactKind(asset.outputKind), state: runState(run.status),
      statusLabel: label(run.status), preview: { kind: previewKind(asset.outputKind, asset.url, asset.textPreview), url: asset.url, thumbnailUrl: asset.thumbnailUrl, text: asset.textPreview },
      updatedAt: dateString(run.updatedAt) ?? dateString(run.createdAt),
      provenance: { agentId: run.provenance.agentId, provider: run.providerKey, model: run.model ?? run.provenance.model, sourceIds: run.input.sourceNodeIds }, href: runHref,
      actions: [{ id: 'open', label: 'Open canvas', href: runHref }],
    })
    if (waiting) attention.push({ id: `run-review:${run.id}`, label: `${asset.title} is waiting for review`, state: 'review', href: runHref })
  }

  for (const run of runs.filter((item) => item.status === 'failed')) {
    const actions: ContextAttentionSummary['actions'] = run.error?.retryable === true
      ? [{ id: 'retry', label: 'Retry', href: mutationHref(`/api/v1/creative-canvas/${encodeURIComponent(canvas.id)}/runs/${encodeURIComponent(run.id)}/retry`, canvas.orgId), method: 'PUT' }]
      : undefined
    attention.push({
      id: `failure:${run.id}`, label: `${run.providerKey} generation failed`, state: 'blocked', detail: run.error?.message,
      href: exactHref(canvas.id, canvas.orgId, role), actions,
    })
  }
  for (const item of input.exports.filter((candidate) => candidate.status === 'failed' || candidate.status === 'blocked')) {
    attention.push({ id: `export:${item.id}`, label: `${item.target ? label(item.target) : 'Canvas'} export ${item.status}`, state: 'blocked', detail: `Node ${item.nodeId}`, href: exactHref(canvas.id, canvas.orgId, role) })
  }
  if (credits.limit !== null && credits.used >= credits.limit) attention.push({ id: `spend:${canvas.id}`, label: 'Creative credits exhausted', state: 'needs_approval', detail: `${credits.used} of ${credits.limit} credits used`, href: exactHref(canvas.id, canvas.orgId, role) })

  const readyCount = assets.filter((asset) => asset.origin === 'output_node' && asset.readyForExport).length
  return {
    context: { kind: 'studio_artifact', id: marketingCanvasContextId(canvas.orgId, canvas.id), orgId: canvas.orgId, label: canvas.title, icon: 'marketing_studio', href: exactHref(canvas.id, canvas.orgId, role) },
    pulse: {
      label: label(canvas.status), headline: readyCount ? `${readyCount} asset${readyCount === 1 ? '' : 's'} export-ready` : undefined,
      metrics: [
        { id: 'outputs', label: 'Outputs', value: assets.filter((asset) => asset.origin === 'output_node').length },
        { id: 'running', label: 'Running', value: runs.filter((run) => run.status === 'queued' || run.status === 'running').length },
        { id: 'export-ready', label: 'Export ready', value: readyCount },
        { id: 'versions', label: 'Versions', value: input.versions.length || canvas.activeVersion },
        { id: 'credits-used', label: 'Credits used', value: credits.used },
        { id: 'credits-limit', label: 'Credit limit', value: credits.limit ?? 'Unlimited' },
        { id: 'credits-remaining', label: 'Credits remaining', value: credits.limit === null ? 'Unlimited' : Math.max(0, credits.limit - credits.used) },
      ],
      next: attention[0] ? { id: attention[0].id, label: attention[0].label, state: attention[0].state, href: attention[0].href, actions: attention[0].actions } : undefined,
    },
    groups: input.exports.length ? [{ id: 'exports', label: 'Exports', items: input.exports.map((item) => ({ id: item.id, label: item.target ? label(item.target) : 'Canvas export', state: item.status === 'completed' ? 'complete' : item.status === 'failed' || item.status === 'blocked' ? 'blocked' : 'ready', detail: `${label(item.status)} · node ${item.nodeId}`, updatedAt: dateString(item.createdAt) })) }] : [], artifacts, attention, activity: [], capabilities: ['view', 'review', 'request_changes', 'retry', 'export'], asOf: new Date().toISOString(),
  }
}

async function listExports(canvasId: string, orgId: string): Promise<StoredExport[]> {
  const snap = await adminDb.collection('creative_canvas_exports').where('orgId', '==', orgId).where('canvasId', '==', canvasId).get()
  return snap.docs.map((doc: { id: string; data: () => Record<string, unknown> }) => {
    const data = doc.data()
    return { id: doc.id, nodeId: String(data.nodeId ?? ''), status: data.status as CreativeCanvasExport['status'], target: data.target as CreativeCanvasExport['target'], createdAt: data.createdAt }
  })
}

function trustedOrgIds(user: Parameters<ChatContextAdapter['resolve']>[0]['user']): string[] {
  return Array.from(new Set([user.orgId, ...(user.orgIds ?? []), ...(user.allowedOrgIds ?? [])].filter((value): value is string => Boolean(value))))
}

function canAccessOrg(user: Parameters<ChatContextAdapter['resolve']>[0]['user'], orgId: string): boolean {
  return user.role === 'admin' && !user.allowedOrgIds?.length ? true : trustedOrgIds(user).includes(orgId)
}

async function resolveCanvasIdentity(id: string, user: Parameters<ChatContextAdapter['resolve']>[0]['user']): Promise<{ orgId: string; canvasId: string; canvas: CreativeCanvas & { id: string } } | null> {
  const identity = parseMarketingCanvasContextId(id)
  if (!identity) return null
  if (identity.canonical && identity.orgId) {
    if (!canAccessOrg(user, identity.orgId)) return null
    const canvas = await getCreativeCanvas(identity.canvasId, identity.orgId)
    return canvas ? { orgId: identity.orgId, canvasId: identity.canvasId, canvas } : null
  }
  const canvasId = identity.canvasId
  const trusted = trustedOrgIds(user)
  if (user.role === 'admin' && !user.allowedOrgIds?.length) {
    const record = await adminDb.collection(CREATIVE_CANVAS_COLLECTION).doc(canvasId).get()
    const data = record.exists ? record.data() as Record<string, unknown> | undefined : undefined
    const orgId = typeof data?.orgId === 'string' && data.orgId.trim() ? data.orgId.trim() : null
    if (!orgId || data?.deleted === true || !canAccessOrg(user, orgId)) return null
    const canvas = await getCreativeCanvas(canvasId, orgId)
    return canvas?.orgId === orgId ? { orgId, canvasId, canvas } : null
  }
  const matches = (await Promise.all(trusted.map(async (orgId) => {
    const canvas = await getCreativeCanvas(canvasId, orgId)
    return canvas ? { orgId, canvasId, canvas } : null
  }))).filter((value): value is { orgId: string; canvasId: string; canvas: CreativeCanvas & { id: string } } => Boolean(value))
  return matches.length === 1 ? matches[0] : null
}

export const marketingStudioArtifactChatContextAdapter: ChatContextAdapter = {
  async resolve({ id, user }) {
    const resolved = await resolveCanvasIdentity(id, user)
    if (!resolved) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    const { canvasId, orgId, canvas } = resolved
    if (user.role === 'client' && canvas.visibility !== 'admin_agents_clients') return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    const [runs, versions, credits, exports] = await Promise.all([
      listCreativeCanvasRuns(canvasId, orgId), listCreativeCanvasVersions(canvasId, orgId), getCanvasCredits(orgId), listExports(canvasId, orgId),
    ])
    return { ok: true, model: buildMarketingStudioCanvasModel({ canvas, runs, versions, credits, exports, role: user.role }) }
  },
}
