import {
  creativeCanvasRemoteMutationOperations,
  creativeCanvasRemoteMutationSources,
} from './types'
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
  CreativeCanvasMobileViewportEvidence,
  CreativeCanvasNode,
  CreativeCanvasNodeType,
  CreativeCanvasOutputKind,
  CreativeCanvasProviderKey,
  CreativeCanvasReferenceRole,
  CreativeCanvasReviewStatus,
  CreativeCanvasRightsStatus,
  CreativeCanvasRemoteMutationOperation,
  CreativeCanvasRemoteMutationSource,
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
const REMOTE_MUTATION_OPERATIONS: readonly CreativeCanvasRemoteMutationOperation[] = creativeCanvasRemoteMutationOperations
const REMOTE_MUTATION_SOURCES: readonly CreativeCanvasRemoteMutationSource[] = creativeCanvasRemoteMutationSources
const MOBILE_VIEWPORT_KEYS: CreativeCanvasMobileViewportEvidence['key'][] = ['desktop', 'tablet', 'mobile', 'mobile_panels']
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

function cleanMobileViewportBehaviorEvidence(value: unknown): CreativeCanvasMobileViewportEvidence[] {
  if (!Array.isArray(value)) return []

  return value
    .slice(0, 8)
    .flatMap((raw) => {
      const item = asRecord(raw)
      const key = enumValue(item.key, MOBILE_VIEWPORT_KEYS, 'mobile')
      const width = typeof item.width === 'number' && Number.isFinite(item.width) ? Math.max(0, Math.round(item.width)) : undefined
      const height = typeof item.height === 'number' && Number.isFinite(item.height) ? Math.max(0, Math.round(item.height)) : undefined
      const screenshotUrl = cleanString(item.screenshotUrl)?.slice(0, 500)
      const status = typeof item.status === 'number' && Number.isFinite(item.status) ? Math.max(0, Math.round(item.status)) : undefined
      const contentType = cleanString(item.contentType)?.slice(0, 120)
      const capturedAt = cleanString(item.capturedAt)?.slice(0, 80)
      if (width === undefined || height === undefined || !screenshotUrl || status === undefined || !contentType || !capturedAt) {
        return []
      }

      return [{
        key,
        width,
        height,
        screenshotUrl,
        status,
        contentType,
        criticalControlsVisible: item.criticalControlsVisible === true,
        criticalControlsEnabled: item.criticalControlsEnabled === true,
        horizontalOverflow: item.horizontalOverflow === true,
        touchSmokePassed: item.touchSmokePassed === true,
        pointerSmokePassed: item.pointerSmokePassed === true,
        panelKeys: cleanStringArray(item.panelKeys).map((panel) => panel.slice(0, 80)).slice(0, 12),
        capturedAt,
      }]
    })
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
      const screenshotCheckedAt = cleanString(item.screenshotCheckedAt)?.slice(0, 80)
      const screenshotReachable = item.screenshotReachable === true ? true : undefined
      const screenshotStatus = typeof item.screenshotStatus === 'number' && Number.isFinite(item.screenshotStatus)
        ? Math.max(0, Math.round(item.screenshotStatus))
        : undefined
      const screenshotContentType = cleanString(item.screenshotContentType)?.slice(0, 120)
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
        && !screenshotCheckedAt
        && screenshotReachable === undefined
        && screenshotStatus === undefined
        && !screenshotContentType
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
        ...(screenshotCheckedAt ? { screenshotCheckedAt } : {}),
        ...(screenshotReachable !== undefined ? { screenshotReachable } : {}),
        ...(screenshotStatus !== undefined ? { screenshotStatus } : {}),
        ...(screenshotContentType ? { screenshotContentType } : {}),
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
      const sourceEvidenceCheckedAt = cleanString(item.sourceEvidenceCheckedAt)?.slice(0, 80)
      const sourceEvidenceReachable = item.sourceEvidenceReachable === true ? true : undefined
      const sourceEvidenceStatus = typeof item.sourceEvidenceStatus === 'number' && Number.isFinite(item.sourceEvidenceStatus)
        ? Math.max(0, Math.round(item.sourceEvidenceStatus))
        : undefined
      const sourceEvidenceContentType = cleanString(item.sourceEvidenceContentType)?.slice(0, 120)
      const sourceSignalsVerifiedAt = cleanString(item.sourceSignalsVerifiedAt)?.slice(0, 80)
      const sourceSignalsMatched = item.sourceSignalsMatched === true ? true : undefined
      const sourceSignalsMissing = cleanStringArray(item.sourceSignalsMissing).map((signal) => signal.slice(0, 120)).slice(0, 12)
      const sourceSignals = cleanStringArray(item.sourceSignals).map((signal) => signal.slice(0, 120)).slice(0, 12)
      const higgsfieldUiEvidenceUrl = cleanString(item.higgsfieldUiEvidenceUrl)?.slice(0, 500)
      const canvasEvidenceUrl = cleanString(item.canvasEvidenceUrl)?.slice(0, 500)
      const canvasEvidenceCheckedAt = cleanString(item.canvasEvidenceCheckedAt)?.slice(0, 80)
      const canvasEvidenceReachable = item.canvasEvidenceReachable === true ? true : undefined
      const canvasEvidenceStatus = typeof item.canvasEvidenceStatus === 'number' && Number.isFinite(item.canvasEvidenceStatus)
        ? Math.max(0, Math.round(item.canvasEvidenceStatus))
        : undefined
      const canvasEvidenceContentType = cleanString(item.canvasEvidenceContentType)?.slice(0, 120)
      const directComparisonAt = cleanString(item.directComparisonAt)?.slice(0, 80)
      const directComparisonVerdict = item.directComparisonVerdict === 'pass' || item.directComparisonVerdict === 'gap'
        ? item.directComparisonVerdict
        : undefined
      const directComparisonNotes = cleanString(item.directComparisonNotes)?.slice(0, 700)
      const orgId = cleanString(item.orgId)?.slice(0, 160)
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
      const collaborationRemoteActorCount = typeof item.collaborationRemoteActorCount === 'number' && Number.isFinite(item.collaborationRemoteActorCount)
        ? Math.max(0, Math.round(item.collaborationRemoteActorCount))
        : undefined
      const collaborationRemoteEventCount = typeof item.collaborationRemoteEventCount === 'number' && Number.isFinite(item.collaborationRemoteEventCount)
        ? Math.max(0, Math.round(item.collaborationRemoteEventCount))
        : undefined
      const collaborationRemoteMutationCount = typeof item.collaborationRemoteMutationCount === 'number' && Number.isFinite(item.collaborationRemoteMutationCount)
        ? Math.max(0, Math.round(item.collaborationRemoteMutationCount))
        : undefined
      const collaborationRemoteMutationKindCount = typeof item.collaborationRemoteMutationKindCount === 'number' && Number.isFinite(item.collaborationRemoteMutationKindCount)
        ? Math.max(0, Math.round(item.collaborationRemoteMutationKindCount))
        : undefined
      const collaborationRemoteTouchedNodeCount = typeof item.collaborationRemoteTouchedNodeCount === 'number' && Number.isFinite(item.collaborationRemoteTouchedNodeCount)
        ? Math.max(0, Math.round(item.collaborationRemoteTouchedNodeCount))
        : undefined
      const collaborationRemoteTouchedEdgeCount = typeof item.collaborationRemoteTouchedEdgeCount === 'number' && Number.isFinite(item.collaborationRemoteTouchedEdgeCount)
        ? Math.max(0, Math.round(item.collaborationRemoteTouchedEdgeCount))
        : undefined
      const collaborationRemoteGraphSignature = cleanString(item.collaborationRemoteGraphSignature)?.slice(0, 160)
      const collaborationRemoteSource = cleanString(item.collaborationRemoteSource)?.slice(0, 160)
      const collaborationRemoteOutcome = cleanString(item.collaborationRemoteOutcome)?.slice(0, 160)
      const collaborationStreamConnected = item.collaborationStreamConnected === true ? true : undefined
      const collaborationCapturedAt = cleanString(item.collaborationCapturedAt)?.slice(0, 80)
      const collaborationEvidence = cleanString(item.collaborationEvidence)?.slice(0, 300)
      const collaborationRemoteMutations = Array.isArray(item.collaborationRemoteMutations)
        ? item.collaborationRemoteMutations
          .slice(0, 25)
          .map((mutation) => {
            const raw = asRecord(mutation)
            const actorUid = cleanString(raw.actorUid)?.slice(0, 160)
            const actorType = enumValue(raw.actorType, ACTOR_TYPES, 'user')
            const operation = cleanString(raw.operation)
            const source = cleanString(raw.source)
            const occurredAt = cleanString(raw.occurredAt)?.slice(0, 160)
            if (
              !actorUid
              || !operation
              || !source
              || !occurredAt
              || !REMOTE_MUTATION_OPERATIONS.includes(operation as CreativeCanvasRemoteMutationOperation)
              || !REMOTE_MUTATION_SOURCES.includes(source as CreativeCanvasRemoteMutationSource)
            ) {
              return undefined
            }
            return {
              actorUid,
              actorType,
              operation: operation as CreativeCanvasRemoteMutationOperation,
              touchedNodeIds: cleanStringArray(raw.touchedNodeIds).map((id) => id.slice(0, 160)).slice(0, 40),
              touchedEdgeIds: cleanStringArray(raw.touchedEdgeIds).map((id) => id.slice(0, 160)).slice(0, 80),
              source: source as CreativeCanvasRemoteMutationSource,
              occurredAt,
            }
          })
          .filter((mutation): mutation is NonNullable<typeof mutation> => Boolean(mutation))
        : []
      const editingLocalEventCount = typeof item.editingLocalEventCount === 'number' && Number.isFinite(item.editingLocalEventCount)
        ? Math.max(0, Math.round(item.editingLocalEventCount))
        : undefined
      const editingNodeDropCount = typeof item.editingNodeDropCount === 'number' && Number.isFinite(item.editingNodeDropCount)
        ? Math.max(0, Math.round(item.editingNodeDropCount))
        : undefined
      const editingNodeMoveCount = typeof item.editingNodeMoveCount === 'number' && Number.isFinite(item.editingNodeMoveCount)
        ? Math.max(0, Math.round(item.editingNodeMoveCount))
        : undefined
      const editingConnectionCount = typeof item.editingConnectionCount === 'number' && Number.isFinite(item.editingConnectionCount)
        ? Math.max(0, Math.round(item.editingConnectionCount))
        : undefined
      const editingConfiguredGenerationCount = typeof item.editingConfiguredGenerationCount === 'number' && Number.isFinite(item.editingConfiguredGenerationCount)
        ? Math.max(0, Math.round(item.editingConfiguredGenerationCount))
        : undefined
      const editingCapturedAt = cleanString(item.editingCapturedAt)?.slice(0, 80)
      const editingEvidence = cleanString(item.editingEvidence)?.slice(0, 500)
      const maskingEditNodeCount = typeof item.maskingEditNodeCount === 'number' && Number.isFinite(item.maskingEditNodeCount)
        ? Math.max(0, Math.round(item.maskingEditNodeCount))
        : undefined
      const maskingPromptCount = typeof item.maskingPromptCount === 'number' && Number.isFinite(item.maskingPromptCount)
        ? Math.max(0, Math.round(item.maskingPromptCount))
        : undefined
      const maskingIntentCount = typeof item.maskingIntentCount === 'number' && Number.isFinite(item.maskingIntentCount)
        ? Math.max(0, Math.round(item.maskingIntentCount))
        : undefined
      const maskingRegionCount = typeof item.maskingRegionCount === 'number' && Number.isFinite(item.maskingRegionCount)
        ? Math.max(0, Math.round(item.maskingRegionCount))
        : undefined
      const maskingBrushStrokeCount = typeof item.maskingBrushStrokeCount === 'number' && Number.isFinite(item.maskingBrushStrokeCount)
        ? Math.max(0, Math.round(item.maskingBrushStrokeCount))
        : undefined
      const maskingBlendControlCount = typeof item.maskingBlendControlCount === 'number' && Number.isFinite(item.maskingBlendControlCount)
        ? Math.max(0, Math.round(item.maskingBlendControlCount))
        : undefined
      const maskingCapturedAt = cleanString(item.maskingCapturedAt)?.slice(0, 80)
      const maskingEvidence = cleanString(item.maskingEvidence)?.slice(0, 400)
      const generationModelCount = typeof item.generationModelCount === 'number' && Number.isFinite(item.generationModelCount)
        ? Math.max(0, Math.round(item.generationModelCount))
        : undefined
      const generationReferenceNodeCount = typeof item.generationReferenceNodeCount === 'number' && Number.isFinite(item.generationReferenceNodeCount)
        ? Math.max(0, Math.round(item.generationReferenceNodeCount))
        : undefined
      const generationReferenceRoleCount = typeof item.generationReferenceRoleCount === 'number' && Number.isFinite(item.generationReferenceRoleCount)
        ? Math.max(0, Math.round(item.generationReferenceRoleCount))
        : undefined
      const generationLinkedReferenceCount = typeof item.generationLinkedReferenceCount === 'number' && Number.isFinite(item.generationLinkedReferenceCount)
        ? Math.max(0, Math.round(item.generationLinkedReferenceCount))
        : undefined
      const generationMultiReferenceCapturedAt = cleanString(item.generationMultiReferenceCapturedAt)?.slice(0, 80)
      const generationMultiReferenceEvidence = cleanString(item.generationMultiReferenceEvidence)?.slice(0, 400)
      const versionSnapshotCount = typeof item.versionSnapshotCount === 'number' && Number.isFinite(item.versionSnapshotCount)
        ? Math.max(0, Math.round(item.versionSnapshotCount))
        : undefined
      const versionRestorableSnapshotCount = typeof item.versionRestorableSnapshotCount === 'number' && Number.isFinite(item.versionRestorableSnapshotCount)
        ? Math.max(0, Math.round(item.versionRestorableSnapshotCount))
        : undefined
      const versionNodeCommentCount = typeof item.versionNodeCommentCount === 'number' && Number.isFinite(item.versionNodeCommentCount)
        ? Math.max(0, Math.round(item.versionNodeCommentCount))
        : undefined
      const versionReusableTemplateCount = typeof item.versionReusableTemplateCount === 'number' && Number.isFinite(item.versionReusableTemplateCount)
        ? Math.max(0, Math.round(item.versionReusableTemplateCount))
        : undefined
      const versionAutoSaveEnabled = item.versionAutoSaveEnabled === true ? true : undefined
      const versionCapturedAt = cleanString(item.versionCapturedAt)?.slice(0, 80)
      const versionEvidence = cleanString(item.versionEvidence)?.slice(0, 400)
      const multiAssetSourceNodeCount = typeof item.multiAssetSourceNodeCount === 'number' && Number.isFinite(item.multiAssetSourceNodeCount)
        ? Math.max(0, Math.round(item.multiAssetSourceNodeCount))
        : undefined
      const multiAssetSourceKindCount = typeof item.multiAssetSourceKindCount === 'number' && Number.isFinite(item.multiAssetSourceKindCount)
        ? Math.max(0, Math.round(item.multiAssetSourceKindCount))
        : undefined
      const multiAssetReferenceRoleCount = typeof item.multiAssetReferenceRoleCount === 'number' && Number.isFinite(item.multiAssetReferenceRoleCount)
        ? Math.max(0, Math.round(item.multiAssetReferenceRoleCount))
        : undefined
      const multiAssetConnectedSourceCount = typeof item.multiAssetConnectedSourceCount === 'number' && Number.isFinite(item.multiAssetConnectedSourceCount)
        ? Math.max(0, Math.round(item.multiAssetConnectedSourceCount))
        : undefined
      const multiAssetOutputNodeCount = typeof item.multiAssetOutputNodeCount === 'number' && Number.isFinite(item.multiAssetOutputNodeCount)
        ? Math.max(0, Math.round(item.multiAssetOutputNodeCount))
        : undefined
      const multiAssetWorkflowScenarioCount = typeof item.multiAssetWorkflowScenarioCount === 'number' && Number.isFinite(item.multiAssetWorkflowScenarioCount)
        ? Math.max(0, Math.round(item.multiAssetWorkflowScenarioCount))
        : undefined
      const multiAssetLineageEdgeCount = typeof item.multiAssetLineageEdgeCount === 'number' && Number.isFinite(item.multiAssetLineageEdgeCount)
        ? Math.max(0, Math.round(item.multiAssetLineageEdgeCount))
        : undefined
      const multiAssetCapturedAt = cleanString(item.multiAssetCapturedAt)?.slice(0, 80)
      const multiAssetEvidence = cleanString(item.multiAssetEvidence)?.slice(0, 500)
      const agentStepCount = typeof item.agentStepCount === 'number' && Number.isFinite(item.agentStepCount)
        ? Math.max(0, Math.round(item.agentStepCount))
        : undefined
      const agentActorCount = typeof item.agentActorCount === 'number' && Number.isFinite(item.agentActorCount)
        ? Math.max(0, Math.round(item.agentActorCount))
        : undefined
      const agentTaskCreatedCount = typeof item.agentTaskCreatedCount === 'number' && Number.isFinite(item.agentTaskCreatedCount)
        ? Math.max(0, Math.round(item.agentTaskCreatedCount))
        : undefined
      const agentTaskCreatedAt = cleanString(item.agentTaskCreatedAt)?.slice(0, 80)
      const agentEvidence = cleanString(item.agentEvidence)?.slice(0, 400)
      const mobileViewportProofCount = typeof item.mobileViewportProofCount === 'number' && Number.isFinite(item.mobileViewportProofCount)
        ? Math.max(0, Math.round(item.mobileViewportProofCount))
        : undefined
      const mobileViewportRequiredCount = typeof item.mobileViewportRequiredCount === 'number' && Number.isFinite(item.mobileViewportRequiredCount)
        ? Math.max(0, Math.round(item.mobileViewportRequiredCount))
        : undefined
      const mobileViewportProofCapturedAt = cleanString(item.mobileViewportProofCapturedAt)?.slice(0, 80)
      const mobileViewportEvidence = cleanString(item.mobileViewportEvidence)?.slice(0, 400)
      const mobileViewportBehaviorEvidence = cleanMobileViewportBehaviorEvidence(item.mobileViewportBehaviorEvidence)
      const exportArtifactBackedCategoryCount = typeof item.exportArtifactBackedCategoryCount === 'number' && Number.isFinite(item.exportArtifactBackedCategoryCount)
        ? Math.max(0, Math.round(item.exportArtifactBackedCategoryCount))
        : undefined
      const exportArtifactBackedCompletedCount = typeof item.exportArtifactBackedCompletedCount === 'number' && Number.isFinite(item.exportArtifactBackedCompletedCount)
        ? Math.max(0, Math.round(item.exportArtifactBackedCompletedCount))
        : undefined
      const exportArtifactBackedCapturedAt = cleanString(item.exportArtifactBackedCapturedAt)?.slice(0, 80)
      const exportArtifactEvidence = cleanString(item.exportArtifactEvidence)?.slice(0, 300)
      const runtimeProofStatus = item.runtimeProofStatus === 'passed' || item.runtimeProofStatus === 'warning' || item.runtimeProofStatus === 'blocked'
        ? item.runtimeProofStatus
        : undefined
      const runtimeReadyForLiveProof = item.runtimeReadyForLiveProof === true ? true : undefined
      const runtimeArtifactBackedCategoryCount = typeof item.runtimeArtifactBackedCategoryCount === 'number' && Number.isFinite(item.runtimeArtifactBackedCategoryCount)
        ? Math.max(0, Math.round(item.runtimeArtifactBackedCategoryCount))
        : undefined
      const runtimeArtifactBackedCompletedCount = typeof item.runtimeArtifactBackedCompletedCount === 'number' && Number.isFinite(item.runtimeArtifactBackedCompletedCount)
        ? Math.max(0, Math.round(item.runtimeArtifactBackedCompletedCount))
        : undefined
      const runtimeProviderBackedCategoryCount = typeof item.runtimeProviderBackedCategoryCount === 'number' && Number.isFinite(item.runtimeProviderBackedCategoryCount)
        ? Math.max(0, Math.round(item.runtimeProviderBackedCategoryCount))
        : undefined
      const runtimeProviderBackedCompletedCount = typeof item.runtimeProviderBackedCompletedCount === 'number' && Number.isFinite(item.runtimeProviderBackedCompletedCount)
        ? Math.max(0, Math.round(item.runtimeProviderBackedCompletedCount))
        : undefined
      const runtimeActiveRunCount = typeof item.runtimeActiveRunCount === 'number' && Number.isFinite(item.runtimeActiveRunCount)
        ? Math.max(0, Math.round(item.runtimeActiveRunCount))
        : undefined
      const runtimeStaleActiveRunCount = typeof item.runtimeStaleActiveRunCount === 'number' && Number.isFinite(item.runtimeStaleActiveRunCount)
        ? Math.max(0, Math.round(item.runtimeStaleActiveRunCount))
        : undefined
      const runtimeFailedRunCount = typeof item.runtimeFailedRunCount === 'number' && Number.isFinite(item.runtimeFailedRunCount)
        ? Math.max(0, Math.round(item.runtimeFailedRunCount))
        : undefined
      const runtimeFailureRatePercent = typeof item.runtimeFailureRatePercent === 'number' && Number.isFinite(item.runtimeFailureRatePercent)
        ? Math.min(100, Math.max(0, Math.round(item.runtimeFailureRatePercent)))
        : undefined
      const runtimeProofCapturedAt = cleanString(item.runtimeProofCapturedAt)?.slice(0, 80)
      const runtimeEvidence = cleanString(item.runtimeEvidence)?.slice(0, 400)
      const runtimeProviderEvidenceCapturedAt = cleanString(item.runtimeProviderEvidenceCapturedAt)?.slice(0, 80)
      const runtimeProviderEvidence = cleanString(item.runtimeProviderEvidence)?.slice(0, 400)
      if (
        !proofUrl
        && !notes
        && !capturedAt
        && !capturedBy
        && !sourceTitle
        && !sourceUrl
        && !sourceCheckedAt
        && !sourceEvidenceCheckedAt
        && sourceEvidenceReachable === undefined
        && sourceEvidenceStatus === undefined
        && !sourceEvidenceContentType
        && !sourceSignalsVerifiedAt
        && sourceSignalsMatched === undefined
        && !sourceSignalsMissing.length
        && !sourceSignals.length
        && !higgsfieldUiEvidenceUrl
        && !canvasEvidenceUrl
        && !canvasEvidenceCheckedAt
        && canvasEvidenceReachable === undefined
        && canvasEvidenceStatus === undefined
        && !canvasEvidenceContentType
        && !directComparisonAt
        && !directComparisonVerdict
        && !directComparisonNotes
        && !orgId
        && canvasVersion === undefined
        && !graphSignature
        && nodeCount === undefined
        && edgeCount === undefined
        && collaborationRemoteActorCount === undefined
        && collaborationRemoteEventCount === undefined
        && collaborationRemoteMutationCount === undefined
        && collaborationRemoteMutationKindCount === undefined
        && collaborationRemoteTouchedNodeCount === undefined
        && collaborationRemoteTouchedEdgeCount === undefined
        && !collaborationRemoteGraphSignature
        && !collaborationRemoteSource
        && !collaborationRemoteOutcome
        && collaborationStreamConnected === undefined
        && !collaborationCapturedAt
        && !collaborationEvidence
        && !collaborationRemoteMutations.length
        && editingLocalEventCount === undefined
        && editingNodeDropCount === undefined
        && editingNodeMoveCount === undefined
        && editingConnectionCount === undefined
        && editingConfiguredGenerationCount === undefined
        && !editingCapturedAt
        && !editingEvidence
        && maskingEditNodeCount === undefined
        && maskingPromptCount === undefined
        && maskingIntentCount === undefined
        && maskingRegionCount === undefined
        && maskingBrushStrokeCount === undefined
        && maskingBlendControlCount === undefined
        && !maskingCapturedAt
        && !maskingEvidence
        && generationModelCount === undefined
        && generationReferenceNodeCount === undefined
        && generationReferenceRoleCount === undefined
        && generationLinkedReferenceCount === undefined
        && !generationMultiReferenceCapturedAt
        && !generationMultiReferenceEvidence
        && versionSnapshotCount === undefined
        && versionRestorableSnapshotCount === undefined
        && versionNodeCommentCount === undefined
        && versionReusableTemplateCount === undefined
        && versionAutoSaveEnabled === undefined
        && !versionCapturedAt
        && !versionEvidence
        && multiAssetSourceNodeCount === undefined
        && multiAssetSourceKindCount === undefined
        && multiAssetReferenceRoleCount === undefined
        && multiAssetConnectedSourceCount === undefined
        && multiAssetOutputNodeCount === undefined
        && multiAssetWorkflowScenarioCount === undefined
        && multiAssetLineageEdgeCount === undefined
        && !multiAssetCapturedAt
        && !multiAssetEvidence
        && agentStepCount === undefined
        && agentActorCount === undefined
        && agentTaskCreatedCount === undefined
        && !agentTaskCreatedAt
        && !agentEvidence
        && mobileViewportProofCount === undefined
        && mobileViewportRequiredCount === undefined
        && !mobileViewportProofCapturedAt
        && !mobileViewportEvidence
        && !mobileViewportBehaviorEvidence.length
        && exportArtifactBackedCategoryCount === undefined
        && exportArtifactBackedCompletedCount === undefined
        && !exportArtifactBackedCapturedAt
        && !exportArtifactEvidence
        && !runtimeProofStatus
        && runtimeReadyForLiveProof === undefined
        && runtimeArtifactBackedCategoryCount === undefined
        && runtimeArtifactBackedCompletedCount === undefined
        && runtimeProviderBackedCategoryCount === undefined
        && runtimeProviderBackedCompletedCount === undefined
        && runtimeActiveRunCount === undefined
        && runtimeStaleActiveRunCount === undefined
        && runtimeFailedRunCount === undefined
        && runtimeFailureRatePercent === undefined
        && !runtimeProofCapturedAt
        && !runtimeEvidence
        && !runtimeProviderEvidenceCapturedAt
        && !runtimeProviderEvidence
      ) return []
      return [[key.slice(0, 80), {
        proofUrl,
        notes,
        capturedAt,
        capturedBy,
        sourceTitle,
        sourceUrl,
        sourceCheckedAt,
        ...(sourceEvidenceCheckedAt ? { sourceEvidenceCheckedAt } : {}),
        ...(sourceEvidenceReachable !== undefined ? { sourceEvidenceReachable } : {}),
        ...(sourceEvidenceStatus !== undefined ? { sourceEvidenceStatus } : {}),
        ...(sourceEvidenceContentType ? { sourceEvidenceContentType } : {}),
        ...(sourceSignalsVerifiedAt ? { sourceSignalsVerifiedAt } : {}),
        ...(sourceSignalsMatched !== undefined ? { sourceSignalsMatched } : {}),
        ...(sourceSignalsMissing.length ? { sourceSignalsMissing } : {}),
        sourceSignals,
        higgsfieldUiEvidenceUrl,
        canvasEvidenceUrl,
        ...(canvasEvidenceCheckedAt ? { canvasEvidenceCheckedAt } : {}),
        ...(canvasEvidenceReachable !== undefined ? { canvasEvidenceReachable } : {}),
        ...(canvasEvidenceStatus !== undefined ? { canvasEvidenceStatus } : {}),
        ...(canvasEvidenceContentType ? { canvasEvidenceContentType } : {}),
        directComparisonAt,
        directComparisonVerdict,
        directComparisonNotes,
        ...(orgId ? { orgId } : {}),
        canvasVersion,
        graphSignature,
        nodeCount,
        edgeCount,
        ...(collaborationRemoteActorCount !== undefined ? { collaborationRemoteActorCount } : {}),
        ...(collaborationRemoteEventCount !== undefined ? { collaborationRemoteEventCount } : {}),
        ...(collaborationRemoteMutationCount !== undefined ? { collaborationRemoteMutationCount } : {}),
        ...(collaborationRemoteMutationKindCount !== undefined ? { collaborationRemoteMutationKindCount } : {}),
        ...(collaborationRemoteTouchedNodeCount !== undefined ? { collaborationRemoteTouchedNodeCount } : {}),
        ...(collaborationRemoteTouchedEdgeCount !== undefined ? { collaborationRemoteTouchedEdgeCount } : {}),
        ...(collaborationRemoteGraphSignature ? { collaborationRemoteGraphSignature } : {}),
        ...(collaborationRemoteSource ? { collaborationRemoteSource } : {}),
        ...(collaborationRemoteOutcome ? { collaborationRemoteOutcome } : {}),
        ...(collaborationStreamConnected !== undefined ? { collaborationStreamConnected } : {}),
        ...(collaborationCapturedAt ? { collaborationCapturedAt } : {}),
        ...(collaborationEvidence ? { collaborationEvidence } : {}),
        ...(collaborationRemoteMutations.length ? { collaborationRemoteMutations } : {}),
        ...(editingLocalEventCount !== undefined ? { editingLocalEventCount } : {}),
        ...(editingNodeDropCount !== undefined ? { editingNodeDropCount } : {}),
        ...(editingNodeMoveCount !== undefined ? { editingNodeMoveCount } : {}),
        ...(editingConnectionCount !== undefined ? { editingConnectionCount } : {}),
        ...(editingConfiguredGenerationCount !== undefined ? { editingConfiguredGenerationCount } : {}),
        ...(editingCapturedAt ? { editingCapturedAt } : {}),
        ...(editingEvidence ? { editingEvidence } : {}),
        ...(maskingEditNodeCount !== undefined ? { maskingEditNodeCount } : {}),
        ...(maskingPromptCount !== undefined ? { maskingPromptCount } : {}),
        ...(maskingIntentCount !== undefined ? { maskingIntentCount } : {}),
        ...(maskingRegionCount !== undefined ? { maskingRegionCount } : {}),
        ...(maskingBrushStrokeCount !== undefined ? { maskingBrushStrokeCount } : {}),
        ...(maskingBlendControlCount !== undefined ? { maskingBlendControlCount } : {}),
        ...(maskingCapturedAt ? { maskingCapturedAt } : {}),
        ...(maskingEvidence ? { maskingEvidence } : {}),
        ...(generationModelCount !== undefined ? { generationModelCount } : {}),
        ...(generationReferenceNodeCount !== undefined ? { generationReferenceNodeCount } : {}),
        ...(generationReferenceRoleCount !== undefined ? { generationReferenceRoleCount } : {}),
        ...(generationLinkedReferenceCount !== undefined ? { generationLinkedReferenceCount } : {}),
        ...(generationMultiReferenceCapturedAt ? { generationMultiReferenceCapturedAt } : {}),
        ...(generationMultiReferenceEvidence ? { generationMultiReferenceEvidence } : {}),
        ...(versionSnapshotCount !== undefined ? { versionSnapshotCount } : {}),
        ...(versionRestorableSnapshotCount !== undefined ? { versionRestorableSnapshotCount } : {}),
        ...(versionNodeCommentCount !== undefined ? { versionNodeCommentCount } : {}),
        ...(versionReusableTemplateCount !== undefined ? { versionReusableTemplateCount } : {}),
        ...(versionAutoSaveEnabled !== undefined ? { versionAutoSaveEnabled } : {}),
        ...(versionCapturedAt ? { versionCapturedAt } : {}),
        ...(versionEvidence ? { versionEvidence } : {}),
        ...(multiAssetSourceNodeCount !== undefined ? { multiAssetSourceNodeCount } : {}),
        ...(multiAssetSourceKindCount !== undefined ? { multiAssetSourceKindCount } : {}),
        ...(multiAssetReferenceRoleCount !== undefined ? { multiAssetReferenceRoleCount } : {}),
        ...(multiAssetConnectedSourceCount !== undefined ? { multiAssetConnectedSourceCount } : {}),
        ...(multiAssetOutputNodeCount !== undefined ? { multiAssetOutputNodeCount } : {}),
        ...(multiAssetWorkflowScenarioCount !== undefined ? { multiAssetWorkflowScenarioCount } : {}),
        ...(multiAssetLineageEdgeCount !== undefined ? { multiAssetLineageEdgeCount } : {}),
        ...(multiAssetCapturedAt ? { multiAssetCapturedAt } : {}),
        ...(multiAssetEvidence ? { multiAssetEvidence } : {}),
        ...(agentStepCount !== undefined ? { agentStepCount } : {}),
        ...(agentActorCount !== undefined ? { agentActorCount } : {}),
        ...(agentTaskCreatedCount !== undefined ? { agentTaskCreatedCount } : {}),
        ...(agentTaskCreatedAt ? { agentTaskCreatedAt } : {}),
        ...(agentEvidence ? { agentEvidence } : {}),
        ...(mobileViewportProofCount !== undefined ? { mobileViewportProofCount } : {}),
        ...(mobileViewportRequiredCount !== undefined ? { mobileViewportRequiredCount } : {}),
        ...(mobileViewportProofCapturedAt ? { mobileViewportProofCapturedAt } : {}),
        ...(mobileViewportEvidence ? { mobileViewportEvidence } : {}),
        ...(mobileViewportBehaviorEvidence.length ? { mobileViewportBehaviorEvidence } : {}),
        ...(exportArtifactBackedCategoryCount !== undefined ? { exportArtifactBackedCategoryCount } : {}),
        ...(exportArtifactBackedCompletedCount !== undefined ? { exportArtifactBackedCompletedCount } : {}),
        ...(exportArtifactBackedCapturedAt ? { exportArtifactBackedCapturedAt } : {}),
        ...(exportArtifactEvidence ? { exportArtifactEvidence } : {}),
        ...(runtimeProofStatus ? { runtimeProofStatus } : {}),
        ...(runtimeReadyForLiveProof !== undefined ? { runtimeReadyForLiveProof } : {}),
        ...(runtimeArtifactBackedCategoryCount !== undefined ? { runtimeArtifactBackedCategoryCount } : {}),
        ...(runtimeArtifactBackedCompletedCount !== undefined ? { runtimeArtifactBackedCompletedCount } : {}),
        ...(runtimeProviderBackedCategoryCount !== undefined ? { runtimeProviderBackedCategoryCount } : {}),
        ...(runtimeProviderBackedCompletedCount !== undefined ? { runtimeProviderBackedCompletedCount } : {}),
        ...(runtimeActiveRunCount !== undefined ? { runtimeActiveRunCount } : {}),
        ...(runtimeStaleActiveRunCount !== undefined ? { runtimeStaleActiveRunCount } : {}),
        ...(runtimeFailedRunCount !== undefined ? { runtimeFailedRunCount } : {}),
        ...(runtimeFailureRatePercent !== undefined ? { runtimeFailureRatePercent } : {}),
        ...(runtimeProofCapturedAt ? { runtimeProofCapturedAt } : {}),
        ...(runtimeEvidence ? { runtimeEvidence } : {}),
        ...(runtimeProviderEvidenceCapturedAt ? { runtimeProviderEvidenceCapturedAt } : {}),
        ...(runtimeProviderEvidence ? { runtimeProviderEvidence } : {}),
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
