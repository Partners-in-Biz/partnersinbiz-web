import type {
  CreativeCanvasActor,
  CreativeCanvasActorType,
  CreativeCanvasBrandStatus,
  CreativeCanvasEdge,
  CreativeCanvasEditIntent,
  CreativeCanvasEditMask,
  CreativeCanvasMaskBrushStroke,
  CreativeCanvasEditMotionMode,
  CreativeCanvasEditOperation,
  CreativeCanvasGraph,
  CreativeCanvasInput,
  CreativeCanvasNode,
  CreativeCanvasNodeType,
  CreativeCanvasOutputKind,
  CreativeCanvasProviderKey,
  CreativeCanvasReferenceRole,
  CreativeCanvasReviewStatus,
  CreativeCanvasRightsStatus,
  CreativeCanvasSourceKind,
  CreativeCanvasStatus,
  CreativeCanvasVisibility,
} from './types'

const NODE_TYPES: CreativeCanvasNodeType[] = ['source', 'brief', 'prompt', 'model', 'edit', 'review', 'output']
const SOURCE_KINDS: CreativeCanvasSourceKind[] = ['brand_kit', 'upload', 'url', 'research_item', 'client_document', 'campaign', 'social_post', 'youtube_asset', 'book_studio_record', 'workspace_artifact']
const REFERENCE_ROLES: CreativeCanvasReferenceRole[] = ['general', 'product', 'person', 'character', 'style', 'background', 'logo', 'mask', 'motion']
const PROVIDER_KEYS: CreativeCanvasProviderKey[] = ['higgsfield', 'xai', 'manual_upload', 'text_generation', 'document_generation', 'agent_task']
const OUTPUT_KINDS: CreativeCanvasOutputKind[] = ['image', 'video', 'audio', 'caption', 'copy', 'blog_draft', 'document_block', 'book_artifact', 'youtube_render', 'campaign_asset', 'social_post_draft']
const REVIEW_STATUSES: CreativeCanvasReviewStatus[] = ['not_required', 'needed', 'passed', 'warning', 'blocked']
const RIGHTS_STATUSES: CreativeCanvasRightsStatus[] = ['unknown', 'cleared', 'needs_review', 'blocked']
const BRAND_STATUSES: CreativeCanvasBrandStatus[] = ['unknown', 'passed', 'needs_review', 'blocked']
const CANVAS_STATUSES: CreativeCanvasStatus[] = ['draft', 'internal_review', 'client_review', 'approved', 'archived']
const VISIBILITIES: CreativeCanvasVisibility[] = ['admin_agents', 'admin_agents_clients']
const ACTOR_TYPES: CreativeCanvasActorType[] = ['user', 'agent', 'system']
const EDIT_OPERATIONS: CreativeCanvasEditOperation[] = ['inpaint', 'outpaint', 'style_transfer', 'object_replace', 'background_replace', 'video_motion', 'variation', 'upscale']
const EDIT_INTENTS: CreativeCanvasEditIntent[] = ['generative_fill', 'object_removal', 'object_replace', 'relight', 'reference_blend']
const EDIT_MOTION_MODES: CreativeCanvasEditMotionMode[] = ['none', 'camera_push', 'camera_pull', 'pan', 'orbit', 'dolly', 'handheld']

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function requiredString(value: unknown, field: string): string {
  const clean = cleanString(value)
  if (!clean) throw new Error(`${field} is required`)
  return clean
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? value as T : fallback
}

function cleanNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function cleanOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function cleanBoundedOptionalNumber(value: unknown, min: number, max: number): number | undefined {
  const clean = cleanOptionalNumber(value)
  if (clean === undefined) return undefined
  return Math.min(max, Math.max(min, clean))
}

function cleanBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function cleanMask(value: unknown, field: string): CreativeCanvasEditMask | undefined {
  const mask = asRecord(value)
  if (!Object.keys(mask).length) return undefined
  const region = asRecord(mask.region)
  const regionUnit = enumValue(region.unit, ['percent', 'pixel'] as const, 'percent')
  const cleanMaskValue: CreativeCanvasEditMask = {
    sourceNodeId: cleanString(mask.sourceNodeId),
    url: cleanHttpUrl(mask.url, `${field}.url`),
    storagePath: cleanString(mask.storagePath),
    invert: cleanBoolean(mask.invert),
  }

  if (Object.keys(region).length) {
    const x = cleanBoundedOptionalNumber(region.x, 0, regionUnit === 'percent' ? 100 : 10000)
    const y = cleanBoundedOptionalNumber(region.y, 0, regionUnit === 'percent' ? 100 : 10000)
    const width = cleanBoundedOptionalNumber(region.width, 0, regionUnit === 'percent' ? 100 : 10000)
    const height = cleanBoundedOptionalNumber(region.height, 0, regionUnit === 'percent' ? 100 : 10000)
    if (x !== undefined && y !== undefined && width !== undefined && height !== undefined) {
      cleanMaskValue.region = {
        x,
        y,
        width,
        height,
        unit: regionUnit,
        feather: cleanBoundedOptionalNumber(region.feather, 0, 100),
      }
    }
  }

  const brush = asRecord(mask.brush)
  if (Array.isArray(brush.strokes)) {
    const strokes = brush.strokes
      .slice(0, 80)
      .map((stroke) => {
        const rawStroke = asRecord(stroke)
        const unit = enumValue(rawStroke.unit, ['percent', 'pixel'] as const, 'percent')
        const maxCoordinate = unit === 'percent' ? 100 : 10000
        const points = Array.isArray(rawStroke.points)
          ? rawStroke.points.slice(0, 300).map((point) => {
            const rawPoint = asRecord(point)
            const x = cleanBoundedOptionalNumber(rawPoint.x, 0, maxCoordinate)
            const y = cleanBoundedOptionalNumber(rawPoint.y, 0, maxCoordinate)
            return x !== undefined && y !== undefined ? { x, y } : undefined
          }).filter((point): point is { x: number; y: number } => Boolean(point))
          : []
        if (!points.length) return undefined
        const cleanStroke: CreativeCanvasMaskBrushStroke = {
          id: cleanString(rawStroke.id) ?? `stroke-${points[0].x}-${points[0].y}`,
          points,
          size: cleanBoundedOptionalNumber(rawStroke.size, 1, unit === 'percent' ? 25 : 500) ?? 8,
          mode: enumValue(rawStroke.mode, ['paint', 'erase'] as const, 'paint'),
          unit,
        }
        const opacity = cleanBoundedOptionalNumber(rawStroke.opacity, 0, 1)
        if (opacity !== undefined) cleanStroke.opacity = opacity
        return cleanStroke
      })
      .filter((stroke): stroke is CreativeCanvasMaskBrushStroke => Boolean(stroke))
    if (strokes.length) cleanMaskValue.brush = { strokes }
  }

  return cleanMaskValue
}

function cleanStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? Array.from(new Set(value.map(cleanString).filter((item): item is string => Boolean(item))))
    : []
}

function cleanVisualProofData(value: unknown): Record<string, unknown> | undefined {
  const proof = asRecord(value)
  const entries: Array<[string, Record<string, unknown>]> = Object.entries(proof)
    .flatMap(([key, raw]) => {
      const item = asRecord(raw)
      const screenshotUrl = cleanString(item.screenshotUrl)?.slice(0, 500)
      const notes = cleanString(item.notes)?.slice(0, 500)
      const capturedAt = cleanString(item.capturedAt)?.slice(0, 80)
      const capturedBy = cleanString(item.capturedBy)?.slice(0, 120)
      const signedIn = item.signedIn === true
      const sessionEvidence = cleanString(item.sessionEvidence)?.slice(0, 240)
      const viewportSize = cleanString(item.viewportSize)?.slice(0, 80)
      const visiblePanels = cleanString(item.visiblePanels)?.slice(0, 240)
      const canvasVersion = typeof item.canvasVersion === 'number' && Number.isFinite(item.canvasVersion)
        ? Math.max(0, Math.round(item.canvasVersion))
        : undefined
      const graphSignature = cleanString(item.graphSignature)?.slice(0, 240)
      const nodeCount = typeof item.nodeCount === 'number' && Number.isFinite(item.nodeCount)
        ? Math.max(0, Math.round(item.nodeCount))
        : undefined
      const edgeCount = typeof item.edgeCount === 'number' && Number.isFinite(item.edgeCount)
        ? Math.max(0, Math.round(item.edgeCount))
        : undefined
      if (
        !screenshotUrl
        && !notes
        && !capturedAt
        && !capturedBy
        && !signedIn
        && !sessionEvidence
        && !viewportSize
        && !visiblePanels
        && canvasVersion === undefined
        && !graphSignature
        && nodeCount === undefined
        && edgeCount === undefined
      ) return []
      return [[key.slice(0, 80), {
        screenshotUrl,
        notes,
        capturedAt,
        capturedBy,
        signedIn,
        sessionEvidence,
        viewportSize,
        visiblePanels,
        canvasVersion,
        graphSignature,
        nodeCount,
        edgeCount,
      } as Record<string, unknown>] as [string, Record<string, unknown>]]
    })
    .slice(0, 8)
  return entries.length ? Object.fromEntries(entries) : undefined
}

function cleanBenchmarkProofData(value: unknown): Record<string, unknown> | undefined {
  const proof = asRecord(value)
  const entries: Array<[string, Record<string, unknown>]> = Object.entries(proof)
    .flatMap(([key, raw]) => {
      const item = asRecord(raw)
      const proofUrl = cleanString(item.proofUrl)?.slice(0, 500)
      const notes = cleanString(item.notes)?.slice(0, 700)
      const capturedAt = cleanString(item.capturedAt)?.slice(0, 80)
      const capturedBy = cleanString(item.capturedBy)?.slice(0, 120)
      const sourceTitle = cleanString(item.sourceTitle)?.slice(0, 160)
      const sourceUrl = cleanString(item.sourceUrl)?.slice(0, 500)
      const sourceCheckedAt = cleanString(item.sourceCheckedAt)?.slice(0, 80)
      const sourceSignals = cleanStringArray(item.sourceSignals).map((signal) => signal.slice(0, 120)).slice(0, 12)
      const higgsfieldUiEvidenceUrl = cleanString(item.higgsfieldUiEvidenceUrl)?.slice(0, 500)
      const canvasEvidenceUrl = cleanString(item.canvasEvidenceUrl)?.slice(0, 500)
      const directComparisonAt = cleanString(item.directComparisonAt)?.slice(0, 80)
      const directComparisonVerdict = item.directComparisonVerdict === 'pass' || item.directComparisonVerdict === 'gap'
        ? item.directComparisonVerdict
        : undefined
      const directComparisonNotes = cleanString(item.directComparisonNotes)?.slice(0, 700)
      const canvasVersion = typeof item.canvasVersion === 'number' && Number.isFinite(item.canvasVersion)
        ? Math.max(0, Math.round(item.canvasVersion))
        : undefined
      const graphSignature = cleanString(item.graphSignature)?.slice(0, 240)
      const nodeCount = typeof item.nodeCount === 'number' && Number.isFinite(item.nodeCount)
        ? Math.max(0, Math.round(item.nodeCount))
        : undefined
      const edgeCount = typeof item.edgeCount === 'number' && Number.isFinite(item.edgeCount)
        ? Math.max(0, Math.round(item.edgeCount))
        : undefined
      if (
        !proofUrl
        && !notes
        && !capturedAt
        && !capturedBy
        && !sourceTitle
        && !sourceUrl
        && !sourceCheckedAt
        && !sourceSignals.length
        && !higgsfieldUiEvidenceUrl
        && !canvasEvidenceUrl
        && !directComparisonAt
        && !directComparisonVerdict
        && !directComparisonNotes
        && canvasVersion === undefined
        && !graphSignature
        && nodeCount === undefined
        && edgeCount === undefined
      ) return []
      return [[key.slice(0, 80), {
        proofUrl,
        notes,
        capturedAt,
        capturedBy,
        sourceTitle,
        sourceUrl,
        sourceCheckedAt,
        sourceSignals,
        higgsfieldUiEvidenceUrl,
        canvasEvidenceUrl,
        directComparisonAt,
        directComparisonVerdict,
        directComparisonNotes,
        canvasVersion,
        graphSignature,
        nodeCount,
        edgeCount,
      } as Record<string, unknown>] as [string, Record<string, unknown>]]
    })
    .slice(0, 12)
  return entries.length ? Object.fromEntries(entries) : undefined
}

export function sanitizeCreativeCanvasData(value: unknown): Record<string, unknown> {
  const data = asRecord(value)
  const visualProof = cleanVisualProofData(data.visualProof)
  const benchmarkProof = cleanBenchmarkProofData(data.benchmarkProof)
  return {
    ...(visualProof ? { visualProof } : {}),
    ...(benchmarkProof ? { benchmarkProof } : {}),
  }
}

function cleanHttpUrl(value: unknown, field: string): string | undefined {
  const raw = cleanString(value)
  if (!raw) return undefined
  try {
    const parsed = new URL(raw)
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error()
    if (parsed.username || parsed.password) throw new Error()
    return parsed.href
  } catch {
    throw new Error(`${field} must be a safe http(s) URL`)
  }
}

function cleanLinked(value: unknown) {
  const linked = asRecord(value)
  return {
    projectId: cleanString(linked.projectId),
    taskId: cleanString(linked.taskId),
    campaignId: cleanString(linked.campaignId),
    researchItemId: cleanString(linked.researchItemId),
    clientDocumentId: cleanString(linked.clientDocumentId),
    socialPostId: cleanString(linked.socialPostId),
    youtubeVideoProjectId: cleanString(linked.youtubeVideoProjectId),
    bookStudioProjectId: cleanString(linked.bookStudioProjectId),
    workspaceArtifactIds: cleanStringArray(linked.workspaceArtifactIds),
  }
}

export function sanitizeCreativeCanvasInput(
  input: unknown,
  orgId: string,
  actor: CreativeCanvasActor,
): CreativeCanvasInput {
  const body = asRecord(input)
  const actorType = enumValue(actor.type, ACTOR_TYPES, 'user')

  return {
    orgId: requiredString(orgId, 'orgId'),
    title: requiredString(body.title, 'title'),
    status: enumValue(body.status, CANVAS_STATUSES, 'draft'),
    purpose: cleanString(body.purpose) ?? '',
    data: sanitizeCreativeCanvasData(body.data),
    linked: cleanLinked(body.linked),
    activeVersion: 1,
    visibility: enumValue(body.visibility, VISIBILITIES, 'admin_agents'),
    createdBy: requiredString(actor.uid, 'actor.uid'),
    createdByType: actorType,
    updatedBy: requiredString(actor.uid, 'actor.uid'),
    updatedByType: actorType,
    deleted: false,
    nodes: [],
    edges: [],
  }
}

function sanitizeNode(raw: unknown, orgId: string): CreativeCanvasNode {
  const node = asRecord(raw)
  const id = requiredString(node.id, 'node.id')
  const nodeOrgId = cleanString(node.orgId) ?? orgId
  if (nodeOrgId !== orgId) throw new Error(`node ${id} does not belong to organisation`)

  const position = asRecord(node.position)
  const source = asRecord(node.source)
  const provider = asRecord(node.provider)
  const edit = asRecord(node.edit)
  const review = asRecord(node.review)
  const output = asRecord(node.output)
  const size = asRecord(node.size)

  const sanitized: CreativeCanvasNode = {
    id,
    canvasId: cleanString(node.canvasId),
    orgId,
    type: enumValue(node.type, NODE_TYPES, 'source'),
    title: cleanString(node.title) ?? id,
    position: {
      x: cleanNumber(position.x, 0),
      y: cleanNumber(position.y, 0),
    },
    data: asRecord(node.data),
  }

  if (typeof size.width === 'number' || typeof size.height === 'number') {
    sanitized.size = {
      width: Math.max(1, cleanNumber(size.width, 280)),
      height: Math.max(1, cleanNumber(size.height, 160)),
    }
  }

  if (Object.keys(source).length) {
    sanitized.source = {
      kind: enumValue(source.kind, SOURCE_KINDS, 'upload'),
      refId: cleanString(source.refId),
      url: cleanHttpUrl(source.url, `node ${id} source.url`),
      thumbnailUrl: cleanHttpUrl(source.thumbnailUrl, `node ${id} source.thumbnailUrl`),
      previewUrl: cleanHttpUrl(source.previewUrl, `node ${id} source.previewUrl`),
      storagePath: cleanString(source.storagePath),
      mimeType: cleanString(source.mimeType),
      altText: cleanString(source.altText),
      referenceRole: enumValue(source.referenceRole, REFERENCE_ROLES, 'general'),
      weight: cleanOptionalNumber(source.weight),
    }
  }

  if (Object.keys(provider).length) {
    sanitized.provider = {
      key: enumValue(provider.key, PROVIDER_KEYS, 'manual_upload'),
      model: cleanString(provider.model),
      mode: cleanString(provider.mode),
    }
  }

  if (Object.keys(edit).length) {
    const motion = asRecord(edit.motion)
    type EditReference = NonNullable<NonNullable<CreativeCanvasNode['edit']>['references']>[number]
    const references = Array.isArray(edit.references)
      ? edit.references
        .map((reference) => {
          const rawReference = asRecord(reference)
          const sourceNodeId = cleanString(rawReference.sourceNodeId)
          if (!sourceNodeId) return undefined
          const cleanReference: EditReference = {
            sourceNodeId,
            role: enumValue(rawReference.role, REFERENCE_ROLES, 'general'),
          }
          const weight = cleanOptionalNumber(rawReference.weight)
          if (weight !== undefined) cleanReference.weight = weight
          return cleanReference
        })
        .filter((reference): reference is EditReference => Boolean(reference))
      : []

    const sanitizedEdit: NonNullable<CreativeCanvasNode['edit']> = {
      operation: enumValue(edit.operation, EDIT_OPERATIONS, 'inpaint'),
      intent: enumValue(edit.intent, EDIT_INTENTS, 'generative_fill'),
      prompt: cleanString(edit.prompt),
      references,
      strength: cleanOptionalNumber(edit.strength),
      outputKind: enumValue(edit.outputKind, OUTPUT_KINDS, 'image'),
    }

    sanitizedEdit.mask = cleanMask(edit.mask, `node ${id} edit.mask`)

    const blendControls = asRecord(edit.blendControls)
    if (Object.keys(blendControls).length) {
      sanitizedEdit.blendControls = {
        lightMatch: cleanBoolean(blendControls.lightMatch),
        textureAdaptive: cleanBoolean(blendControls.textureAdaptive),
        autoShadows: cleanBoolean(blendControls.autoShadows),
        perspectiveMatch: cleanBoolean(blendControls.perspectiveMatch),
        preserveSubject: cleanBoolean(blendControls.preserveSubject),
      }
    }

    if (Object.keys(motion).length) {
      sanitizedEdit.motion = {
        mode: enumValue(motion.mode, EDIT_MOTION_MODES, 'none'),
        durationSeconds: cleanOptionalNumber(motion.durationSeconds),
      }
    }

    sanitized.edit = sanitizedEdit
  }

  if (Object.keys(review).length) {
    sanitized.review = {
      status: enumValue(review.status, REVIEW_STATUSES, 'needed'),
      approvalGateTaskId: cleanString(review.approvalGateTaskId),
      requiredReviewerAgentId: cleanString(review.requiredReviewerAgentId),
      syntheticMediaDisclosure: cleanBoolean(review.syntheticMediaDisclosure),
      rightsStatus: enumValue(review.rightsStatus, RIGHTS_STATUSES, 'unknown'),
      brandStatus: enumValue(review.brandStatus, BRAND_STATUSES, 'unknown'),
    }
  }

  if (Object.keys(output).length) {
    sanitized.output = {
      kind: enumValue(output.kind, OUTPUT_KINDS, 'image'),
      artifactId: cleanString(output.artifactId),
      url: cleanHttpUrl(output.url, `node ${id} output.url`),
      thumbnailUrl: cleanHttpUrl(output.thumbnailUrl, `node ${id} output.thumbnailUrl`),
      storagePath: cleanString(output.storagePath),
      textPreview: cleanString(output.textPreview),
    }
  }

  return sanitized
}

function sanitizeEdge(raw: unknown, orgId: string, nodeIds: Set<string>): CreativeCanvasEdge {
  const edge = asRecord(raw)
  const id = requiredString(edge.id, 'edge.id')
  const edgeOrgId = cleanString(edge.orgId) ?? orgId
  if (edgeOrgId !== orgId) throw new Error(`edge ${id} does not belong to organisation`)

  const sourceNodeId = requiredString(edge.sourceNodeId, `edge ${id} sourceNodeId`)
  const targetNodeId = requiredString(edge.targetNodeId, `edge ${id} targetNodeId`)
  if (!nodeIds.has(sourceNodeId)) throw new Error(`edge ${id} sourceNodeId does not exist in graph`)
  if (!nodeIds.has(targetNodeId)) throw new Error(`edge ${id} targetNodeId does not exist in graph`)

  return {
    id,
    canvasId: cleanString(edge.canvasId),
    orgId,
    sourceNodeId,
    targetNodeId,
    label: cleanString(edge.label),
    data: asRecord(edge.data),
  }
}

export function sanitizeCreativeCanvasGraph(input: unknown, orgId: string): CreativeCanvasGraph {
  const body = asRecord(input)
  const nodes = Array.isArray(body.nodes) ? body.nodes.map((node) => sanitizeNode(node, orgId)) : []
  const nodeIds = new Set(nodes.map((node) => node.id))
  if (nodeIds.size !== nodes.length) throw new Error('graph contains duplicate node ids')

  const edges = Array.isArray(body.edges)
    ? body.edges.map((edge) => sanitizeEdge(edge, orgId, nodeIds))
    : []
  const edgeIds = new Set(edges.map((edge) => edge.id))
  if (edgeIds.size !== edges.length) throw new Error('graph contains duplicate edge ids')

  return { nodes, edges }
}
