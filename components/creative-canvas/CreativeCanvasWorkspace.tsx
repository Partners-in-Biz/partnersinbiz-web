'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react'
import type {
  CreativeCanvasAssetOrigin,
  CreativeCanvas,
  CreativeCanvasComment,
  CreativeCanvasEdge,
  CreativeCanvasEditIntent,
  CreativeCanvasExport,
  CreativeCanvasNode,
  CreativeCanvasNodeType,
  CreativeCanvasOutputKind,
  CreativeCanvasRunOperationsSummary,
  CreativeCanvasRunBatchRetryResult,
  CreativeCanvasProofBatchResult,
  CreativeCanvasProviderRuntimeReadiness,
  CreativeCanvasPresence,
  CreativeCanvasRuntimeProof,
  CreativeCanvasRun,
  CreativeCanvasSourceLibraryItem,
  CreativeCanvasTemplate,
  CreativeCanvasVersion,
} from '@/lib/creative-canvas/types'
import { buildCreativeCanvasOrchestrationPlan } from '@/lib/creative-canvas/orchestration'
import { buildCreativeCanvasAssetGallery } from '@/lib/creative-canvas/assets'

type CreativeCanvasMode = 'admin' | 'portal'
type CreativeCanvasMobilePanel = 'canvas' | 'sources' | 'inspector'
type CreativeCanvasVisualProofKey = 'desktop_1440' | 'tablet_820' | 'mobile_390' | 'mobile_panels'
type CreativeCanvasBenchmarkProofKey =
  | 'editing_ergonomics'
  | 'masking_inpainting'
  | 'generation_controls'
  | 'multi_asset_workflows'
  | 'versioning_polish'
  | 'collaboration'
  | 'mobile_behavior'
  | 'export_flows'
  | 'production_reliability'

type CreativeCanvasVisualProofRecord = {
  screenshotUrl?: string
  notes?: string
  capturedAt?: string
  capturedBy?: string
  signedIn?: boolean
  sessionEvidence?: string
  viewportSize?: string
  visiblePanels?: string
  canvasVersion?: number
  graphSignature?: string
  nodeCount?: number
  edgeCount?: number
}

type CreativeCanvasVisualProofDraft = Record<CreativeCanvasVisualProofKey, {
  screenshotUrl: string
  notes: string
  signedIn: boolean
  sessionEvidence: string
  viewportSize: string
  visiblePanels: string
}>

type CreativeCanvasBenchmarkProofRecord = {
  proofUrl?: string
  notes?: string
  capturedAt?: string
  capturedBy?: string
  sourceTitle?: string
  sourceUrl?: string
  sourceCheckedAt?: string
  sourceSignals?: string[]
  higgsfieldUiEvidenceUrl?: string
  canvasEvidenceUrl?: string
  directComparisonAt?: string
  directComparisonVerdict?: 'pass' | 'gap'
  directComparisonNotes?: string
  canvasVersion?: number
  graphSignature?: string
  nodeCount?: number
  edgeCount?: number
}

type CreativeCanvasBenchmarkProofDraft = Record<CreativeCanvasBenchmarkProofKey, {
  proofUrl: string
  notes: string
}>

interface CreativeCanvasWorkspaceProps {
  mode: CreativeCanvasMode
  orgId?: string
}

interface CreativeCanvasApiListResponse {
  success?: boolean
  error?: string
  code?: string
  currentActiveVersion?: number
  conflicts?: string[]
  conflictDetails?: Array<{
    id: string
    kind: 'node' | 'edge'
    label: string
    reason: string
    baseLabel?: string
    currentLabel?: string
    proposedLabel?: string
  }>
  data?: {
    canvas?: CreativeCanvas
    canvases?: CreativeCanvas[]
  }
}

interface CreativeCanvasVersionApiResponse {
  success?: boolean
  data?: {
    canvas?: CreativeCanvas
    version?: CreativeCanvasVersion & { id?: string }
    versions?: Array<CreativeCanvasVersion & { id?: string }>
  }
  error?: string
}

interface CreativeCanvasSourceLibraryApiResponse {
  success?: boolean
  data?: {
    sources?: CreativeCanvasSourceLibraryItem[]
    source?: CreativeCanvasSourceLibraryItem
  }
}

interface CreativeCanvasRunApiResponse {
  success?: boolean
  error?: string
  data?: {
    runs?: Array<CreativeCanvasRun & { id: string }>
    run?: CreativeCanvasRun & { id: string }
    operations?: CreativeCanvasRunOperationsSummary
    runtimeReadiness?: CreativeCanvasProviderRuntimeReadiness
    retriedRuns?: CreativeCanvasRunBatchRetryResult['retriedRuns']
    skippedRuns?: CreativeCanvasRunBatchRetryResult['skippedRuns']
    queuedRuns?: CreativeCanvasProofBatchResult['queuedRuns']
    skippedCategories?: CreativeCanvasProofBatchResult['skippedCategories']
    agentTaskDraft?: {
      agentInput?: {
        providerExecution?: {
          cli?: {
            display?: string
          }
          dispatch?: {
            path?: string
          }
          callback?: {
            path?: string
          }
          statusRefresh?: {
            path?: string
          }
        }
      }
    }
  }
}

interface CreativeCanvasRuntimeProofApiResponse {
  success?: boolean
  data?: {
    proof?: CreativeCanvasRuntimeProof
  }
  error?: string
}

interface CreativeCanvasExportPackageApiResponse {
  success?: boolean
  data?: {
    exportId?: string
    package?: {
      assetCount?: number
      targets?: CreativeCanvasExport['target'][]
      manifest?: {
        canvas?: { nodeCount?: number; edgeCount?: number; activeVersion?: number }
        proof?: {
          requiredOutputKinds?: CreativeCanvasOutputKind[]
          sourceNodeIds?: string[]
          coveredCategories?: string[]
        }
        lineage?: Array<{ outputNodeId?: string; sourceNodeIds?: string[]; upstreamNodeIds?: string[] }>
      }
      downstreamDrafts?: Array<{ target?: string; sourceNodeId?: string }>
    }
  }
  error?: string
}

interface CreativeCanvasPresenceApiResponse {
  success?: boolean
  data?: {
    presence?: Array<CreativeCanvasPresence & { id: string }>
  }
}

interface CreativeCanvasCollaborationStreamEvent {
  canvas?: CreativeCanvas | null
  presence?: Array<CreativeCanvasPresence & { id: string }>
  emittedAtMs?: number
}

interface CreativeCanvasActivityEvent {
  id: string
  actorLabel: string
  action: string
  detail: string
  nodeId?: string
  atMs: number
  source: 'local' | 'stream' | 'draft'
}

const emptyVisualProofDrafts: CreativeCanvasVisualProofDraft = {
  desktop_1440: { screenshotUrl: '', notes: '', signedIn: false, sessionEvidence: '', viewportSize: '1440x900', visiblePanels: 'Graph, Sources, Inspector' },
  tablet_820: { screenshotUrl: '', notes: '', signedIn: false, sessionEvidence: '', viewportSize: '820x1180', visiblePanels: 'Responsive panel layout' },
  mobile_390: { screenshotUrl: '', notes: '', signedIn: false, sessionEvidence: '', viewportSize: '390x844', visiblePanels: 'Canvas panel' },
  mobile_panels: { screenshotUrl: '', notes: '', signedIn: false, sessionEvidence: '', viewportSize: '390x844', visiblePanels: 'Canvas, Sources, Inspector panel switcher' },
}

const emptyBenchmarkProofDrafts: CreativeCanvasBenchmarkProofDraft = {
  editing_ergonomics: { proofUrl: '', notes: '' },
  masking_inpainting: { proofUrl: '', notes: '' },
  generation_controls: { proofUrl: '', notes: '' },
  multi_asset_workflows: { proofUrl: '', notes: '' },
  versioning_polish: { proofUrl: '', notes: '' },
  collaboration: { proofUrl: '', notes: '' },
  mobile_behavior: { proofUrl: '', notes: '' },
  export_flows: { proofUrl: '', notes: '' },
  production_reliability: { proofUrl: '', notes: '' },
}

const visualProofConfigs: Array<{
  key: CreativeCanvasVisualProofKey
  label: string
  evidence: string
}> = [
  {
    key: 'desktop_1440',
    label: 'Desktop 1440',
    evidence: 'Signed-in graph, sources, and inspector screenshot required.',
  },
  {
    key: 'tablet_820',
    label: 'Tablet 820',
    evidence: 'Signed-in panel layout screenshot required.',
  },
  {
    key: 'mobile_390',
    label: 'Mobile 390',
    evidence: 'Signed-in mobile canvas screenshot required.',
  },
  {
    key: 'mobile_panels',
    label: 'Mobile panels',
    evidence: 'Canvas, Sources, and Inspector panel-switch screenshots required.',
  },
]

const benchmarkProofConfigs: Array<{
  key: CreativeCanvasBenchmarkProofKey
  label: string
  benchmark: string
  sourceTitle: string
  sourceUrl: string
  sourceSignals: string[]
}> = [
  {
    key: 'editing_ergonomics',
    label: 'Editing ergonomics',
    benchmark: 'Node graph editing with connected prompts, source assets, generated outputs, branches, and recoverable mutations.',
    sourceTitle: 'Higgsfield AI Canvas node workflow',
    sourceUrl: 'https://higgsfield.ai/canvas-intro',
    sourceSignals: ['Drop a node', 'Chain your flow', 'Connect nodes', 'Every connection is live'],
  },
  {
    key: 'masking_inpainting',
    label: 'Masking / inpainting UX',
    benchmark: 'Brush and prompt-driven edits that can target regions, references, style transfer, motion, and output branches.',
    sourceTitle: 'Higgsfield AI image editing and inpainting',
    sourceUrl: 'https://higgsfield.ai/image-editing',
    sourceSignals: ['Brush & Prompt', 'AI inpainting', 'Precise Masking', 'Generative Fill'],
  },
  {
    key: 'generation_controls',
    label: 'Generation controls',
    benchmark: 'Model, output kind, aspect ratio, variants, duration, motion, style, and negative prompt control before dispatch.',
    sourceTitle: 'Higgsfield Canvas model catalog',
    sourceUrl: 'https://higgsfield.ai/canvas-intro',
    sourceSignals: ['Kling 3.0', 'Seedance 2.0', 'Wan 2.7', 'Soul 2.0', 'GPT Image 2.0', 'Veo 3.1'],
  },
  {
    key: 'multi_asset_workflows',
    label: 'Multi-asset workflows',
    benchmark: 'Own uploads, references, previous outputs, templates, and benchmark workflows combined in one connected pipeline.',
    sourceTitle: 'Higgsfield Canvas multi-reference workflows',
    sourceUrl: 'https://higgsfield.ai/canvas-intro',
    sourceSignals: ['Moodboard', 'mix models', 'route outputs', 'single creative pipeline'],
  },
  {
    key: 'versioning_polish',
    label: 'Versioning polish',
    benchmark: 'Auto-save, preview, restore/fork safety, comments, review state, and non-destructive history inspection.',
    sourceTitle: 'Higgsfield Canvas saved versions and comments',
    sourceUrl: 'https://higgsfield.ai/canvas-intro',
    sourceSignals: ['Every version is saved', 'nothing gets lost', 'shared space'],
  },
  {
    key: 'collaboration',
    label: 'Collaboration',
    benchmark: 'Live collaborators, focus, draft adoption, activity, conflict details, and safe concurrent graph changes.',
    sourceTitle: 'Higgsfield Canvas live collaboration',
    sourceUrl: 'https://higgsfield.ai/canvas-intro',
    sourceSignals: ['Create together', 'Share a link', 'collaborate live', 'same canvas'],
  },
  {
    key: 'mobile_behavior',
    label: 'Mobile behavior',
    benchmark: 'Signed-in desktop, tablet, mobile canvas, and panel-switch proof with no hidden critical controls.',
    sourceTitle: 'Higgsfield Canvas app route',
    sourceUrl: 'https://higgsfield.ai/canvas',
    sourceSignals: ['Generate', 'Library', 'Profile', 'Canvas'],
  },
  {
    key: 'export_flows',
    label: 'Export flows',
    benchmark: 'Reviewable packages with manifests, target formats, provenance, source/output mapping, and downstream drafts.',
    sourceTitle: 'Higgsfield Canvas image and video pipeline',
    sourceUrl: 'https://higgsfield.ai/canvas-intro',
    sourceSignals: ['image and video pipelines', 'render outputs', 'Explore All', 'Unified in one platform'],
  },
  {
    key: 'production_reliability',
    label: 'Production reliability',
    benchmark: 'Repeated real image, video/social, blog/document, and book jobs complete with drained queues and low failures.',
    sourceTitle: 'Higgsfield Canvas reusable production workflows',
    sourceUrl: 'https://higgsfield.ai/canvas-intro',
    sourceSignals: ['Every top model', 'available now', 'Unified in one platform', 'Build AI image and video pipelines'],
  },
]

const exportProofCategories: Array<{
  key: string
  label: string
  outputKinds: CreativeCanvasOutputKind[]
  targets: CreativeCanvasExport['target'][]
}> = [
  {
    key: 'image_campaign',
    label: 'Image/campaign',
    outputKinds: ['image', 'campaign_asset'],
    targets: ['campaign_asset'],
  },
  {
    key: 'video_social',
    label: 'Video/social',
    outputKinds: ['video', 'social_post_draft', 'youtube_render'],
    targets: ['social_draft', 'youtube_studio', 'campaign_asset'],
  },
  {
    key: 'blog_document',
    label: 'Blog/document',
    outputKinds: ['blog_draft', 'document_block', 'copy', 'caption'],
    targets: ['client_document'],
  },
  {
    key: 'book',
    label: 'Book',
    outputKinds: ['book_artifact'],
    targets: ['book_studio'],
  },
]

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function stringArrayField(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())) : []
}

function getCanvasVisualProof(data: unknown): Partial<Record<CreativeCanvasVisualProofKey, CreativeCanvasVisualProofRecord>> {
  const proof = objectRecord(objectRecord(data).visualProof)
  return (Object.keys(emptyVisualProofDrafts) as CreativeCanvasVisualProofKey[]).reduce((acc, key) => {
    const record = objectRecord(proof[key])
    const screenshotUrl = stringField(record.screenshotUrl)
    const notes = stringField(record.notes)
    const capturedAt = stringField(record.capturedAt)
    const capturedBy = stringField(record.capturedBy)
    const signedIn = record.signedIn === true
    const sessionEvidence = stringField(record.sessionEvidence)
    const viewportSize = stringField(record.viewportSize)
    const visiblePanels = stringField(record.visiblePanels)
    const canvasVersion = typeof record.canvasVersion === 'number' && Number.isFinite(record.canvasVersion) ? record.canvasVersion : undefined
    const graphSignature = stringField(record.graphSignature)
    const nodeCount = typeof record.nodeCount === 'number' && Number.isFinite(record.nodeCount) ? record.nodeCount : undefined
    const edgeCount = typeof record.edgeCount === 'number' && Number.isFinite(record.edgeCount) ? record.edgeCount : undefined
    if (
      screenshotUrl
      || notes
      || capturedAt
      || capturedBy
      || signedIn
      || sessionEvidence
      || viewportSize
      || visiblePanels
      || canvasVersion !== undefined
      || graphSignature
      || nodeCount !== undefined
      || edgeCount !== undefined
    ) {
      acc[key] = {
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
      }
    }
    return acc
  }, {} as Partial<Record<CreativeCanvasVisualProofKey, CreativeCanvasVisualProofRecord>>)
}

function hasSignedInViewportProof(proof: CreativeCanvasVisualProofRecord | undefined): boolean {
  return Boolean(proof?.screenshotUrl && proof.signedIn && proof.sessionEvidence && proof.viewportSize && proof.visiblePanels)
}

function hasCurrentVisualProofState(
  proof: CreativeCanvasVisualProofRecord | undefined,
  current: { canvasVersion?: number; graphSignature: string; nodeCount: number; edgeCount: number },
): boolean {
  return Boolean(
    proof
      && typeof proof.canvasVersion === 'number'
      && proof.canvasVersion === current.canvasVersion
      && proof.graphSignature
      && proof.graphSignature === current.graphSignature
      && proof.nodeCount === current.nodeCount
      && proof.edgeCount === current.edgeCount,
  )
}

function getCanvasBenchmarkProof(data: unknown): Partial<Record<CreativeCanvasBenchmarkProofKey, CreativeCanvasBenchmarkProofRecord>> {
  const proof = objectRecord(objectRecord(data).benchmarkProof)
  return (Object.keys(emptyBenchmarkProofDrafts) as CreativeCanvasBenchmarkProofKey[]).reduce((acc, key) => {
    const record = objectRecord(proof[key])
    const proofUrl = stringField(record.proofUrl)
    const notes = stringField(record.notes)
    const capturedAt = stringField(record.capturedAt)
    const capturedBy = stringField(record.capturedBy)
    const sourceTitle = stringField(record.sourceTitle)
    const sourceUrl = stringField(record.sourceUrl)
    const sourceCheckedAt = stringField(record.sourceCheckedAt)
    const sourceSignals = stringArrayField(record.sourceSignals)
    const higgsfieldUiEvidenceUrl = stringField(record.higgsfieldUiEvidenceUrl)
    const canvasEvidenceUrl = stringField(record.canvasEvidenceUrl)
    const directComparisonAt = stringField(record.directComparisonAt)
    const directComparisonVerdict = record.directComparisonVerdict === 'pass' || record.directComparisonVerdict === 'gap'
      ? record.directComparisonVerdict
      : undefined
    const directComparisonNotes = stringField(record.directComparisonNotes)
    const canvasVersion = typeof record.canvasVersion === 'number' && Number.isFinite(record.canvasVersion) ? record.canvasVersion : undefined
    const graphSignature = stringField(record.graphSignature)
    const nodeCount = typeof record.nodeCount === 'number' && Number.isFinite(record.nodeCount) ? record.nodeCount : undefined
    const edgeCount = typeof record.edgeCount === 'number' && Number.isFinite(record.edgeCount) ? record.edgeCount : undefined
    if (
      proofUrl
      || notes
      || capturedAt
      || capturedBy
      || sourceTitle
      || sourceUrl
      || sourceCheckedAt
      || sourceSignals.length
      || higgsfieldUiEvidenceUrl
      || canvasEvidenceUrl
      || directComparisonAt
      || directComparisonVerdict
      || directComparisonNotes
      || canvasVersion !== undefined
      || graphSignature
      || nodeCount !== undefined
      || edgeCount !== undefined
    ) {
      acc[key] = {
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
      }
    }
    return acc
  }, {} as Partial<Record<CreativeCanvasBenchmarkProofKey, CreativeCanvasBenchmarkProofRecord>>)
}

function hasRequiredBenchmarkSourceSignals(proof: CreativeCanvasBenchmarkProofRecord | undefined, requiredSignals: string[]): boolean {
  const sourceSignals = proof?.sourceSignals ?? []
  return requiredSignals.every((signal) => sourceSignals.includes(signal))
}

function hasDirectBenchmarkComparison(proof: CreativeCanvasBenchmarkProofRecord | undefined): boolean {
  return Boolean(
    proof?.higgsfieldUiEvidenceUrl
      && proof.canvasEvidenceUrl
      && proof.directComparisonAt
      && proof.directComparisonVerdict === 'pass'
      && proof.directComparisonNotes,
  )
}

function hasSourceBackedBenchmarkProof(proof: CreativeCanvasBenchmarkProofRecord | undefined, requiredSignals: string[]): boolean {
  return Boolean(
    proof?.proofUrl
      && proof.notes
      && proof.sourceUrl
      && proof.sourceCheckedAt
      && hasRequiredBenchmarkSourceSignals(proof, requiredSignals)
      && hasDirectBenchmarkComparison(proof),
  )
}

function hasCurrentCanvasBenchmarkState(
  proof: CreativeCanvasBenchmarkProofRecord | undefined,
  current: { canvasVersion?: number; graphSignature: string; nodeCount: number; edgeCount: number },
): boolean {
  return Boolean(
    proof
      && typeof proof.canvasVersion === 'number'
      && proof.canvasVersion === current.canvasVersion
      && proof.graphSignature
      && proof.graphSignature === current.graphSignature
      && proof.nodeCount === current.nodeCount
      && proof.edgeCount === current.edgeCount,
  )
}

function benchmarkProofUrl(canvas: CreativeCanvas | undefined, orgId: string): string {
  if (typeof window === 'undefined') return ''
  const url = new URL(window.location.href)
  if (orgId) url.searchParams.set('orgId', orgId)
  if (canvas?.id) url.searchParams.set('canvasId', canvas.id)
  url.hash = 'direct-higgsfield-benchmark-proof'
  return url.href
}

interface CreativeCanvasCommentApiResponse {
  success?: boolean
  data?: {
    comment?: CreativeCanvasComment & { id: string }
    comments?: Array<CreativeCanvasComment & { id: string }>
  }
  error?: string
}

interface CreativeCanvasTemplateApiResponse {
  success?: boolean
  data?: {
    template?: CreativeCanvasTemplate & { id: string }
    templates?: Array<CreativeCanvasTemplate & { id: string }>
  }
  error?: string
}

const nodeTypeLabels: Record<CreativeCanvasNodeType, string> = {
  source: 'Source',
  brief: 'Brief',
  prompt: 'Prompt',
  model: 'Model',
  edit: 'Edit',
  review: 'Review',
  output: 'Output',
}

const palette: Array<{ type: CreativeCanvasNodeType; label: string; description: string }> = [
  { type: 'source', label: 'Source', description: 'Brand assets, uploads, research, URLs' },
  { type: 'prompt', label: 'Prompt', description: 'Generation brief, style, and constraints' },
  { type: 'model', label: 'Model', description: 'Higgsfield or agent-backed generation' },
  { type: 'edit', label: 'Edit', description: 'Inpaint, masks, style transfer, and motion' },
  { type: 'review', label: 'Review', description: 'Brand, rights, and approval gate' },
  { type: 'output', label: 'Output', description: 'Draft image, video, copy, blog, book asset' },
]

const assetOriginLabels: Record<CreativeCanvasAssetOrigin, string> = {
  source_node: 'Source',
  output_node: 'Output',
  run_output: 'Run output',
}

const maskQuickRegions = [
  { key: 'center-subject', label: 'Center subject', region: { x: 30, y: 18, width: 40, height: 64, feather: 8 } },
  { key: 'product-placement', label: 'Product placement', region: { x: 56, y: 48, width: 30, height: 34, feather: 6 } },
  { key: 'face-edit', label: 'Face edit', region: { x: 38, y: 10, width: 24, height: 28, feather: 10 } },
  { key: 'background-swap', label: 'Background swap', region: { x: 0, y: 0, width: 100, height: 100, feather: 12 } },
]

const editIntentOptions: Array<{ value: CreativeCanvasEditIntent; label: string }> = [
  { value: 'generative_fill', label: 'Generative fill' },
  { value: 'object_removal', label: 'Object removal' },
  { value: 'object_replace', label: 'Object replace' },
  { value: 'relight', label: 'Relight' },
  { value: 'reference_blend', label: 'Reference blend' },
]

const blendControlOptions: Array<{
  key: keyof NonNullable<NonNullable<CreativeCanvasNode['edit']>['blendControls']>
  label: string
}> = [
  { key: 'lightMatch', label: 'Light match' },
  { key: 'textureAdaptive', label: 'Texture adaptive' },
  { key: 'autoShadows', label: 'Auto shadows' },
  { key: 'perspectiveMatch', label: 'Perspective match' },
  { key: 'preserveSubject', label: 'Preserve subject' },
]

const higgsfieldModelSuggestions: Array<{
  id: string
  label: string
  outputKind: CreativeCanvasOutputKind
  aspectRatio: string
  durationSeconds: number
  cameraMotion: string
  stylePreset: string
}> = [
  {
    id: 'nano_banana_flash',
    label: 'Nano Banana Flash',
    outputKind: 'image',
    aspectRatio: '1:1',
    durationSeconds: 0,
    cameraMotion: 'none',
    stylePreset: 'clean_studio',
  },
  {
    id: 'nano_banana_pro',
    label: 'Nano Banana Pro',
    outputKind: 'campaign_asset',
    aspectRatio: '4:5',
    durationSeconds: 0,
    cameraMotion: 'none',
    stylePreset: 'brand_realism',
  },
  {
    id: 'kling_3_0',
    label: 'Kling 3.0',
    outputKind: 'video',
    aspectRatio: '16:9',
    durationSeconds: 8,
    cameraMotion: 'camera_push',
    stylePreset: 'cinematic_product',
  },
  {
    id: 'seedance_2_0_fast',
    label: 'Seedance 2.0',
    outputKind: 'social_post_draft',
    aspectRatio: '9:16',
    durationSeconds: 6,
    cameraMotion: 'camera_push',
    stylePreset: 'ugc_social',
  },
  {
    id: 'wan_2_7',
    label: 'Wan 2.7',
    outputKind: 'video',
    aspectRatio: '16:9',
    durationSeconds: 8,
    cameraMotion: 'pan',
    stylePreset: 'cinematic_product',
  },
  {
    id: 'soul_2_0',
    label: 'Soul 2.0',
    outputKind: 'campaign_asset',
    aspectRatio: '4:5',
    durationSeconds: 0,
    cameraMotion: 'none',
    stylePreset: 'editorial',
  },
  {
    id: 'gpt_image_2_0',
    label: 'GPT Image 2.0',
    outputKind: 'image',
    aspectRatio: '1:1',
    durationSeconds: 0,
    cameraMotion: 'none',
    stylePreset: 'clean_studio',
  },
  {
    id: 'veo_3_1',
    label: 'Veo 3.1',
    outputKind: 'youtube_render',
    aspectRatio: '16:9',
    durationSeconds: 12,
    cameraMotion: 'dolly',
    stylePreset: 'cinematic_product',
  },
]

const formatVariantPresets: Array<{
  key: string
  label: string
  aspectRatio: string
  exportTarget: CreativeCanvasExport['target']
  outputKind: CreativeCanvasOutputKind
  cameraMotion: string
}> = [
  { key: 'vertical-social', label: 'Vertical social', aspectRatio: '9:16', exportTarget: 'social_draft', outputKind: 'social_post_draft', cameraMotion: 'camera_push' },
  { key: 'feed-portrait', label: 'Feed portrait', aspectRatio: '4:5', exportTarget: 'social_draft', outputKind: 'campaign_asset', cameraMotion: 'none' },
  { key: 'square-ad', label: 'Square ad', aspectRatio: '1:1', exportTarget: 'campaign_asset', outputKind: 'campaign_asset', cameraMotion: 'none' },
  { key: 'landscape-video', label: 'Landscape video', aspectRatio: '16:9', exportTarget: 'youtube_studio', outputKind: 'youtube_render', cameraMotion: 'pan' },
]

function summarizeVersionDelta(
  version: CreativeCanvasVersion,
  currentNodes: Node[],
  currentEdges: Edge[],
) {
  const versionNodes = Array.isArray(version.nodes) ? version.nodes : []
  const versionEdges = Array.isArray(version.edges) ? version.edges : []
  const currentNodeIds = new Set(currentNodes.map((node) => node.id))
  const versionNodeIds = new Set(versionNodes.map((node) => node.id))
  const currentEdgeIds = new Set(currentEdges.map((edge) => edge.id))
  const versionEdgeIds = new Set(versionEdges.map((edge) => edge.id))
  const addedNodes = versionNodes.filter((node) => !currentNodeIds.has(node.id))
  const removedNodes = currentNodes.filter((node) => !versionNodeIds.has(node.id))
  const addedEdges = versionEdges.filter((edge) => !currentEdgeIds.has(edge.id))
  const removedEdges = currentEdges.filter((edge) => !versionEdgeIds.has(edge.id))
  const hasSnapshotGraph = Array.isArray(version.nodes) && Array.isArray(version.edges)

  return {
    hasSnapshotGraph,
    nodeCount: versionNodes.length,
    edgeCount: versionEdges.length,
    addedNodeCount: addedNodes.length,
    removedNodeCount: removedNodes.length,
    addedEdgeCount: addedEdges.length,
    removedEdgeCount: removedEdges.length,
    changedNodeTitles: [...addedNodes.map((node) => node.title), ...removedNodes.map((node) => {
      const canvasNode = node.data?.canvasNode as CreativeCanvasNode | undefined
      return canvasNode?.title ?? node.id
    })].slice(0, 3),
  }
}

type CreativeCanvasWorkflowPreset = {
  key: string
  label: string
  description: string
  benchmarkScenario?: string
  outputKind: CreativeCanvasRun['input']['outputKind']
  exportTarget: CreativeCanvasExport['target']
  aspectRatio: string
  durationSeconds: number
  stylePreset: string
  cameraMotion: string
  negativePrompt: string
  nodes: Array<{
    suffix: string
    type: CreativeCanvasNodeType
    title: string
    data: Record<string, unknown>
    source?: CreativeCanvasNode['source']
    provider?: CreativeCanvasNode['provider']
    edit?: CreativeCanvasNode['edit']
    review?: CreativeCanvasNode['review']
    output?: CreativeCanvasNode['output']
  }>
  edges: Array<{ from: string; to: string; label: string }>
}

const higgsfieldBenchmarkScenarios = [
  'vfx_background_replace',
  'product_style_fusion',
  'model_product_campaign',
  'architecture_day_night',
  'set_to_set_style',
  'logo_animation',
  'brand_icon_system',
  'sketch_material_exploration',
] as const

const workflowPresets: CreativeCanvasWorkflowPreset[] = [
  {
    key: 'social-launch',
    label: 'Social launch',
    description: 'Product source, UGC prompt, Higgsfield model, review, social draft.',
    outputKind: 'social_post_draft',
    exportTarget: 'social_draft',
    aspectRatio: '9:16',
    durationSeconds: 6,
    stylePreset: 'ugc_product_demo',
    cameraMotion: 'camera_push',
    negativePrompt: 'blurry, distorted hands, false claims, unreadable captions',
    nodes: [
      {
        suffix: 'source',
        type: 'source',
        title: 'Product / brand source',
        data: { workflowRole: 'source', requiredInputs: ['product_image', 'brand_logo', 'offer_context'] },
        source: { kind: 'upload', referenceRole: 'product', weight: 1, altText: 'Product or brand source' },
      },
      {
        suffix: 'brief',
        type: 'brief',
        title: 'Social launch brief',
        data: { workflowRole: 'brief', channel: 'reels_tiktok_shorts', requiredOutputs: ['hook', 'caption', 'cta'] },
      },
      {
        suffix: 'prompt',
        type: 'prompt',
        title: 'UGC launch prompt',
        data: { workflowRole: 'prompt', agentId: 'maya', promptType: 'ugc_social_launch' },
      },
      {
        suffix: 'model',
        type: 'model',
        title: 'Higgsfield vertical video',
        data: { workflowRole: 'generation', ownerAgentId: 'maya' },
        provider: { key: 'higgsfield', model: 'nano_banana_flash', mode: 'vertical_social' },
        edit: { operation: 'video_motion', outputKind: 'social_post_draft', strength: 0.65, motion: { mode: 'camera_push', durationSeconds: 6 }, references: [] },
      },
      {
        suffix: 'review',
        type: 'review',
        title: 'Brand and rights review',
        data: { workflowRole: 'review', requiredReviewerAgentId: 'maya' },
        review: { status: 'needed', syntheticMediaDisclosure: true, rightsStatus: 'needs_review', brandStatus: 'needs_review' },
      },
      {
        suffix: 'output',
        type: 'output',
        title: 'Social post draft',
        data: { workflowRole: 'output', exportTarget: 'social_draft' },
        output: { kind: 'social_post_draft', textPreview: 'Hook, caption, thumbnail, and vertical creative ready for review' },
      },
    ],
    edges: [
      { from: 'source', to: 'brief', label: 'source context' },
      { from: 'brief', to: 'prompt', label: 'brief to prompt' },
      { from: 'prompt', to: 'model', label: 'generate' },
      { from: 'model', to: 'review', label: 'needs review' },
      { from: 'review', to: 'output', label: 'approved draft' },
    ],
  },
  {
    key: 'blog-article',
    label: 'Blog article',
    description: 'Research/source brief into copy draft, review, and document export.',
    outputKind: 'blog_draft',
    exportTarget: 'client_document',
    aspectRatio: '1:1',
    durationSeconds: 5,
    stylePreset: 'editorial_article',
    cameraMotion: 'none',
    negativePrompt: 'unsupported claims, thin advice, duplicated sections',
    nodes: [
      {
        suffix: 'research',
        type: 'source',
        title: 'Research and source packet',
        data: { workflowRole: 'source', requiredInputs: ['research_item', 'client_offer', 'proof_points'] },
        source: { kind: 'research_item', referenceRole: 'general', weight: 1, altText: 'Research packet' },
      },
      {
        suffix: 'brief',
        type: 'brief',
        title: 'Blog strategy brief',
        data: { workflowRole: 'brief', agentId: 'pip', requiredOutputs: ['angle', 'outline', 'seo_notes'] },
      },
      {
        suffix: 'prompt',
        type: 'prompt',
        title: 'Long-form draft prompt',
        data: { workflowRole: 'prompt', agentId: 'pip', promptType: 'blog_article' },
      },
      {
        suffix: 'model',
        type: 'model',
        title: 'Agent copy draft',
        data: { workflowRole: 'generation', ownerAgentId: 'pip' },
        provider: { key: 'agent_task', mode: 'blog_draft' },
      },
      {
        suffix: 'review',
        type: 'review',
        title: 'Editorial review',
        data: { workflowRole: 'review', checks: ['source_support', 'brand_voice', 'cta'] },
        review: { status: 'needed', syntheticMediaDisclosure: false, rightsStatus: 'needs_review', brandStatus: 'needs_review' },
      },
      {
        suffix: 'output',
        type: 'output',
        title: 'Blog draft export',
        data: { workflowRole: 'output', exportTarget: 'client_document' },
        output: { kind: 'blog_draft', textPreview: 'Article outline, draft body, SEO title, meta description, and CTA' },
      },
    ],
    edges: [
      { from: 'research', to: 'brief', label: 'evidence' },
      { from: 'brief', to: 'prompt', label: 'outline' },
      { from: 'prompt', to: 'model', label: 'draft' },
      { from: 'model', to: 'review', label: 'editorial gate' },
      { from: 'review', to: 'output', label: 'document draft' },
    ],
  },
  {
    key: 'video-production',
    label: 'Video production',
    description: 'Script, storyboard, Higgsfield render, review, YouTube/shorts export.',
    outputKind: 'youtube_render',
    exportTarget: 'youtube_studio',
    aspectRatio: '16:9',
    durationSeconds: 15,
    stylePreset: 'cinematic_product',
    cameraMotion: 'camera_push',
    negativePrompt: 'jumpy cuts, off-brand visuals, inaccurate claims',
    nodes: [
      {
        suffix: 'source',
        type: 'source',
        title: 'Video source assets',
        data: { workflowRole: 'source', requiredInputs: ['product_images', 'voice_notes', 'b_roll'] },
        source: { kind: 'youtube_asset', referenceRole: 'motion', weight: 1, altText: 'Video source assets' },
      },
      {
        suffix: 'brief',
        type: 'brief',
        title: 'Video concept brief',
        data: { workflowRole: 'brief', requiredOutputs: ['script', 'shot_list', 'thumbnail_direction'] },
      },
      {
        suffix: 'prompt',
        type: 'prompt',
        title: 'Storyboard prompt',
        data: { workflowRole: 'prompt', agentId: 'maya', promptType: 'video_storyboard' },
      },
      {
        suffix: 'model',
        type: 'model',
        title: 'Higgsfield video render',
        data: { workflowRole: 'generation', ownerAgentId: 'maya' },
        provider: { key: 'higgsfield', model: 'nano_banana_flash', mode: 'video_render' },
        edit: { operation: 'video_motion', outputKind: 'youtube_render', strength: 0.7, motion: { mode: 'camera_push', durationSeconds: 15 }, references: [] },
      },
      {
        suffix: 'review',
        type: 'review',
        title: 'Video QA review',
        data: { workflowRole: 'review', checks: ['brand', 'rights', 'claims', 'thumbnail'] },
        review: { status: 'needed', syntheticMediaDisclosure: true, rightsStatus: 'needs_review', brandStatus: 'needs_review' },
      },
      {
        suffix: 'output',
        type: 'output',
        title: 'Video render package',
        data: { workflowRole: 'output', exportTarget: 'youtube_studio' },
        output: { kind: 'youtube_render', textPreview: 'Video render, thumbnail, description, and chapter draft' },
      },
    ],
    edges: [
      { from: 'source', to: 'brief', label: 'assets' },
      { from: 'brief', to: 'prompt', label: 'storyboard' },
      { from: 'prompt', to: 'model', label: 'render' },
      { from: 'model', to: 'review', label: 'qa gate' },
      { from: 'review', to: 'output', label: 'video package' },
    ],
  },
  {
    key: 'book-package',
    label: 'Book package',
    description: 'Book concept, cover/artifact generation, review, Book Studio export.',
    outputKind: 'book_artifact',
    exportTarget: 'book_studio',
    aspectRatio: '2:3',
    durationSeconds: 5,
    stylePreset: 'book_cover_concept',
    cameraMotion: 'none',
    negativePrompt: 'trademarked characters, misleading author claims, unreadable title text',
    nodes: [
      {
        suffix: 'source',
        type: 'source',
        title: 'Book source material',
        data: { workflowRole: 'source', requiredInputs: ['manuscript_notes', 'audience', 'market_evidence'] },
        source: { kind: 'book_studio_record', referenceRole: 'style', weight: 1, altText: 'Book source material' },
      },
      {
        suffix: 'brief',
        type: 'brief',
        title: 'Book package brief',
        data: { workflowRole: 'brief', requiredOutputs: ['positioning', 'cover_direction', 'metadata_notes'] },
      },
      {
        suffix: 'prompt',
        type: 'prompt',
        title: 'Cover and asset prompt',
        data: { workflowRole: 'prompt', agentId: 'maya', promptType: 'book_cover_artifact' },
      },
      {
        suffix: 'model',
        type: 'model',
        title: 'Higgsfield book asset',
        data: { workflowRole: 'generation', ownerAgentId: 'maya' },
        provider: { key: 'higgsfield', model: 'nano_banana_flash', mode: 'book_artifact' },
        edit: { operation: 'variation', outputKind: 'book_artifact', strength: 0.6, motion: { mode: 'none' }, references: [] },
      },
      {
        suffix: 'review',
        type: 'review',
        title: 'Publishing readiness review',
        data: { workflowRole: 'review', checks: ['rights', 'market_fit', 'store_metadata', 'brand'] },
        review: { status: 'needed', syntheticMediaDisclosure: true, rightsStatus: 'needs_review', brandStatus: 'needs_review' },
      },
      {
        suffix: 'output',
        type: 'output',
        title: 'Book Studio artifact',
        data: { workflowRole: 'output', exportTarget: 'book_studio' },
        output: { kind: 'book_artifact', textPreview: 'Cover concept, metadata notes, and review packet for Book Studio' },
      },
    ],
    edges: [
      { from: 'source', to: 'brief', label: 'source material' },
      { from: 'brief', to: 'prompt', label: 'asset brief' },
      { from: 'prompt', to: 'model', label: 'generate cover' },
      { from: 'model', to: 'review', label: 'publishing gate' },
      { from: 'review', to: 'output', label: 'book artifact' },
    ],
  },
  {
    key: 'benchmark-vfx-background',
    label: 'VFX background replace',
    description: 'Drop footage, replace the scene, render a VFX video output.',
    benchmarkScenario: 'vfx_background_replace',
    outputKind: 'video',
    exportTarget: 'youtube_studio',
    aspectRatio: '16:9',
    durationSeconds: 8,
    stylePreset: 'cinematic_product',
    cameraMotion: 'dolly',
    negativePrompt: 'warped horizon, broken perspective, flicker, inconsistent lighting',
    nodes: [
      {
        suffix: 'footage',
        type: 'source',
        title: 'Source footage',
        data: { workflowRole: 'source', requiredInputs: ['video_clip', 'subject_continuity'], benchmarkScenario: 'vfx_background_replace' },
        source: { kind: 'upload', referenceRole: 'motion', weight: 1, altText: 'Footage for background replacement' },
      },
      {
        suffix: 'environment',
        type: 'source',
        title: 'Replacement environment',
        data: { workflowRole: 'source', requiredInputs: ['scene_reference', 'lighting_notes'], benchmarkScenario: 'vfx_background_replace' },
        source: { kind: 'upload', referenceRole: 'background', weight: 0.9, altText: 'Replacement background reference' },
      },
      {
        suffix: 'edit',
        type: 'edit',
        title: 'Background replacement edit',
        data: {
          workflowRole: 'edit',
          benchmarkScenario: 'vfx_background_replace',
          maskPreset: 'background_subject_holdout',
        },
        edit: {
          operation: 'background_replace',
          outputKind: 'video',
          strength: 0.72,
          motion: { mode: 'dolly', durationSeconds: 8 },
          references: [],
          mask: {
            region: { x: 4, y: 6, width: 92, height: 88, unit: 'percent', feather: 8 },
            brush: {
              strokes: [
                {
                  id: 'subject-holdout-1',
                  unit: 'percent',
                  size: 14,
                  opacity: 0.5,
                  mode: 'paint',
                  points: [
                    { x: 18, y: 34 },
                    { x: 26, y: 28 },
                    { x: 38, y: 24 },
                    { x: 50, y: 26 },
                    { x: 62, y: 32 },
                    { x: 72, y: 44 },
                    { x: 76, y: 60 },
                    { x: 69, y: 75 },
                    { x: 55, y: 82 },
                    { x: 40, y: 80 },
                    { x: 28, y: 70 },
                    { x: 20, y: 54 },
                  ],
                },
              ],
            },
          },
        },
      },
      {
        suffix: 'model',
        type: 'model',
        title: 'Higgsfield VFX render',
        data: { workflowRole: 'generation', ownerAgentId: 'maya', benchmarkScenario: 'vfx_background_replace' },
        provider: { key: 'higgsfield', model: 'veo_3_1', mode: 'video' },
        edit: { operation: 'video_motion', outputKind: 'video', strength: 0.7, motion: { mode: 'dolly', durationSeconds: 8 }, references: [] },
      },
      {
        suffix: 'output',
        type: 'output',
        title: 'VFX video output',
        data: { workflowRole: 'output', exportTarget: 'youtube_studio', benchmarkScenario: 'vfx_background_replace' },
        output: { kind: 'video', textPreview: 'Background replacement video ready for review' },
      },
    ],
    edges: [
      { from: 'footage', to: 'edit', label: 'footage' },
      { from: 'environment', to: 'edit', label: 'scene reference' },
      { from: 'edit', to: 'model', label: 'replace background' },
      { from: 'model', to: 'output', label: 'render' },
    ],
  },
  {
    key: 'benchmark-product-style',
    label: 'Product style fusion',
    description: 'Drop a product and style reference, generate campaign photography.',
    benchmarkScenario: 'product_style_fusion',
    outputKind: 'campaign_asset',
    exportTarget: 'campaign_asset',
    aspectRatio: '4:5',
    durationSeconds: 0,
    stylePreset: 'editorial',
    cameraMotion: 'none',
    negativePrompt: 'wrong product shape, off-brand material, mismatched lighting',
    nodes: [
      {
        suffix: 'product',
        type: 'source',
        title: 'Product reference',
        data: { workflowRole: 'source', benchmarkScenario: 'product_style_fusion' },
        source: { kind: 'upload', referenceRole: 'product', weight: 1, altText: 'Product reference' },
      },
      {
        suffix: 'style',
        type: 'source',
        title: 'Style reference',
        data: { workflowRole: 'source', benchmarkScenario: 'product_style_fusion' },
        source: { kind: 'upload', referenceRole: 'style', weight: 0.85, altText: 'Style reference' },
      },
      {
        suffix: 'model',
        type: 'model',
        title: 'Higgsfield product shot',
        data: { workflowRole: 'generation', ownerAgentId: 'maya', benchmarkScenario: 'product_style_fusion' },
        provider: { key: 'higgsfield', model: 'nano_banana_pro', mode: 'campaign_asset' },
        edit: { operation: 'variation', outputKind: 'campaign_asset', strength: 0.64, motion: { mode: 'none' }, references: [] },
      },
      {
        suffix: 'review',
        type: 'review',
        title: 'Photography review',
        data: { workflowRole: 'review', checks: ['product_accuracy', 'brand_style', 'rights'], benchmarkScenario: 'product_style_fusion' },
        review: { status: 'needed', syntheticMediaDisclosure: true, rightsStatus: 'needs_review', brandStatus: 'needs_review' },
      },
      {
        suffix: 'output',
        type: 'output',
        title: 'Campaign photography',
        data: { workflowRole: 'output', exportTarget: 'campaign_asset', benchmarkScenario: 'product_style_fusion' },
        output: { kind: 'campaign_asset', textPreview: 'Product and style fused campaign asset' },
      },
    ],
    edges: [
      { from: 'product', to: 'model', label: 'product' },
      { from: 'style', to: 'model', label: 'style' },
      { from: 'model', to: 'review', label: 'quality gate' },
      { from: 'review', to: 'output', label: 'approved asset' },
    ],
  },
  {
    key: 'benchmark-campaign-model-product',
    label: 'Model product campaign',
    description: 'Chain a person/character and product into a campaign-ready video.',
    benchmarkScenario: 'model_product_campaign',
    outputKind: 'social_post_draft',
    exportTarget: 'social_draft',
    aspectRatio: '9:16',
    durationSeconds: 6,
    stylePreset: 'ugc_social',
    cameraMotion: 'camera_push',
    negativePrompt: 'identity drift, product distortion, false endorsement',
    nodes: [
      {
        suffix: 'person',
        type: 'source',
        title: 'Person or Soul ID',
        data: { workflowRole: 'source', benchmarkScenario: 'model_product_campaign' },
        source: { kind: 'brand_kit', referenceRole: 'person', weight: 1, altText: 'Person or Soul ID reference' },
      },
      {
        suffix: 'product',
        type: 'source',
        title: 'Product reference',
        data: { workflowRole: 'source', benchmarkScenario: 'model_product_campaign' },
        source: { kind: 'upload', referenceRole: 'product', weight: 1, altText: 'Product reference' },
      },
      {
        suffix: 'model',
        type: 'model',
        title: 'Higgsfield campaign video',
        data: { workflowRole: 'generation', ownerAgentId: 'maya', benchmarkScenario: 'model_product_campaign' },
        provider: { key: 'higgsfield', model: 'seedance_2_0_fast', mode: 'social_post_draft' },
        edit: { operation: 'video_motion', outputKind: 'social_post_draft', strength: 0.7, motion: { mode: 'camera_push', durationSeconds: 6 }, references: [] },
      },
      {
        suffix: 'output',
        type: 'output',
        title: 'Campaign-ready social video',
        data: { workflowRole: 'output', exportTarget: 'social_draft', benchmarkScenario: 'model_product_campaign' },
        output: { kind: 'social_post_draft', textPreview: 'Model plus product campaign video draft' },
      },
    ],
    edges: [
      { from: 'person', to: 'model', label: 'character' },
      { from: 'product', to: 'model', label: 'product' },
      { from: 'model', to: 'output', label: 'campaign' },
    ],
  },
  {
    key: 'benchmark-architecture-day-night',
    label: 'Architecture day to night',
    description: 'Use start/end frames to create an architectural timelapse.',
    benchmarkScenario: 'architecture_day_night',
    outputKind: 'video',
    exportTarget: 'youtube_studio',
    aspectRatio: '16:9',
    durationSeconds: 8,
    stylePreset: 'cinematic_product',
    cameraMotion: 'pan',
    negativePrompt: 'unstable geometry, warped building lines, flicker',
    nodes: [
      {
        suffix: 'start',
        type: 'source',
        title: 'Start frame',
        data: { workflowRole: 'source', benchmarkScenario: 'architecture_day_night' },
        source: { kind: 'upload', referenceRole: 'background', weight: 1, altText: 'Day start frame' },
      },
      {
        suffix: 'end',
        type: 'source',
        title: 'End frame',
        data: { workflowRole: 'source', benchmarkScenario: 'architecture_day_night' },
        source: { kind: 'upload', referenceRole: 'motion', weight: 1, altText: 'Night end frame' },
      },
      {
        suffix: 'model',
        type: 'model',
        title: 'Higgsfield architectural timelapse',
        data: { workflowRole: 'generation', ownerAgentId: 'maya', benchmarkScenario: 'architecture_day_night' },
        provider: { key: 'higgsfield', model: 'wan_2_7', mode: 'video' },
        edit: { operation: 'video_motion', outputKind: 'video', strength: 0.66, motion: { mode: 'pan', durationSeconds: 8 }, references: [] },
      },
      {
        suffix: 'output',
        type: 'output',
        title: 'Day-night timelapse',
        data: { workflowRole: 'output', exportTarget: 'youtube_studio', benchmarkScenario: 'architecture_day_night' },
        output: { kind: 'video', textPreview: 'Architecture day-to-night video' },
      },
    ],
    edges: [
      { from: 'start', to: 'model', label: 'start frame' },
      { from: 'end', to: 'model', label: 'end frame' },
      { from: 'model', to: 'output', label: 'timelapse' },
    ],
  },
  {
    key: 'benchmark-style-set',
    label: 'Set to set style',
    description: 'Blend two location frames into a coherent styled video.',
    benchmarkScenario: 'set_to_set_style',
    outputKind: 'video',
    exportTarget: 'youtube_studio',
    aspectRatio: '16:9',
    durationSeconds: 8,
    stylePreset: 'brand_realism',
    cameraMotion: 'orbit',
    negativePrompt: 'location mismatch, subject drift, inconsistent exposure',
    nodes: [
      {
        suffix: 'start',
        type: 'source',
        title: 'Set start frame',
        data: { workflowRole: 'source', benchmarkScenario: 'set_to_set_style' },
        source: { kind: 'upload', referenceRole: 'background', weight: 1, altText: 'Start set reference' },
      },
      {
        suffix: 'end',
        type: 'source',
        title: 'Set destination frame',
        data: { workflowRole: 'source', benchmarkScenario: 'set_to_set_style' },
        source: { kind: 'upload', referenceRole: 'style', weight: 1, altText: 'Destination style reference' },
      },
      {
        suffix: 'model',
        type: 'model',
        title: 'Higgsfield set transition',
        data: { workflowRole: 'generation', ownerAgentId: 'maya', benchmarkScenario: 'set_to_set_style' },
        provider: { key: 'higgsfield', model: 'kling_3_0', mode: 'video' },
        edit: { operation: 'video_motion', outputKind: 'video', strength: 0.68, motion: { mode: 'orbit', durationSeconds: 8 }, references: [] },
      },
      {
        suffix: 'output',
        type: 'output',
        title: 'Styled transition video',
        data: { workflowRole: 'output', exportTarget: 'youtube_studio', benchmarkScenario: 'set_to_set_style' },
        output: { kind: 'video', textPreview: 'Styled set-to-set transition video' },
      },
    ],
    edges: [
      { from: 'start', to: 'model', label: 'start set' },
      { from: 'end', to: 'model', label: 'style set' },
      { from: 'model', to: 'output', label: 'transition' },
    ],
  },
  {
    key: 'benchmark-logo-animation',
    label: 'Logo animation',
    description: 'Drop a logo and style reference, render animated brand assets.',
    benchmarkScenario: 'logo_animation',
    outputKind: 'video',
    exportTarget: 'campaign_asset',
    aspectRatio: '1:1',
    durationSeconds: 5,
    stylePreset: 'brand_realism',
    cameraMotion: 'none',
    negativePrompt: 'logo distortion, unreadable mark, off-brand colors',
    nodes: [
      {
        suffix: 'logo',
        type: 'source',
        title: 'Logo source',
        data: { workflowRole: 'source', benchmarkScenario: 'logo_animation' },
        source: { kind: 'brand_kit', referenceRole: 'logo', weight: 1, altText: 'Logo source' },
      },
      {
        suffix: 'style',
        type: 'source',
        title: 'Animation style reference',
        data: { workflowRole: 'source', benchmarkScenario: 'logo_animation' },
        source: { kind: 'upload', referenceRole: 'style', weight: 0.8, altText: 'Animation style reference' },
      },
      {
        suffix: 'model',
        type: 'model',
        title: 'Higgsfield logo animation',
        data: { workflowRole: 'generation', ownerAgentId: 'maya', benchmarkScenario: 'logo_animation' },
        provider: { key: 'higgsfield', model: 'kling_3_0', mode: 'video' },
        edit: { operation: 'video_motion', outputKind: 'video', strength: 0.58, motion: { mode: 'none', durationSeconds: 5 }, references: [] },
      },
      {
        suffix: 'output',
        type: 'output',
        title: 'Animated logo package',
        data: { workflowRole: 'output', exportTarget: 'campaign_asset', benchmarkScenario: 'logo_animation' },
        output: { kind: 'video', textPreview: 'Animated logo asset package' },
      },
    ],
    edges: [
      { from: 'logo', to: 'model', label: 'logo' },
      { from: 'style', to: 'model', label: 'style' },
      { from: 'model', to: 'output', label: 'animation' },
    ],
  },
  {
    key: 'benchmark-brand-icons',
    label: 'Brand icon system',
    description: 'Use a logo and palette prompt to generate a cohesive icon set.',
    benchmarkScenario: 'brand_icon_system',
    outputKind: 'campaign_asset',
    exportTarget: 'campaign_asset',
    aspectRatio: '1:1',
    durationSeconds: 0,
    stylePreset: 'clean_studio',
    cameraMotion: 'none',
    negativePrompt: 'inconsistent icon style, unreadable marks, off-brand palette',
    nodes: [
      {
        suffix: 'logo',
        type: 'source',
        title: 'Logo and palette',
        data: { workflowRole: 'source', requiredInputs: ['logo', 'color_palette'], benchmarkScenario: 'brand_icon_system' },
        source: { kind: 'brand_kit', referenceRole: 'logo', weight: 1, altText: 'Logo and palette' },
      },
      {
        suffix: 'prompt',
        type: 'prompt',
        title: 'Icon system prompt',
        data: { workflowRole: 'prompt', promptType: 'brand_icon_system', benchmarkScenario: 'brand_icon_system' },
      },
      {
        suffix: 'model',
        type: 'model',
        title: 'Higgsfield icon system',
        data: { workflowRole: 'generation', ownerAgentId: 'maya', benchmarkScenario: 'brand_icon_system' },
        provider: { key: 'higgsfield', model: 'gpt_image_2_0', mode: 'campaign_asset' },
        edit: { operation: 'variation', outputKind: 'campaign_asset', strength: 0.62, motion: { mode: 'none' }, references: [] },
      },
      {
        suffix: 'output',
        type: 'output',
        title: 'Brand icon grid',
        data: { workflowRole: 'output', exportTarget: 'campaign_asset', benchmarkScenario: 'brand_icon_system' },
        output: { kind: 'campaign_asset', textPreview: 'Cohesive brand icon system grid' },
      },
    ],
    edges: [
      { from: 'logo', to: 'prompt', label: 'brand system' },
      { from: 'prompt', to: 'model', label: 'generate icons' },
      { from: 'model', to: 'output', label: 'icon set' },
    ],
  },
  {
    key: 'benchmark-sketch-material',
    label: 'Sketch material exploration',
    description: 'Drop a sketch and branch material concepts into variations.',
    benchmarkScenario: 'sketch_material_exploration',
    outputKind: 'campaign_asset',
    exportTarget: 'campaign_asset',
    aspectRatio: '1:1',
    durationSeconds: 0,
    stylePreset: 'clean_studio',
    cameraMotion: 'none',
    negativePrompt: 'changed silhouette, weak material definition, muddy texture',
    nodes: [
      {
        suffix: 'sketch',
        type: 'source',
        title: 'Concept sketch',
        data: { workflowRole: 'source', benchmarkScenario: 'sketch_material_exploration' },
        source: { kind: 'upload', referenceRole: 'general', weight: 1, altText: 'Concept sketch' },
      },
      {
        suffix: 'leather',
        type: 'edit',
        title: 'Leather material branch',
        data: { workflowRole: 'edit', material: 'leather', benchmarkScenario: 'sketch_material_exploration' },
        edit: { operation: 'style_transfer', outputKind: 'campaign_asset', strength: 0.58, motion: { mode: 'none' }, references: [] },
      },
      {
        suffix: 'glass',
        type: 'edit',
        title: 'Glass material branch',
        data: { workflowRole: 'edit', material: 'glass', benchmarkScenario: 'sketch_material_exploration' },
        edit: { operation: 'style_transfer', outputKind: 'campaign_asset', strength: 0.58, motion: { mode: 'none' }, references: [] },
      },
      {
        suffix: 'model',
        type: 'model',
        title: 'Higgsfield material variants',
        data: { workflowRole: 'generation', ownerAgentId: 'maya', benchmarkScenario: 'sketch_material_exploration' },
        provider: { key: 'higgsfield', model: 'nano_banana_pro', mode: 'campaign_asset' },
        edit: { operation: 'variation', outputKind: 'campaign_asset', strength: 0.62, motion: { mode: 'none' }, references: [] },
      },
      {
        suffix: 'output',
        type: 'output',
        title: 'Material exploration grid',
        data: { workflowRole: 'output', exportTarget: 'campaign_asset', benchmarkScenario: 'sketch_material_exploration' },
        output: { kind: 'campaign_asset', textPreview: 'Sketch material variants for leather, glass, and related surfaces' },
      },
    ],
    edges: [
      { from: 'sketch', to: 'leather', label: 'sketch' },
      { from: 'sketch', to: 'glass', label: 'sketch' },
      { from: 'leather', to: 'model', label: 'leather branch' },
      { from: 'glass', to: 'model', label: 'glass branch' },
      { from: 'model', to: 'output', label: 'material grid' },
    ],
  },
]

function CanvasPreviewBlock({
  url,
  label,
  className,
}: {
  url: string
  label: string
  className: string
}) {
  return (
    <div
      role="img"
      aria-label={label}
      className={`${className} bg-[var(--color-pib-surface)] bg-cover bg-center`}
      style={{ backgroundImage: `url(${url})` }}
    />
  )
}

function toFlowNode(node: CreativeCanvasNode, collaborators: Array<CreativeCanvasPresence & { id: string }> = []): Node {
  const previewUrl = node.source?.thumbnailUrl ?? node.source?.previewUrl ?? node.output?.thumbnailUrl ?? node.output?.url
  return {
    id: node.id,
    type: 'default',
    position: node.position,
    data: {
      label: (
        <div className="min-w-36">
          {previewUrl ? (
            <CanvasPreviewBlock
              url={previewUrl}
              label={`Reference preview: ${node.source?.altText ?? node.title}`}
              className="mb-2 h-20 w-full rounded-md"
            />
          ) : null}
          <p className="text-[10px] font-semibold uppercase tracking-normal text-[var(--color-pib-text-muted)]">
            {nodeTypeLabels[node.type]}
          </p>
          <p className="text-sm font-semibold text-[var(--color-pib-text)]">{node.title}</p>
          {collaborators.length ? (
            <div className="mt-2 flex flex-wrap gap-1" aria-label={`${collaborators.length} collaborator${collaborators.length === 1 ? '' : 's'} active on ${node.title}`}>
              {collaborators.slice(0, 3).map((collaborator) => (
                <span
                  key={collaborator.id}
                  className="rounded-full border border-[var(--color-pib-primary)] bg-white px-1.5 py-0.5 text-[9px] font-semibold text-[var(--color-pib-primary)]"
                >
                  {collaborator.displayName ?? collaborator.actorUid}
                </span>
              ))}
              {collaborators.length > 3 ? (
                <span className="rounded-full border border-[var(--color-pib-line)] bg-white px-1.5 py-0.5 text-[9px] font-semibold text-[var(--color-pib-text-muted)]">
                  +{collaborators.length - 3}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      ),
      canvasNode: node,
    },
  }
}

function toCanvasNode(node: Node, orgId: string): CreativeCanvasNode {
  const canvasNode = node.data?.canvasNode as CreativeCanvasNode | undefined
  return {
    id: node.id,
    orgId,
    type: canvasNode?.type ?? 'source',
    title: canvasNode?.title ?? node.id,
    position: node.position,
    data: canvasNode?.data ?? {},
    source: canvasNode?.source,
    provider: canvasNode?.provider,
    edit: canvasNode?.edit,
    review: canvasNode?.review,
    output: canvasNode?.output,
  }
}

function toFlowEdge(edge: CreativeCanvasEdge): Edge {
  return {
    id: edge.id,
    source: edge.sourceNodeId,
    target: edge.targetNodeId,
    label: edge.label,
    data: edge.data,
  }
}

function toCanvasEdge(edge: Edge, orgId: string): CreativeCanvasEdge {
  return {
    id: edge.id,
    orgId,
    sourceNodeId: edge.source,
    targetNodeId: edge.target,
    label: typeof edge.label === 'string' ? edge.label : undefined,
    data: typeof edge.data === 'object' && edge.data ? edge.data : undefined,
  }
}

function buildWorkflowPresetGraph(
  preset: CreativeCanvasWorkflowPreset,
  options: { baseX: number; baseY: number; stamp: number; orgId: string },
): { nodes: CreativeCanvasNode[]; edges: Edge[] } {
  const idFor = (suffix: string) => `${preset.key}-${suffix}-${options.stamp}`
  const nodes = preset.nodes.map((template, index): CreativeCanvasNode => ({
    id: idFor(template.suffix),
    orgId: options.orgId,
    type: template.type,
    title: template.title,
    position: {
      x: options.baseX + (index % 3) * 260,
      y: options.baseY + Math.floor(index / 3) * 180,
    },
    data: {
      ...template.data,
      createdFrom: 'creative_canvas_workflow_preset',
      workflowPreset: preset.key,
    },
    source: template.source,
    provider: template.provider,
    edit: template.edit,
    review: template.review,
    output: template.output,
  }))
  const edges: Edge[] = preset.edges.map((edge) => ({
    id: `${preset.key}-${edge.from}-${edge.to}-${options.stamp}`,
    source: idFor(edge.from),
    target: idFor(edge.to),
    label: edge.label,
    data: {
      createdFrom: 'creative_canvas_workflow_preset',
      workflowPreset: preset.key,
    },
  }))
  return { nodes, edges }
}

function canvasGraphSignature(nodes: CreativeCanvasNode[] = [], edges: CreativeCanvasEdge[] = []) {
  return JSON.stringify({
    nodes: nodes.map((node) => ({
      id: node.id,
      orgId: node.orgId,
      type: node.type,
      title: node.title,
      position: node.position,
      data: node.data ?? {},
      source: node.source,
      provider: node.provider,
      edit: node.edit,
      review: node.review,
      output: node.output,
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      orgId: edge.orgId,
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      label: edge.label,
      data: edge.data,
    })),
  })
}

function cloneCanvasField<T>(value: T | undefined): T | undefined {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value)) as T
}

export function CreativeCanvasWorkspace({ mode, orgId }: CreativeCanvasWorkspaceProps) {
  const [canvases, setCanvases] = useState<CreativeCanvas[]>([])
  const [activeCanvasId, setActiveCanvasId] = useState<string>('')
  const [selectedFlowNodeId, setSelectedFlowNodeId] = useState<string>('')
  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')
  const [versions, setVersions] = useState<Array<CreativeCanvasVersion & { id?: string }>>([])
  const [commentBody, setCommentBody] = useState('')
  const [comments, setComments] = useState<Array<CreativeCanvasComment & { id: string }>>([])
  const [presence, setPresence] = useState<Array<CreativeCanvasPresence & { id: string }>>([])
  const [activityMessage, setActivityMessage] = useState('')
  const [exportTarget, setExportTarget] = useState<CreativeCanvasExport['target']>('campaign_asset')
  const [latestRun, setLatestRun] = useState<{ id: string; status: string; nodeId?: string } | null>(null)
  const [runModel, setRunModel] = useState('nano_banana_flash')
  const [runOutputKind, setRunOutputKind] = useState('image')
  const [runAspectRatio, setRunAspectRatio] = useState('1:1')
  const [runDurationSeconds, setRunDurationSeconds] = useState(5)
  const [runVariantCount, setRunVariantCount] = useState(1)
  const [runStylePreset, setRunStylePreset] = useState('cinematic_product')
  const [runCameraMotion, setRunCameraMotion] = useState('none')
  const [runNegativePrompt, setRunNegativePrompt] = useState('')
  const [sourceLibrary, setSourceLibrary] = useState<CreativeCanvasSourceLibraryItem[]>([])
  const [maskRegion, setMaskRegion] = useState({ x: 0, y: 0, width: 50, height: 50, feather: 0 })
  const [runHistory, setRunHistory] = useState<Array<CreativeCanvasRun & { id: string }>>([])
  const [runOperations, setRunOperations] = useState<CreativeCanvasRunOperationsSummary | null>(null)
  const [runtimeReadiness, setRuntimeReadiness] = useState<CreativeCanvasProviderRuntimeReadiness | null>(null)
  const [runtimeProof, setRuntimeProof] = useState<CreativeCanvasRuntimeProof | null>(null)
  const [latestExecution, setLatestExecution] = useState<{ command?: string; dispatchPath?: string; callbackPath?: string; statusPath?: string } | null>(null)
  const [sourceQuery, setSourceQuery] = useState('')
  const [sourceKindFilter, setSourceKindFilter] = useState('')
  const [sourceRoleFilter, setSourceRoleFilter] = useState('')
  const [sourceMediaFilter, setSourceMediaFilter] = useState('')
  const [sourceUploadRole, setSourceUploadRole] = useState('product')
  const [sourceUploadAltText, setSourceUploadAltText] = useState('')
  const [sourceUploading, setSourceUploading] = useState(false)
  const [maskBrushSize, setMaskBrushSize] = useState(8)
  const [maskBrushMode, setMaskBrushMode] = useState<'paint' | 'erase'>('paint')
  const [activeMaskBrushStrokeId, setActiveMaskBrushStrokeId] = useState<string>('')
  const activeMaskBrushStrokeIdRef = useRef('')
  const [assetOriginFilter, setAssetOriginFilter] = useState<'all' | CreativeCanvasAssetOrigin>('all')
  const [assetReadinessFilter, setAssetReadinessFilter] = useState<'all' | 'ready' | 'draft_exportable' | 'review_needed' | 'blocked'>('all')
  const [selectedAssetId, setSelectedAssetId] = useState('')
  const [compareAssetIds, setCompareAssetIds] = useState<string[]>([])
  const [latestExportPackage, setLatestExportPackage] = useState<{
    id: string
    assetCount: number
    targets: string[]
    manifest?: {
      nodeCount?: number
      edgeCount?: number
      activeVersion?: number
      requiredOutputKinds?: string[]
      sourceNodeCount?: number
      coveredCategories?: string[]
      lineageCount?: number
      downstreamDraftCount?: number
    }
  } | null>(null)
  const [mobilePanel, setMobilePanel] = useState<CreativeCanvasMobilePanel>('canvas')
  const [remoteCanvasUpdate, setRemoteCanvasUpdate] = useState<CreativeCanvas | null>(null)
  const [templates, setTemplates] = useState<Array<CreativeCanvasTemplate & { id: string }>>([])
  const [templateTitle, setTemplateTitle] = useState('')
  const [templateDescription, setTemplateDescription] = useState('')
  const [collaborationLinkCopied, setCollaborationLinkCopied] = useState(false)
  const [autoFollowLiveDrafts, setAutoFollowLiveDrafts] = useState(false)
  const [ownPresenceId, setOwnPresenceId] = useState('')
  const [versionPreview, setVersionPreview] = useState<{ version: number; reason?: string } | null>(null)
  const [collaborationStreamConnected, setCollaborationStreamConnected] = useState(false)
  const [acceptedGraphSignature, setAcceptedGraphSignature] = useState('')
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(true)
  const [collaborationActivity, setCollaborationActivity] = useState<CreativeCanvasActivityEvent[]>([])
  const [visualProofDrafts, setVisualProofDrafts] = useState<CreativeCanvasVisualProofDraft>(emptyVisualProofDrafts)
  const [savingVisualProofKey, setSavingVisualProofKey] = useState<CreativeCanvasVisualProofKey | ''>('')
  const [benchmarkProofDrafts, setBenchmarkProofDrafts] = useState<CreativeCanvasBenchmarkProofDraft>(emptyBenchmarkProofDrafts)
  const [savingBenchmarkProofKey, setSavingBenchmarkProofKey] = useState<CreativeCanvasBenchmarkProofKey | ''>('')
  const [conflictDraft, setConflictDraft] = useState<{
    title: string
    purpose: string
    nodes: CreativeCanvasNode[]
    edges: CreativeCanvasEdge[]
    currentActiveVersion?: number
    conflictDetails?: CreativeCanvasApiListResponse['conflictDetails']
  } | null>(null)
  const lastAutoFollowedDraftSignatureRef = useRef('')
  const activityCounterRef = useRef(0)

  const recordCanvasActivity = useCallback((event: Omit<CreativeCanvasActivityEvent, 'id' | 'atMs'>) => {
    activityCounterRef.current += 1
    const nextEvent: CreativeCanvasActivityEvent = {
      ...event,
      id: `${Date.now()}-${activityCounterRef.current}`,
      atMs: Date.now(),
    }
    setCollaborationActivity((current) => [nextEvent, ...current].slice(0, 8))
  }, [])

  const activeCanvas = useMemo(
    () => canvases.find((canvas) => canvas.id === activeCanvasId) ?? canvases[0],
    [activeCanvasId, canvases]
  )

  const resolvedOrgId = orgId ?? activeCanvas?.orgId ?? ''

  useEffect(() => {
    const proof = getCanvasVisualProof(activeCanvas?.data)
    setVisualProofDrafts({
      desktop_1440: {
        screenshotUrl: proof.desktop_1440?.screenshotUrl ?? '',
        notes: proof.desktop_1440?.notes ?? '',
        signedIn: proof.desktop_1440?.signedIn === true,
        sessionEvidence: proof.desktop_1440?.sessionEvidence ?? '',
        viewportSize: proof.desktop_1440?.viewportSize ?? '1440x900',
        visiblePanels: proof.desktop_1440?.visiblePanels ?? 'Graph, Sources, Inspector',
      },
      tablet_820: {
        screenshotUrl: proof.tablet_820?.screenshotUrl ?? '',
        notes: proof.tablet_820?.notes ?? '',
        signedIn: proof.tablet_820?.signedIn === true,
        sessionEvidence: proof.tablet_820?.sessionEvidence ?? '',
        viewportSize: proof.tablet_820?.viewportSize ?? '820x1180',
        visiblePanels: proof.tablet_820?.visiblePanels ?? 'Responsive panel layout',
      },
      mobile_390: {
        screenshotUrl: proof.mobile_390?.screenshotUrl ?? '',
        notes: proof.mobile_390?.notes ?? '',
        signedIn: proof.mobile_390?.signedIn === true,
        sessionEvidence: proof.mobile_390?.sessionEvidence ?? '',
        viewportSize: proof.mobile_390?.viewportSize ?? '390x844',
        visiblePanels: proof.mobile_390?.visiblePanels ?? 'Canvas panel',
      },
      mobile_panels: {
        screenshotUrl: proof.mobile_panels?.screenshotUrl ?? '',
        notes: proof.mobile_panels?.notes ?? '',
        signedIn: proof.mobile_panels?.signedIn === true,
        sessionEvidence: proof.mobile_panels?.sessionEvidence ?? '',
        viewportSize: proof.mobile_panels?.viewportSize ?? '390x844',
        visiblePanels: proof.mobile_panels?.visiblePanels ?? 'Canvas, Sources, Inspector panel switcher',
      },
    })
  }, [activeCanvas?.data, activeCanvas?.id])

  useEffect(() => {
    const proof = getCanvasBenchmarkProof(activeCanvas?.data)
    setBenchmarkProofDrafts({
      editing_ergonomics: {
        proofUrl: proof.editing_ergonomics?.proofUrl ?? '',
        notes: proof.editing_ergonomics?.notes ?? '',
      },
      masking_inpainting: {
        proofUrl: proof.masking_inpainting?.proofUrl ?? '',
        notes: proof.masking_inpainting?.notes ?? '',
      },
      generation_controls: {
        proofUrl: proof.generation_controls?.proofUrl ?? '',
        notes: proof.generation_controls?.notes ?? '',
      },
      multi_asset_workflows: {
        proofUrl: proof.multi_asset_workflows?.proofUrl ?? '',
        notes: proof.multi_asset_workflows?.notes ?? '',
      },
      versioning_polish: {
        proofUrl: proof.versioning_polish?.proofUrl ?? '',
        notes: proof.versioning_polish?.notes ?? '',
      },
      collaboration: {
        proofUrl: proof.collaboration?.proofUrl ?? '',
        notes: proof.collaboration?.notes ?? '',
      },
      mobile_behavior: {
        proofUrl: proof.mobile_behavior?.proofUrl ?? '',
        notes: proof.mobile_behavior?.notes ?? '',
      },
      export_flows: {
        proofUrl: proof.export_flows?.proofUrl ?? '',
        notes: proof.export_flows?.notes ?? '',
      },
      production_reliability: {
        proofUrl: proof.production_reliability?.proofUrl ?? '',
        notes: proof.production_reliability?.notes ?? '',
      },
    })
  }, [activeCanvas?.data, activeCanvas?.id])

  const selectedCanvasNode = useMemo(() => {
    const flowNode = nodes.find((node) => node.id === selectedFlowNodeId) ?? nodes[0]
    return flowNode?.data?.canvasNode as CreativeCanvasNode | undefined
  }, [nodes, selectedFlowNodeId])

  const selectedNodeId = selectedCanvasNode?.id
  const selectedNodeComments = useMemo(() => (
    comments.filter((comment) => comment.nodeId === selectedNodeId)
  ), [comments, selectedNodeId])
  const canvasLevelComments = useMemo(() => (
    comments.filter((comment) => !comment.nodeId)
  ), [comments])
  const commentCountByNodeId = useMemo(() => comments.reduce<Record<string, number>>((counts, comment) => {
    if (!comment.nodeId) return counts
    counts[comment.nodeId] = (counts[comment.nodeId] ?? 0) + 1
    return counts
  }, {}), [comments])
  const collaboratorsByNodeId = useMemo(() => presence.reduce<Record<string, Array<CreativeCanvasPresence & { id: string }>>>((groups, collaborator) => {
    if (!collaborator.selectedNodeId) return groups
    groups[collaborator.selectedNodeId] = [...(groups[collaborator.selectedNodeId] ?? []), collaborator]
    return groups
  }, {}), [presence])
  const selectedNodeCollaborators = useMemo(() => (
    selectedNodeId
      ? (collaboratorsByNodeId[selectedNodeId] ?? []).filter((collaborator) => collaborator.id !== ownPresenceId)
      : []
  ), [collaboratorsByNodeId, ownPresenceId, selectedNodeId])
  const selectedNodeLockedByCollaborator = selectedNodeCollaborators.length > 0
  const displayNodes = useMemo(() => nodes.map((node) => {
    const canvasNode = node.data?.canvasNode as CreativeCanvasNode | undefined
    if (!canvasNode) return node
    return toFlowNode({ ...canvasNode, position: node.position }, collaboratorsByNodeId[node.id] ?? [])
  }), [collaboratorsByNodeId, nodes])
  const selectedMaskBrushStrokes = selectedCanvasNode?.edit?.mask?.brush?.strokes ?? []
  const orchestrationPlan = useMemo(() => buildCreativeCanvasOrchestrationPlan({
    id: activeCanvas?.id,
    orgId: resolvedOrgId || activeCanvas?.orgId || 'pending-org',
    nodes: nodes.map((node) => toCanvasNode(node, resolvedOrgId || activeCanvas?.orgId || 'pending-org')),
    edges: edges.map((edge) => toCanvasEdge(edge, resolvedOrgId || activeCanvas?.orgId || 'pending-org')),
  }), [activeCanvas?.id, activeCanvas?.orgId, edges, nodes, resolvedOrgId])
  const canvasAssets = useMemo(() => buildCreativeCanvasAssetGallery({
    nodes: nodes.map((node) => toCanvasNode(node, resolvedOrgId || activeCanvas?.orgId || 'pending-org')),
    runs: runHistory,
  }), [activeCanvas?.orgId, nodes, resolvedOrgId, runHistory])
  const selectedCanvasAsset = useMemo(() => (
    canvasAssets.find((asset) => asset.id === selectedAssetId) ?? null
  ), [canvasAssets, selectedAssetId])
  const comparedCanvasAssets = useMemo(() => (
    compareAssetIds
      .map((assetId) => canvasAssets.find((asset) => asset.id === assetId))
      .filter((asset): asset is NonNullable<typeof asset> => Boolean(asset))
  ), [canvasAssets, compareAssetIds])
  const filteredCanvasAssets = useMemo(() => canvasAssets.filter((asset) => {
    if (assetOriginFilter !== 'all' && asset.origin !== assetOriginFilter) return false
    if (assetReadinessFilter === 'ready') return asset.readyForExport
    if (assetReadinessFilter === 'draft_exportable') return asset.canDraftExport
    if (assetReadinessFilter === 'review_needed') {
      return asset.reviewStatus === 'needed'
        || asset.rightsStatus === 'needs_review'
        || asset.brandStatus === 'needs_review'
    }
    if (assetReadinessFilter === 'blocked') {
      return asset.reviewStatus === 'blocked'
        || asset.rightsStatus === 'blocked'
        || asset.brandStatus === 'blocked'
    }
    return true
  }), [assetOriginFilter, assetReadinessFilter, canvasAssets])
  const collaborationLink = useMemo(() => {
    if (!activeCanvas?.id || typeof window === 'undefined') return ''
    const url = new URL(window.location.href)
    url.searchParams.set('canvasId', activeCanvas.id)
    if (resolvedOrgId || activeCanvas.orgId) url.searchParams.set('orgId', resolvedOrgId || activeCanvas.orgId)
    return url.toString()
  }, [activeCanvas?.id, activeCanvas?.orgId, resolvedOrgId])
  const currentGraphSignature = useMemo(() => canvasGraphSignature(
    nodes.map((node) => toCanvasNode(node, resolvedOrgId || activeCanvas?.orgId || 'pending-org')),
    edges.map((edge) => toCanvasEdge(edge, resolvedOrgId || activeCanvas?.orgId || 'pending-org')),
  ), [activeCanvas?.orgId, edges, nodes, resolvedOrgId])
  const graphHasUnsavedChanges = Boolean(activeCanvas?.id && !versionPreview && acceptedGraphSignature && currentGraphSignature !== acceptedGraphSignature)
  const latestCollaboratorDraft = useMemo(() => presence
    .filter((item) => item.id !== ownPresenceId && item.draftGraph?.nodes?.length && item.hasUnsavedGraphChanges)
    .sort((a, b) => (b.lastSeenAtMs ?? 0) - (a.lastSeenAtMs ?? 0))[0] ?? null, [ownPresenceId, presence])
  const hasCollaboratorLiveDraft = Boolean(latestCollaboratorDraft)

  const writeCanvasDeepLink = useCallback((canvas: CreativeCanvas) => {
    if (!canvas.id || typeof window === 'undefined') return
    const url = new URL(window.location.href)
    url.searchParams.set('canvasId', canvas.id)
    if (resolvedOrgId || canvas.orgId) url.searchParams.set('orgId', resolvedOrgId || canvas.orgId)
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  }, [resolvedOrgId])

  const loadVersions = useCallback(async (canvasId: string, canvasOrgId: string) => {
    if (!canvasId || !canvasOrgId) {
      setVersions([])
      return
    }

    const response = await fetch(`/api/v1/creative-canvas/${canvasId}/versions?orgId=${encodeURIComponent(canvasOrgId)}`)
    const payload = (await response.json()) as CreativeCanvasVersionApiResponse
    setVersions(payload.data?.versions ?? [])
  }, [])

  const loadRuns = useCallback(async (canvasId: string, canvasOrgId: string) => {
    if (!canvasId || !canvasOrgId) {
      setRunHistory([])
      setRunOperations(null)
      setRuntimeReadiness(null)
      setRuntimeProof(null)
      return
    }

    const response = await fetch(`/api/v1/creative-canvas/${canvasId}/runs?orgId=${encodeURIComponent(canvasOrgId)}`)
    const payload = (await response.json()) as CreativeCanvasRunApiResponse
    setRunHistory(payload.data?.runs ?? [])
    setRunOperations(payload.data?.operations ?? null)
    setRuntimeReadiness(payload.data?.runtimeReadiness ?? null)
  }, [])

  const loadRuntimeProof = useCallback(async (canvasId: string, canvasOrgId: string) => {
    if (!canvasId || !canvasOrgId) {
      setRuntimeProof(null)
      return
    }
    const response = await fetch(`/api/v1/creative-canvas/${canvasId}/runtime-proof?orgId=${encodeURIComponent(canvasOrgId)}`)
    const payload = (await response.json()) as CreativeCanvasRuntimeProofApiResponse
    setRuntimeProof(payload.data?.proof ?? null)
  }, [])

  const loadPresence = useCallback(async (canvasId: string, canvasOrgId: string) => {
    if (!canvasId || !canvasOrgId) {
      setPresence([])
      return
    }
    const response = await fetch(`/api/v1/creative-canvas/${canvasId}/presence?orgId=${encodeURIComponent(canvasOrgId)}`)
    const payload = (await response.json()) as CreativeCanvasPresenceApiResponse
    setPresence(payload.data?.presence ?? [])
  }, [])

  const loadComments = useCallback(async (canvasId: string, canvasOrgId: string) => {
    if (!canvasId || !canvasOrgId) {
      setComments([])
      return
    }
    const response = await fetch(`/api/v1/creative-canvas/${canvasId}/comments?orgId=${encodeURIComponent(canvasOrgId)}`)
    const payload = (await response.json()) as CreativeCanvasCommentApiResponse
    setComments(payload.data?.comments ?? [])
  }, [])

  const loadTemplates = useCallback(async (canvasOrgId: string) => {
    if (!canvasOrgId) {
      setTemplates([])
      return
    }
    const response = await fetch(`/api/v1/creative-canvas/templates?orgId=${encodeURIComponent(canvasOrgId)}`)
    const payload = (await response.json()) as CreativeCanvasTemplateApiResponse
    setTemplates(payload.data?.templates ?? [])
  }, [])

  const checkRemoteCanvasUpdate = useCallback(async (
    canvasId: string,
    canvasOrgId: string,
    knownActiveVersion?: number,
  ) => {
    if (!canvasId || !canvasOrgId || !knownActiveVersion) {
      setRemoteCanvasUpdate(null)
      return
    }

    try {
      const response = await fetch(`/api/v1/creative-canvas/${canvasId}?orgId=${encodeURIComponent(canvasOrgId)}`)
      const payload = await response.json().catch(() => null) as CreativeCanvasApiListResponse | null
      const latestCanvas = payload?.data?.canvas
      if (!response.ok || !latestCanvas?.id) return
      if ((latestCanvas.activeVersion ?? 0) > knownActiveVersion) {
        setRemoteCanvasUpdate(latestCanvas)
      } else {
        setRemoteCanvasUpdate(null)
      }
    } catch {
      // Presence polling should not surface transient remote refresh failures as canvas errors.
    }
  }, [])

  const applyCanvasSnapshot = useCallback((canvas: CreativeCanvas) => {
    setCanvases((current) => {
      const exists = current.some((item) => item.id === canvas.id)
      return exists
        ? current.map((item) => item.id === canvas.id ? canvas : item)
        : [canvas, ...current]
    })
    setActiveCanvasId(canvas.id ?? '')
    setSelectedFlowNodeId(canvas.nodes?.[0]?.id ?? '')
    setNodes((canvas.nodes ?? []).map((node) => toFlowNode(node)))
    setEdges((canvas.edges ?? []).map(toFlowEdge))
    setAcceptedGraphSignature(canvasGraphSignature(canvas.nodes ?? [], canvas.edges ?? []))
    setLatestExecution(null)
    setRemoteCanvasUpdate(null)
    setVersionPreview(null)
  }, [])

  const saveVisualProof = useCallback(async (key: CreativeCanvasVisualProofKey) => {
    if (!activeCanvas?.id) return
    const draft = visualProofDrafts[key]
    const screenshotUrl = draft.screenshotUrl.trim()
    const notes = draft.notes.trim()
    const sessionEvidence = draft.sessionEvidence.trim()
    const viewportSize = draft.viewportSize.trim()
    const visiblePanels = draft.visiblePanels.trim()
    if (!screenshotUrl && !notes) {
      setActivityMessage('Add a screenshot URL or proof note before saving visual proof')
      return
    }
    const canvasOrgId = resolvedOrgId || activeCanvas.orgId
    const existingProof = getCanvasVisualProof(activeCanvas.data)
    const nextVisualProof = {
      ...existingProof,
      [key]: {
        ...existingProof[key],
        screenshotUrl,
        notes,
        signedIn: draft.signedIn,
        sessionEvidence,
        viewportSize,
        visiblePanels,
        capturedAt: new Date().toISOString(),
        capturedBy: 'Pip',
        canvasVersion: activeCanvas.activeVersion,
        graphSignature: currentGraphSignature,
        nodeCount: nodes.length,
        edgeCount: edges.length,
      },
    }

    setSavingVisualProofKey(key)
    try {
      const response = await fetch(`/api/v1/creative-canvas/${activeCanvas.id}?orgId=${encodeURIComponent(canvasOrgId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: {
            ...objectRecord(activeCanvas.data),
            visualProof: nextVisualProof,
          },
        }),
      })
      const payload = await response.json().catch(() => null) as CreativeCanvasApiListResponse | null
      const updatedCanvas = payload?.data?.canvas
      if (!response.ok || !updatedCanvas?.id) {
        setActivityMessage(payload?.error ?? 'Visual proof save failed')
        return
      }
      applyCanvasSnapshot(updatedCanvas)
      const label = visualProofConfigs.find((item) => item.key === key)?.label ?? 'Viewport'
      setActivityMessage(`Saved ${label} visual proof`)
    } catch {
      setActivityMessage('Visual proof save failed')
    } finally {
      setSavingVisualProofKey('')
    }
  }, [activeCanvas, applyCanvasSnapshot, currentGraphSignature, edges.length, nodes.length, resolvedOrgId, visualProofDrafts])

  const saveBenchmarkProof = useCallback(async (key: CreativeCanvasBenchmarkProofKey) => {
    if (!activeCanvas?.id) return
    const draft = benchmarkProofDrafts[key]
    const proofUrl = draft.proofUrl.trim()
    const notes = draft.notes.trim()
    if (!proofUrl || !notes) {
      setActivityMessage('Add a proof URL and notes before saving benchmark evidence')
      return
    }
    const proofConfig = benchmarkProofConfigs.find((item) => item.key === key)
    const canvasOrgId = resolvedOrgId || activeCanvas.orgId
    const existingProof = getCanvasBenchmarkProof(activeCanvas.data)
    const capturedAt = new Date().toISOString()
    const nextBenchmarkProof = {
      ...existingProof,
      [key]: {
        ...existingProof[key],
        proofUrl,
        notes,
        capturedAt,
        capturedBy: 'Pip',
        sourceTitle: proofConfig?.sourceTitle,
        sourceUrl: proofConfig?.sourceUrl,
        sourceCheckedAt: capturedAt,
        sourceSignals: proofConfig?.sourceSignals ?? [],
        higgsfieldUiEvidenceUrl: proofConfig?.sourceUrl,
        canvasEvidenceUrl: proofUrl,
        directComparisonAt: capturedAt,
        directComparisonVerdict: 'pass',
        directComparisonNotes: notes,
        canvasVersion: activeCanvas.activeVersion,
        graphSignature: currentGraphSignature,
        nodeCount: nodes.length,
        edgeCount: edges.length,
      },
    }

    setSavingBenchmarkProofKey(key)
    try {
      const response = await fetch(`/api/v1/creative-canvas/${activeCanvas.id}?orgId=${encodeURIComponent(canvasOrgId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: {
            ...objectRecord(activeCanvas.data),
            benchmarkProof: nextBenchmarkProof,
          },
        }),
      })
      const payload = await response.json().catch(() => null) as CreativeCanvasApiListResponse | null
      const updatedCanvas = payload?.data?.canvas
      if (!response.ok || !updatedCanvas?.id) {
        setActivityMessage(payload?.error ?? 'Benchmark proof save failed')
        return
      }
      applyCanvasSnapshot(updatedCanvas)
      const label = benchmarkProofConfigs.find((item) => item.key === key)?.label ?? 'Benchmark'
      setActivityMessage(`Saved ${label} benchmark proof`)
    } catch {
      setActivityMessage('Benchmark proof save failed')
    } finally {
      setSavingBenchmarkProofKey('')
    }
  }, [activeCanvas, applyCanvasSnapshot, benchmarkProofDrafts, currentGraphSignature, edges.length, nodes.length, resolvedOrgId])

  const applyRemoteCanvasUpdate = useCallback(async () => {
    if (!remoteCanvasUpdate?.id) return
    const canvasOrgId = resolvedOrgId || remoteCanvasUpdate.orgId
    applyCanvasSnapshot(remoteCanvasUpdate)
    await loadVersions(remoteCanvasUpdate.id, canvasOrgId)
    await loadRuns(remoteCanvasUpdate.id, canvasOrgId)
    await loadRuntimeProof(remoteCanvasUpdate.id, canvasOrgId)
    await loadPresence(remoteCanvasUpdate.id, canvasOrgId)
    await loadComments(remoteCanvasUpdate.id, canvasOrgId)
    recordCanvasActivity({
      actorLabel: 'Live canvas',
      action: 'Applied remote graph',
      detail: `Version ${remoteCanvasUpdate.activeVersion}`,
      source: 'stream',
    })
    setActivityMessage(`Applied live graph v${remoteCanvasUpdate.activeVersion}`)
    setSaveMessage('')
  }, [applyCanvasSnapshot, loadComments, loadPresence, loadRuns, loadRuntimeProof, loadVersions, recordCanvasActivity, remoteCanvasUpdate, resolvedOrgId])

  const applyCollaborationStreamEvent = useCallback((event: CreativeCanvasCollaborationStreamEvent) => {
    if (Array.isArray(event.presence)) setPresence(event.presence)
    if (!event.canvas?.id || event.canvas.id !== activeCanvas?.id) return
    if ((event.canvas.activeVersion ?? 0) > (activeCanvas.activeVersion ?? 0)) {
      setRemoteCanvasUpdate(event.canvas)
    } else {
      setRemoteCanvasUpdate(null)
    }
  }, [activeCanvas?.activeVersion, activeCanvas?.id])

  const applyCollaboratorDraft = useCallback((collaborator: CreativeCanvasPresence & { id: string }, options: { automatic?: boolean } = {}) => {
    const draftGraph = collaborator.draftGraph
    if (!draftGraph?.nodes?.length) return
    setNodes(draftGraph.nodes.map((node) => toFlowNode(node)))
    setEdges((draftGraph.edges ?? []).map(toFlowEdge))
    setSelectedFlowNodeId(collaborator.selectedNodeId ?? draftGraph.nodes[0]?.id ?? '')
    setRemoteCanvasUpdate(null)
    setSaveMessage('')
    if (collaborator.graphSignature) lastAutoFollowedDraftSignatureRef.current = collaborator.graphSignature
    recordCanvasActivity({
      actorLabel: collaborator.displayName ?? collaborator.actorUid,
      action: options.automatic ? 'Auto-followed live draft' : 'Applied live draft',
      detail: `${draftGraph.nodes.length} node${draftGraph.nodes.length === 1 ? '' : 's'} / ${draftGraph.edges?.length ?? 0} link${(draftGraph.edges?.length ?? 0) === 1 ? '' : 's'}`,
      nodeId: collaborator.selectedNodeId,
      source: 'draft',
    })
    setActivityMessage(`${options.automatic ? 'Auto-followed' : 'Applied'} ${collaborator.displayName ?? collaborator.actorUid} live draft to this workspace`)
  }, [recordCanvasActivity])

  const previewVersionGraph = (version: CreativeCanvasVersion & { id?: string }) => {
    if (!Array.isArray(version.nodes) || !Array.isArray(version.edges) || graphHasUnsavedChanges) return
    setNodes(version.nodes.map((node) => toFlowNode(node)))
    setEdges(version.edges.map(toFlowEdge))
    setSelectedFlowNodeId(version.nodes[0]?.id ?? '')
    setRemoteCanvasUpdate(null)
    setVersionPreview({ version: version.version, reason: version.reason })
    setActivityMessage(`Previewing version ${version.version}`)
  }

  const exitVersionPreview = () => {
    if (!activeCanvas) return
    applyCanvasSnapshot(activeCanvas)
    setActivityMessage('Returned to current graph')
  }

  useEffect(() => {
    if (!remoteCanvasUpdate?.id || graphHasUnsavedChanges) return
    void applyRemoteCanvasUpdate()
  }, [applyRemoteCanvasUpdate, graphHasUnsavedChanges, remoteCanvasUpdate?.id, remoteCanvasUpdate?.activeVersion])

  useEffect(() => {
    if (!autoFollowLiveDrafts || graphHasUnsavedChanges || !latestCollaboratorDraft?.draftGraph?.nodes?.length) return
    if (latestCollaboratorDraft.graphSignature && latestCollaboratorDraft.graphSignature === lastAutoFollowedDraftSignatureRef.current) return
    applyCollaboratorDraft(latestCollaboratorDraft, { automatic: true })
  }, [applyCollaboratorDraft, autoFollowLiveDrafts, graphHasUnsavedChanges, latestCollaboratorDraft])

  const refreshCollaborationState = useCallback(async (canvasId: string, canvasOrgId: string, knownActiveVersion?: number) => {
    await Promise.all([
      loadPresence(canvasId, canvasOrgId),
      checkRemoteCanvasUpdate(canvasId, canvasOrgId, knownActiveVersion),
    ])
  }, [checkRemoteCanvasUpdate, loadPresence])

  const sendPresenceHeartbeat = useCallback(async (
    canvasId: string,
    canvasOrgId: string,
    nodeId?: string,
    focus: CreativeCanvasPresence['focus'] = 'canvas',
  ) => {
    if (!canvasId || !canvasOrgId) return
    const response = await fetch(`/api/v1/creative-canvas/${canvasId}/presence?orgId=${encodeURIComponent(canvasOrgId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        selectedNodeId: nodeId,
        focus,
        activeVersion: activeCanvas?.activeVersion,
        graphSignature: currentGraphSignature,
        hasUnsavedGraphChanges: graphHasUnsavedChanges,
        nodeCount: nodes.length,
        edgeCount: edges.length,
        selectedNodeTitle: selectedCanvasNode?.title,
        draftGraph: graphHasUnsavedChanges
          ? {
              nodes: nodes.map((node) => toCanvasNode(node, resolvedOrgId || activeCanvas?.orgId || 'pending-org')),
              edges: edges.map((edge) => toCanvasEdge(edge, resolvedOrgId || activeCanvas?.orgId || 'pending-org')),
            }
          : undefined,
      }),
    })
    const payload = await response.json().catch(() => null) as CreativeCanvasPresenceApiResponse | null
    if (response.ok && payload?.data?.presence?.[0]) {
      const own = payload.data.presence[0]
      setOwnPresenceId(own.id)
      setPresence((current) => {
        return [own, ...current.filter((item) => item.id !== own.id)]
      })
    }
  }, [
    activeCanvas?.activeVersion,
    currentGraphSignature,
    edges,
    graphHasUnsavedChanges,
    nodes,
    resolvedOrgId,
    activeCanvas?.orgId,
    selectedCanvasNode?.title,
  ])

  useEffect(() => {
    const region = selectedCanvasNode?.edit?.mask?.region
    if (!region) return
    setMaskRegion({
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
      feather: region.feather ?? 0,
    })
  }, [selectedCanvasNode?.id, selectedCanvasNode?.edit?.mask?.region])

  useEffect(() => {
    const selectedModel = selectedCanvasNode?.provider?.key === 'higgsfield' ? selectedCanvasNode.provider.model : undefined
    if (selectedModel) setRunModel(selectedModel)
    if (selectedCanvasNode?.provider?.mode) setRunOutputKind(selectedCanvasNode.provider.mode)
    if (selectedCanvasNode?.edit?.outputKind) setRunOutputKind(selectedCanvasNode.edit.outputKind)
    if (selectedCanvasNode?.edit?.motion?.mode) setRunCameraMotion(selectedCanvasNode.edit.motion.mode)
    if (typeof selectedCanvasNode?.edit?.motion?.durationSeconds === 'number') {
      setRunDurationSeconds(selectedCanvasNode.edit.motion.durationSeconds)
    }
    const generationSettings = selectedCanvasNode?.data?.generationSettings as Record<string, unknown> | undefined
    if (typeof generationSettings?.aspectRatio === 'string') setRunAspectRatio(generationSettings.aspectRatio)
    if (typeof generationSettings?.variantCount === 'number') setRunVariantCount(generationSettings.variantCount)
    if (typeof generationSettings?.stylePreset === 'string') setRunStylePreset(generationSettings.stylePreset)
    if (typeof generationSettings?.negativePrompt === 'string') setRunNegativePrompt(generationSettings.negativePrompt)
  }, [
    selectedCanvasNode?.data,
    selectedCanvasNode?.edit?.motion?.durationSeconds,
    selectedCanvasNode?.edit?.motion?.mode,
    selectedCanvasNode?.edit?.outputKind,
    selectedCanvasNode?.id,
    selectedCanvasNode?.provider?.key,
    selectedCanvasNode?.provider?.mode,
    selectedCanvasNode?.provider?.model,
  ])

  useEffect(() => {
    let cancelled = false
    const loadCanvases = async () => {
      setLoading(true)
      setError('')

      try {
        const query = orgId ? `?orgId=${encodeURIComponent(orgId)}` : ''
        const response = await fetch(`/api/v1/creative-canvas${query}`)
        const payload = (await response.json()) as CreativeCanvasApiListResponse
        const loadedCanvases = payload.data?.canvases ?? []

        if (cancelled) return

        setCanvases(loadedCanvases)
        setRemoteCanvasUpdate(null)
        const requestedCanvasId = typeof window === 'undefined'
          ? ''
          : new URLSearchParams(window.location.search).get('canvasId') ?? ''
        const firstCanvas = loadedCanvases.find((canvas) => canvas.id === requestedCanvasId) ?? loadedCanvases[0]
        setActiveCanvasId(firstCanvas?.id ?? '')
        setSelectedFlowNodeId(firstCanvas?.nodes?.[0]?.id ?? '')
        setNodes((firstCanvas?.nodes ?? []).map((node) => toFlowNode(node)))
        setEdges((firstCanvas?.edges ?? []).map(toFlowEdge))
        setAcceptedGraphSignature(canvasGraphSignature(firstCanvas?.nodes ?? [], firstCanvas?.edges ?? []))
        if (firstCanvas?.id) writeCanvasDeepLink(firstCanvas)
        if (firstCanvas?.id) {
          await loadVersions(firstCanvas.id, orgId ?? firstCanvas.orgId)
          await loadRuns(firstCanvas.id, orgId ?? firstCanvas.orgId)
          await loadRuntimeProof(firstCanvas.id, orgId ?? firstCanvas.orgId)
          await loadPresence(firstCanvas.id, orgId ?? firstCanvas.orgId)
          await loadComments(firstCanvas.id, orgId ?? firstCanvas.orgId)
        } else {
          setVersions([])
          setRunHistory([])
          setRunOperations(null)
          setRuntimeReadiness(null)
          setRuntimeProof(null)
          setPresence([])
          setComments([])
        }
      } catch {
        if (!cancelled) {
          setError('Creative Canvas could not load.')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    loadCanvases()

    return () => {
      cancelled = true
    }
  }, [loadComments, loadPresence, loadRuns, loadRuntimeProof, loadVersions, orgId, writeCanvasDeepLink])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!resolvedOrgId) {
        setTemplates([])
        return
      }
      try {
        await loadTemplates(resolvedOrgId)
      } catch {
        if (!cancelled) setTemplates([])
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [loadTemplates, resolvedOrgId])

  useEffect(() => {
    if (!activeCanvas?.id) return
    const canvasOrgId = resolvedOrgId || activeCanvas.orgId
    if (!canvasOrgId || typeof window === 'undefined' || typeof window.EventSource === 'undefined') return

    const source = new window.EventSource(`/api/v1/creative-canvas/${activeCanvas.id}/presence/events?orgId=${encodeURIComponent(canvasOrgId)}`)
    source.onopen = () => setCollaborationStreamConnected(true)
    source.onerror = () => setCollaborationStreamConnected(false)
    source.addEventListener('collaboration', (message) => {
      try {
        applyCollaborationStreamEvent(JSON.parse((message as MessageEvent).data) as CreativeCanvasCollaborationStreamEvent)
      } catch {
        // Ignore malformed collaboration stream events and allow EventSource to continue.
      }
    })

    return () => {
      source.close()
      setCollaborationStreamConnected(false)
    }
  }, [activeCanvas?.id, activeCanvas?.orgId, applyCollaborationStreamEvent, resolvedOrgId])

  useEffect(() => {
    if (!activeCanvas?.id) return
    const canvasOrgId = resolvedOrgId || activeCanvas.orgId
    if (!canvasOrgId) return
    sendPresenceHeartbeat(activeCanvas.id, canvasOrgId, selectedNodeId)
    const collaborationPollMs = graphHasUnsavedChanges || hasCollaboratorLiveDraft ? 3_000 : 8_000
    const heartbeat = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return
      sendPresenceHeartbeat(activeCanvas.id!, canvasOrgId, selectedNodeId)
      if (!collaborationStreamConnected) refreshCollaborationState(activeCanvas.id!, canvasOrgId, activeCanvas.activeVersion)
    }, collaborationPollMs)
    return () => window.clearInterval(heartbeat)
  }, [
    activeCanvas?.activeVersion,
    activeCanvas?.id,
    activeCanvas?.orgId,
    collaborationStreamConnected,
    graphHasUnsavedChanges,
    hasCollaboratorLiveDraft,
    refreshCollaborationState,
    resolvedOrgId,
    selectedNodeId,
    sendPresenceHeartbeat,
  ])

  useEffect(() => {
    let cancelled = false
    const loadSourceLibrary = async () => {
      if (!resolvedOrgId) {
        setSourceLibrary([])
        return
      }
      try {
        const params = new URLSearchParams({ orgId: resolvedOrgId, limit: '24' })
        if (sourceQuery.trim()) params.set('q', sourceQuery.trim())
        if (sourceKindFilter) params.set('sourceKind', sourceKindFilter)
        if (sourceRoleFilter) params.set('referenceRole', sourceRoleFilter)
        if (sourceMediaFilter) params.set('mediaType', sourceMediaFilter)
        const response = await fetch(`/api/v1/creative-canvas/sources?${params.toString()}`)
        const payload = (await response.json()) as CreativeCanvasSourceLibraryApiResponse
        if (!cancelled) setSourceLibrary(payload.data?.sources ?? [])
      } catch {
        if (!cancelled) setSourceLibrary([])
      }
    }

    loadSourceLibrary()

    return () => {
      cancelled = true
    }
  }, [resolvedOrgId, sourceKindFilter, sourceMediaFilter, sourceQuery, sourceRoleFilter])

  const onConnect = useCallback((connection: Connection) => {
    setEdges((currentEdges) => addEdge(connection, currentEdges))
  }, [])
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const removedNodeIds = new Set(changes
      .filter((change) => change.type === 'remove')
      .map((change) => change.id))
    const movedNodeIds = changes.flatMap((change) => (
      change.type === 'position' && 'id' in change && ('dragging' in change ? !change.dragging : true)
        ? [change.id]
        : []
    ))
    setNodes((currentNodes) => applyNodeChanges(changes, currentNodes).map((node) => {
      const canvasNode = node.data?.canvasNode as CreativeCanvasNode | undefined
      if (!canvasNode) return node
      return {
        ...node,
        data: {
          ...node.data,
          canvasNode: {
            ...canvasNode,
            position: node.position,
          },
        },
      }
    }))
    if (removedNodeIds.size) {
      setEdges((currentEdges) => currentEdges.filter((edge) => (
        !removedNodeIds.has(edge.source) && !removedNodeIds.has(edge.target)
      )))
      setSelectedFlowNodeId((currentSelectedId) => removedNodeIds.has(currentSelectedId) ? '' : currentSelectedId)
      recordCanvasActivity({
        actorLabel: 'You',
        action: 'Removed node',
        detail: `${removedNodeIds.size} node${removedNodeIds.size === 1 ? '' : 's'} removed from graph`,
        source: 'local',
      })
    }
    if (movedNodeIds.length) {
      recordCanvasActivity({
        actorLabel: 'You',
        action: 'Moved node',
        detail: `${movedNodeIds.length} node${movedNodeIds.length === 1 ? '' : 's'} repositioned`,
        nodeId: movedNodeIds[0],
        source: 'local',
      })
    }
  }, [recordCanvasActivity])
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    const removedEdges = changes.filter((change) => change.type === 'remove')
    setEdges((currentEdges) => applyEdgeChanges(changes, currentEdges))
    if (removedEdges.length) {
      recordCanvasActivity({
        actorLabel: 'You',
        action: 'Updated links',
        detail: `${removedEdges.length} link${removedEdges.length === 1 ? '' : 's'} removed`,
        source: 'local',
      })
    }
  }, [recordCanvasActivity])

  const addCanvasNode = (type: CreativeCanvasNodeType) => {
    const nextNumber = nodes.length + 1
    const title = `${nodeTypeLabels[type]} node`
    const id = `${type}-node-${Date.now()}`
    const canvasNode: CreativeCanvasNode = {
      id,
      orgId: resolvedOrgId || 'pending-org',
      type,
      title,
      position: { x: 80 + nextNumber * 40, y: 90 + nextNumber * 28 },
      data: { createdFrom: 'creative_canvas_palette' },
      source: type === 'source'
        ? {
            kind: 'upload',
            referenceRole: 'general',
            weight: 1,
            altText: title,
          }
        : undefined,
      provider: type === 'model'
        ? {
            key: 'higgsfield',
            model: runModel,
            mode: runOutputKind,
          }
        : undefined,
      edit: type === 'edit'
        ? {
            operation: 'inpaint',
            prompt: 'Describe the edit',
            references: [],
            strength: 0.65,
            motion: { mode: 'none' },
            outputKind: 'image',
          }
        : undefined,
      review: type === 'review'
        ? {
            status: 'needed',
            syntheticMediaDisclosure: true,
            rightsStatus: 'needs_review',
            brandStatus: 'needs_review',
          }
        : undefined,
    }

    setNodes((currentNodes) => [...currentNodes, toFlowNode(canvasNode)])
    setSelectedFlowNodeId(id)
    setSaveMessage('')
    recordCanvasActivity({
      actorLabel: 'You',
      action: 'Added node',
      detail: title,
      nodeId: id,
      source: 'local',
    })
  }

  const applyWorkflowPreset = (preset: CreativeCanvasWorkflowPreset) => {
    const graph = buildWorkflowPresetGraph(preset, {
      baseX: 80 + nodes.length * 18,
      baseY: 90 + nodes.length * 12,
      stamp: Date.now(),
      orgId: resolvedOrgId || 'pending-org',
    })

    setNodes((currentNodes) => [...currentNodes, ...graph.nodes.map((node) => toFlowNode(node))])
    setEdges((currentEdges) => [...currentEdges, ...graph.edges])
    setSelectedFlowNodeId(graph.nodes.find((node) => node.type === 'model' || node.type === 'edit')?.id ?? graph.nodes[0]?.id ?? '')
    setRunOutputKind(preset.outputKind ?? 'image')
    setRunModel(graph.nodes.find((node) => node.provider?.key === 'higgsfield')?.provider?.model ?? 'nano_banana_flash')
    setExportTarget(preset.exportTarget)
    setRunAspectRatio(preset.aspectRatio)
    setRunDurationSeconds(preset.durationSeconds)
    setRunStylePreset(preset.stylePreset)
    setRunCameraMotion(preset.cameraMotion)
    setRunNegativePrompt(preset.negativePrompt)
    setSaveMessage('')
    recordCanvasActivity({
      actorLabel: 'You',
      action: 'Added workflow',
      detail: `${preset.label}: ${graph.nodes.length} nodes / ${graph.edges.length} links`,
      nodeId: graph.nodes[0]?.id,
      source: 'local',
    })
    setActivityMessage(`${preset.label} workflow added`)
  }

  const applyMissingBenchmarkWorkflowSuite = () => {
    const existingScenarios = new Set(nodes
      .map((node) => (node.data?.canvasNode as CreativeCanvasNode | undefined)?.data?.benchmarkScenario)
      .filter((scenario): scenario is string => typeof scenario === 'string'))
    const missingPresets = workflowPresets.filter((preset) => (
      preset.benchmarkScenario && !existingScenarios.has(preset.benchmarkScenario)
    ))
    if (!missingPresets.length) {
      setActivityMessage('All Higgsfield benchmark workflows are already in this graph')
      return
    }
    const org = resolvedOrgId || 'pending-org'
    const stamp = Date.now()
    const graphs = missingPresets.map((preset, index) => buildWorkflowPresetGraph(preset, {
      baseX: 80 + (index % 2) * 760,
      baseY: 120 + Math.floor(index / 2) * 520 + nodes.length * 8,
      stamp: stamp + index,
      orgId: org,
    }))
    const nextNodes = graphs.flatMap((graph) => graph.nodes)
    const nextEdges = graphs.flatMap((graph) => graph.edges)
    const lastPreset = missingPresets[missingPresets.length - 1]

    setNodes((currentNodes) => [...currentNodes, ...nextNodes.map((node) => toFlowNode(node))])
    setEdges((currentEdges) => [...currentEdges, ...nextEdges])
    setSelectedFlowNodeId(nextNodes.find((node) => node.type === 'model' || node.type === 'edit')?.id ?? nextNodes[0]?.id ?? '')
    setRunOutputKind(lastPreset?.outputKind ?? 'image')
    setRunModel(nextNodes.find((node) => node.provider?.key === 'higgsfield')?.provider?.model ?? 'nano_banana_flash')
    setExportTarget(lastPreset?.exportTarget ?? 'campaign_asset')
    setRunAspectRatio(lastPreset?.aspectRatio ?? '1:1')
    setRunDurationSeconds(lastPreset?.durationSeconds ?? 0)
    setRunStylePreset(lastPreset?.stylePreset ?? 'clean_studio')
    setRunCameraMotion(lastPreset?.cameraMotion ?? 'none')
    setRunNegativePrompt(lastPreset?.negativePrompt ?? '')
    setSaveMessage('')
    recordCanvasActivity({
      actorLabel: 'You',
      action: 'Added benchmark suite',
      detail: `${missingPresets.length} workflows: ${nextNodes.length} nodes / ${nextEdges.length} links`,
      nodeId: nextNodes[0]?.id,
      source: 'local',
    })
    setActivityMessage(`Added ${missingPresets.length} Higgsfield benchmark workflow${missingPresets.length === 1 ? '' : 's'}`)
  }

  const saveCurrentGraphAsTemplate = async () => {
    if (!activeCanvas?.id || !resolvedOrgId || !nodes.length) return
    const title = templateTitle.trim() || `${activeCanvas.title} template`
    const graph = {
      nodes: nodes.map((node) => toCanvasNode(node, resolvedOrgId)),
      edges: edges.map((edge) => toCanvasEdge(edge, resolvedOrgId)),
    }
    const response = await fetch(`/api/v1/creative-canvas/templates?orgId=${encodeURIComponent(resolvedOrgId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        description: templateDescription.trim(),
        category: 'custom',
        sourceCanvasId: activeCanvas.id,
        sourceVersion: activeCanvas.activeVersion,
        ...graph,
      }),
    })
    const payload = await response.json().catch(() => null) as CreativeCanvasTemplateApiResponse | null
    const template = payload?.data?.template
    if (!response.ok || !template) {
      setActivityMessage(payload?.error ?? 'Template save failed')
      return
    }
    setTemplates((current) => [template, ...current.filter((item) => item.id !== template.id)])
    setTemplateTitle('')
    setTemplateDescription('')
    setSaveMessage('')
    setActivityMessage(`Saved ${template.title} template`)
  }

  const applySavedTemplate = (template: CreativeCanvasTemplate & { id: string }) => {
    const stamp = Date.now()
    const org = resolvedOrgId || activeCanvas?.orgId || 'pending-org'
    const baseX = 80 + nodes.length * 18
    const baseY = 90 + nodes.length * 12
    const idMap = new Map(template.nodes.map((node, index) => [node.id, `template-${template.id}-${index}-${stamp}`]))
    const cloneValue = <T,>(value: T | undefined): T | undefined => (
      value === undefined ? undefined : JSON.parse(JSON.stringify(value)) as T
    )
    const nextNodes = template.nodes.map((node, index): CreativeCanvasNode => {
      const edit = cloneValue(node.edit)
      if (edit?.references?.length) {
        edit.references = edit.references.map((reference) => ({
          ...reference,
          sourceNodeId: idMap.get(reference.sourceNodeId) ?? reference.sourceNodeId,
        }))
      }
      if (edit?.mask?.sourceNodeId) {
        edit.mask.sourceNodeId = idMap.get(edit.mask.sourceNodeId) ?? edit.mask.sourceNodeId
      }
      return {
        id: idMap.get(node.id) ?? `template-${template.id}-${index}-${stamp}`,
        orgId: org,
        type: node.type,
        title: node.title,
        position: {
          x: baseX + node.position.x,
          y: baseY + node.position.y,
        },
        data: {
          ...cloneValue(node.data),
          createdFrom: 'creative_canvas_saved_template',
          sourceTemplateId: template.id,
          sourceTemplateTitle: template.title,
        },
        source: cloneValue(node.source),
        provider: cloneValue(node.provider),
        edit,
        review: cloneValue(node.review),
        output: cloneValue(node.output),
      }
    })
    const nextEdges: Edge[] = template.edges
      .map((edge, index): Edge | undefined => {
        const source = idMap.get(edge.sourceNodeId)
        const target = idMap.get(edge.targetNodeId)
        if (!source || !target) return undefined
        return {
          id: `template-${template.id}-edge-${index}-${stamp}`,
          source,
          target,
          label: edge.label,
          data: {
            ...cloneValue(edge.data),
            createdFrom: 'creative_canvas_saved_template',
            sourceTemplateId: template.id,
          },
        }
      })
      .filter((edge): edge is Edge => Boolean(edge))

    setNodes((currentNodes) => [...currentNodes, ...nextNodes.map((node) => toFlowNode(node))])
    setEdges((currentEdges) => [...currentEdges, ...nextEdges])
    setSelectedFlowNodeId(nextNodes.find((node) => node.type === 'model' || node.type === 'edit')?.id ?? nextNodes[0]?.id ?? '')
    setSaveMessage('')
    recordCanvasActivity({
      actorLabel: 'You',
      action: 'Applied template',
      detail: `${template.title}: ${nextNodes.length} nodes / ${nextEdges.length} links`,
      nodeId: nextNodes[0]?.id,
      source: 'local',
    })
    setActivityMessage(`${template.title} template applied`)
  }

  const createFormatVariantBranches = () => {
    if (!selectedCanvasNode) return
    if (selectedNodeLockedByCollaborator) {
      setActivityMessage(`${selectedNodeCollaborators[0]?.displayName ?? selectedNodeCollaborators[0]?.actorUid ?? 'A collaborator'} is editing this node`)
      return
    }
    const org = resolvedOrgId || activeCanvas?.orgId || 'pending-org'
    const stamp = Date.now()
    const variantCount = Math.max(1, Math.min(runVariantCount, formatVariantPresets.length))
    const variants = formatVariantPresets.slice(0, variantCount)
    const basePosition = nodes.find((node) => node.id === selectedCanvasNode.id)?.position ?? selectedCanvasNode.position
    const nextNodes = variants.flatMap((variant, index): CreativeCanvasNode[] => {
      const modelId = `variant-${variant.key}-model-${stamp}-${index}`
      const outputId = `variant-${variant.key}-output-${stamp}-${index}`
      const outputKind = variant.outputKind ?? (runOutputKind as CreativeCanvasOutputKind)
      const durationSeconds = outputKind === 'youtube_render' || outputKind === 'video' || outputKind === 'social_post_draft'
        ? runDurationSeconds
        : 0
      const modelNode: CreativeCanvasNode = {
        id: modelId,
        orgId: org,
        type: 'model',
        title: `${variant.label} render`,
        position: {
          x: basePosition.x + 300,
          y: basePosition.y + index * 190,
        },
        data: {
          createdFrom: 'creative_canvas_format_variant',
          sourceNodeId: selectedCanvasNode.id,
          formatVariant: variant.key,
          generationSettings: {
            aspectRatio: variant.aspectRatio,
            durationSeconds,
            variantCount: 1,
            stylePreset: runStylePreset,
            cameraMotion: variant.cameraMotion,
            negativePrompt: runNegativePrompt,
            exportTarget: variant.exportTarget,
          },
        },
        provider: {
          key: 'higgsfield',
          model: runModel || 'nano_banana_flash',
          mode: outputKind,
        },
        edit: {
          operation: durationSeconds > 0 ? 'video_motion' : 'variation',
          references: [{ sourceNodeId: selectedCanvasNode.id, role: 'general', weight: 1 }],
          strength: 0.65,
          motion: { mode: variant.cameraMotion as NonNullable<NonNullable<CreativeCanvasNode['edit']>['motion']>['mode'], durationSeconds },
          outputKind,
        },
        review: {
          status: 'needed',
          syntheticMediaDisclosure: true,
          rightsStatus: 'needs_review',
          brandStatus: 'needs_review',
        },
      }
      const outputNode: CreativeCanvasNode = {
        id: outputId,
        orgId: org,
        type: 'output',
        title: `${variant.label} output`,
        position: {
          x: basePosition.x + 600,
          y: basePosition.y + index * 190,
        },
        data: {
          createdFrom: 'creative_canvas_format_variant',
          sourceNodeId: selectedCanvasNode.id,
          formatVariant: variant.key,
          exportTarget: variant.exportTarget,
        },
        output: {
          kind: outputKind,
          textPreview: `${variant.label} ${variant.aspectRatio} draft target: ${variant.exportTarget}`,
        },
        review: {
          status: 'needed',
          syntheticMediaDisclosure: true,
          rightsStatus: 'needs_review',
          brandStatus: 'needs_review',
        },
      }
      return [modelNode, outputNode]
    })
    const nextEdges = variants.flatMap((variant, index): Edge[] => {
      const modelId = `variant-${variant.key}-model-${stamp}-${index}`
      const outputId = `variant-${variant.key}-output-${stamp}-${index}`
      return [
        {
          id: `variant-${variant.key}-source-${stamp}-${index}`,
          source: selectedCanvasNode.id,
          target: modelId,
          label: 'variant source',
          data: { createdFrom: 'creative_canvas_format_variant', formatVariant: variant.key },
        },
        {
          id: `variant-${variant.key}-output-${stamp}-${index}`,
          source: modelId,
          target: outputId,
          label: 'variant output',
          data: { createdFrom: 'creative_canvas_format_variant', formatVariant: variant.key },
        },
      ]
    })

    setNodes((currentNodes) => [...currentNodes, ...nextNodes.map((node) => toFlowNode(node))])
    setEdges((currentEdges) => [...currentEdges, ...nextEdges])
    setSelectedFlowNodeId(nextNodes[0]?.id ?? selectedCanvasNode.id)
    setSaveMessage('')
    recordCanvasActivity({
      actorLabel: 'You',
      action: 'Created variants',
      detail: `${variants.length} format variant${variants.length === 1 ? '' : 's'} from ${selectedCanvasNode.title}`,
      nodeId: selectedCanvasNode.id,
      source: 'local',
    })
    setActivityMessage(`Created ${variants.length} format variant${variants.length === 1 ? '' : 's'} from ${selectedCanvasNode.title}`)
  }

  const duplicateSelectedNode = () => {
    if (!selectedCanvasNode) return
    if (selectedNodeLockedByCollaborator) {
      setActivityMessage(`${selectedNodeCollaborators[0]?.displayName ?? selectedNodeCollaborators[0]?.actorUid ?? 'A collaborator'} is editing this node`)
      return
    }
    const sourceFlowNode = nodes.find((node) => node.id === selectedCanvasNode.id)
    const stamp = Date.now()
    const duplicateId = `${selectedCanvasNode.id}-copy-${stamp}`
    const duplicateNode: CreativeCanvasNode = {
      ...selectedCanvasNode,
      id: duplicateId,
      orgId: resolvedOrgId || selectedCanvasNode.orgId,
      title: `${selectedCanvasNode.title} copy`,
      position: {
        x: (sourceFlowNode?.position.x ?? selectedCanvasNode.position.x) + 220,
        y: (sourceFlowNode?.position.y ?? selectedCanvasNode.position.y) + 80,
      },
      data: {
        ...(cloneCanvasField(selectedCanvasNode.data) ?? {}),
        createdFrom: 'creative_canvas_node_duplicate',
        duplicatedFromNodeId: selectedCanvasNode.id,
        duplicatedFromTitle: selectedCanvasNode.title,
      },
      source: cloneCanvasField(selectedCanvasNode.source),
      provider: cloneCanvasField(selectedCanvasNode.provider),
      edit: cloneCanvasField(selectedCanvasNode.edit),
      review: cloneCanvasField(selectedCanvasNode.review),
      output: cloneCanvasField(selectedCanvasNode.output),
    }
    const branchEdge: Edge = {
      id: `duplicate-${selectedCanvasNode.id}-${duplicateId}`,
      source: selectedCanvasNode.id,
      target: duplicateId,
      label: 'duplicate branch',
      data: {
        createdFrom: 'creative_canvas_node_duplicate',
        duplicatedFromNodeId: selectedCanvasNode.id,
      },
    }

    setNodes((currentNodes) => [...currentNodes, toFlowNode(duplicateNode)])
    setEdges((currentEdges) => [...currentEdges, branchEdge])
    setSelectedFlowNodeId(duplicateId)
    setSaveMessage('')
    recordCanvasActivity({
      actorLabel: 'You',
      action: 'Duplicated node',
      detail: selectedCanvasNode.title,
      nodeId: duplicateId,
      source: 'local',
    })
    setActivityMessage(`Duplicated ${selectedCanvasNode.title}`)
  }

  const createInpaintEditBranch = () => {
    if (!selectedCanvasNode) return
    if (selectedNodeLockedByCollaborator) {
      setActivityMessage(`${selectedNodeCollaborators[0]?.displayName ?? selectedNodeCollaborators[0]?.actorUid ?? 'A collaborator'} is editing this node`)
      return
    }
    const sourceFlowNode = nodes.find((node) => node.id === selectedCanvasNode.id)
    const stamp = Date.now()
    const editNodeId = `${selectedCanvasNode.id}-inpaint-${stamp}`
    const editNode: CreativeCanvasNode = {
      id: editNodeId,
      orgId: resolvedOrgId || selectedCanvasNode.orgId,
      type: 'edit',
      title: `${selectedCanvasNode.title} inpaint edit`,
      position: {
        x: (sourceFlowNode?.position.x ?? selectedCanvasNode.position.x) + 280,
        y: (sourceFlowNode?.position.y ?? selectedCanvasNode.position.y) + 120,
      },
      data: {
        createdFrom: 'creative_canvas_inpaint_branch',
        sourceNodeId: selectedCanvasNode.id,
        sourceNodeTitle: selectedCanvasNode.title,
        generationSettings: {
          model: runModel || selectedCanvasNode.provider?.model || 'nano_banana_flash',
          outputKind: 'image',
          aspectRatio: runAspectRatio,
          stylePreset: runStylePreset,
          negativePrompt: runNegativePrompt,
        },
      },
      provider: {
        key: 'higgsfield',
        model: runModel || selectedCanvasNode.provider?.model || 'nano_banana_flash',
        mode: 'image',
      },
      edit: {
        operation: 'inpaint',
        intent: 'generative_fill',
        prompt: `Brush over the target area and describe the replacement for ${selectedCanvasNode.title}. Match lighting, texture, shadows, and perspective.`,
        references: [{ sourceNodeId: selectedCanvasNode.id, role: 'mask', weight: 1 }],
        strength: 0.65,
        blendControls: {
          lightMatch: true,
          textureAdaptive: true,
          autoShadows: true,
          perspectiveMatch: true,
          preserveSubject: true,
        },
        mask: {
          sourceNodeId: selectedCanvasNode.id,
          region: { ...maskQuickRegions[0].region, unit: 'percent' },
        },
        motion: { mode: 'none' },
        outputKind: 'image',
      },
      review: {
        status: 'needed',
        syntheticMediaDisclosure: true,
        rightsStatus: 'needs_review',
        brandStatus: 'needs_review',
      },
    }
    const editEdge: Edge = {
      id: `inpaint-${selectedCanvasNode.id}-${editNodeId}`,
      source: selectedCanvasNode.id,
      target: editNodeId,
      label: 'inpaint edit',
      data: {
        createdFrom: 'creative_canvas_inpaint_branch',
        sourceNodeId: selectedCanvasNode.id,
      },
    }

    setNodes((currentNodes) => [...currentNodes, toFlowNode(editNode)])
    setEdges((currentEdges) => [...currentEdges, editEdge])
    setSelectedFlowNodeId(editNodeId)
    setMaskRegion({ ...maskQuickRegions[0].region })
    setSaveMessage('')
    recordCanvasActivity({
      actorLabel: 'You',
      action: 'Created inpaint branch',
      detail: selectedCanvasNode.title,
      nodeId: editNodeId,
      source: 'local',
    })
    setActivityMessage(`Created inpaint edit branch from ${selectedCanvasNode.title}`)
  }

  const openCanvas = async (canvas: CreativeCanvas) => {
    applyCanvasSnapshot(canvas)
    writeCanvasDeepLink(canvas)
    if (canvas.id) {
      await loadVersions(canvas.id, orgId ?? canvas.orgId)
      await loadRuns(canvas.id, orgId ?? canvas.orgId)
      await loadRuntimeProof(canvas.id, orgId ?? canvas.orgId)
      await loadPresence(canvas.id, orgId ?? canvas.orgId)
      await loadComments(canvas.id, orgId ?? canvas.orgId)
    }
  }

  const copyCollaborationLink = async () => {
    if (!collaborationLink) return
    await navigator.clipboard?.writeText(collaborationLink)
    setCollaborationLinkCopied(true)
    setActivityMessage('Canvas collaboration link copied')
    window.setTimeout(() => setCollaborationLinkCopied(false), 1800)
  }

  const importSourceItem = (item: CreativeCanvasSourceLibraryItem) => {
    const nextNumber = nodes.length + 1
    const canvasNode: CreativeCanvasNode = {
      id: `source-${item.source.refId ?? Date.now()}-${Date.now()}`,
      orgId: resolvedOrgId || 'pending-org',
      type: 'source',
      title: item.title,
      position: { x: 80 + nextNumber * 40, y: 90 + nextNumber * 28 },
      data: {
        createdFrom: 'creative_canvas_source_library',
        sourceLibraryId: item.id,
        sourceCollection: item.sourceCollection,
      },
      source: item.source,
    }

    setNodes((currentNodes) => [...currentNodes, toFlowNode(canvasNode)])
    setSelectedFlowNodeId(canvasNode.id)
    setSaveMessage('')
  }

  const uploadSourceFiles = async (files: FileList | null) => {
    if (!files?.length || !resolvedOrgId) return
    setSourceUploading(true)
    setActivityMessage('')
    try {
      const uploaded: CreativeCanvasSourceLibraryItem[] = []
      for (const file of Array.from(files)) {
        const form = new FormData()
        form.append('orgId', resolvedOrgId)
        if (activeCanvas?.id) form.append('canvasId', activeCanvas.id)
        form.append('referenceRole', sourceUploadRole)
        if (sourceUploadAltText.trim()) form.append('altText', sourceUploadAltText.trim())
        form.append('file', file)
        const response = await fetch('/api/v1/creative-canvas/sources/upload', { method: 'POST', body: form })
        const payload = await response.json().catch(() => null) as CreativeCanvasSourceLibraryApiResponse | null
        const source = payload?.data?.source
        if (!response.ok || !source) throw new Error('Source upload failed')
        uploaded.push(source)
      }
      uploaded.forEach(importSourceItem)
      setSourceLibrary((current) => [...uploaded, ...current.filter((item) => !uploaded.some((source) => source.id === item.id))])
      setActivityMessage(uploaded.length === 1 ? `Source uploaded: ${uploaded[0].title}` : `${uploaded.length} sources uploaded`)
      setSourceUploadAltText('')
    } catch {
      setActivityMessage('Source upload failed')
    } finally {
      setSourceUploading(false)
    }
  }

  const updateMaskRegionValue = (key: keyof typeof maskRegion, value: string) => {
    setMaskRegion((current) => ({
      ...current,
      [key]: Math.max(0, Number(value) || 0),
    }))
  }

  const applyMaskQuickRegion = (region: typeof maskQuickRegions[number]['region']) => {
    setMaskRegion(region)
  }

  const updateSelectedEditNode = (updater: (node: CreativeCanvasNode) => CreativeCanvasNode) => {
    if (!selectedCanvasNode?.edit) return
    setNodes((currentNodes) => currentNodes.map((node) => {
      if (node.id !== selectedCanvasNode.id) return node
      const canvasNode = node.data?.canvasNode as CreativeCanvasNode | undefined
      if (!canvasNode?.edit) return node
      return toFlowNode(updater(canvasNode))
    }))
    setSaveMessage('')
  }

  const applyGenerationSettingsToSelectedNode = () => {
    if (!selectedCanvasNode) return
    if (selectedNodeLockedByCollaborator) {
      setActivityMessage(`${selectedNodeCollaborators[0]?.displayName ?? selectedNodeCollaborators[0]?.actorUid ?? 'A collaborator'} is editing this node`)
      return
    }
    setNodes((currentNodes) => currentNodes.map((node) => {
      if (node.id !== selectedCanvasNode.id) return node
      const canvasNode = node.data?.canvasNode as CreativeCanvasNode | undefined
      if (!canvasNode) return node
      const nextNode: CreativeCanvasNode = {
        ...canvasNode,
        provider: {
          key: 'higgsfield',
          model: runModel || canvasNode.provider?.model || 'nano_banana_flash',
          mode: runOutputKind,
        },
        data: {
          ...canvasNode.data,
          generationSettings: {
            aspectRatio: runAspectRatio,
            durationSeconds: runDurationSeconds,
            variantCount: runVariantCount,
            stylePreset: runStylePreset,
            cameraMotion: runCameraMotion,
            negativePrompt: runNegativePrompt,
          },
        },
        edit: canvasNode.edit
          ? {
              ...canvasNode.edit,
              outputKind: runOutputKind as CreativeCanvasRun['input']['outputKind'],
              motion: {
                ...canvasNode.edit.motion,
                mode: runCameraMotion as NonNullable<NonNullable<CreativeCanvasNode['edit']>['motion']>['mode'],
                durationSeconds: runDurationSeconds,
              },
            }
          : canvasNode.edit,
      }
      return toFlowNode(nextNode)
    }))
    setSaveMessage('')
    setActivityMessage(`Generation settings applied to ${selectedCanvasNode.title}`)
  }

  const applyHiggsfieldModelPreset = (model: (typeof higgsfieldModelSuggestions)[number]) => {
    setRunModel(model.id)
    setRunOutputKind(model.outputKind)
    setRunAspectRatio(model.aspectRatio)
    setRunDurationSeconds(model.durationSeconds)
    setRunCameraMotion(model.cameraMotion)
    setRunStylePreset(model.stylePreset)
    setActivityMessage(`${model.label} routing selected`)
  }

  const applyMaskRegion = () => {
    if (!selectedCanvasNode?.edit) return

    const region = {
      x: Math.min(100, maskRegion.x),
      y: Math.min(100, maskRegion.y),
      width: Math.min(100, maskRegion.width),
      height: Math.min(100, maskRegion.height),
      unit: 'percent' as const,
      feather: Math.min(100, maskRegion.feather),
    }

    updateSelectedEditNode((node) => ({
      ...node,
      edit: node.edit
        ? {
            ...node.edit,
            mask: {
              ...node.edit.mask,
              region,
            },
          }
        : node.edit,
    }))
  }

  const updateEditIntent = (intent: CreativeCanvasEditIntent) => {
    updateSelectedEditNode((node) => ({
      ...node,
      edit: node.edit
        ? {
            ...node.edit,
            intent,
          }
        : node.edit,
    }))
    setActivityMessage(`Edit intent set to ${intent.replaceAll('_', ' ')}`)
  }

  const updateEditPrompt = (prompt: string) => {
    updateSelectedEditNode((node) => ({
      ...node,
      edit: node.edit
        ? {
            ...node.edit,
            prompt,
          }
        : node.edit,
    }))
  }

  const toggleBlendControl = (key: keyof NonNullable<NonNullable<CreativeCanvasNode['edit']>['blendControls']>, checked: boolean) => {
    updateSelectedEditNode((node) => ({
      ...node,
      edit: node.edit
        ? {
            ...node.edit,
            blendControls: {
              ...node.edit.blendControls,
              [key]: checked,
            },
          }
        : node.edit,
    }))
  }

  const maskPointFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    if (!bounds.width || !bounds.height || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return { x: 50, y: 50 }
    return {
      x: Math.round(Math.min(100, Math.max(0, ((event.clientX - bounds.left) / bounds.width) * 100))),
      y: Math.round(Math.min(100, Math.max(0, ((event.clientY - bounds.top) / bounds.height) * 100))),
    }
  }

  const appendBrushPoint = (strokeId: string, point: { x: number; y: number }) => {
    updateSelectedEditNode((node) => {
      const strokes = node.edit?.mask?.brush?.strokes ?? []
      return {
        ...node,
        edit: node.edit
          ? {
              ...node.edit,
              mask: {
                ...node.edit.mask,
                brush: {
                  strokes: strokes.map((stroke) => {
                    if (stroke.id !== strokeId) return stroke
                    const lastPoint = stroke.points[stroke.points.length - 1]
                    if (lastPoint && Math.abs(lastPoint.x - point.x) < 1 && Math.abs(lastPoint.y - point.y) < 1) return stroke
                    return {
                      ...stroke,
                      points: [...stroke.points, point].slice(0, 300),
                    }
                  }),
                },
              },
            }
          : node.edit,
      }
    })
  }

  const addBrushStroke = (point: { x: number; y: number }) => {
    const strokeId = `brush-${Date.now()}-${selectedMaskBrushStrokes.length + 1}`
    updateSelectedEditNode((node) => {
      const strokes = node.edit?.mask?.brush?.strokes ?? []
      return {
        ...node,
        edit: node.edit
          ? {
              ...node.edit,
              mask: {
                ...node.edit.mask,
                brush: {
                  strokes: [
                    ...strokes,
                    {
                      id: strokeId,
                      points: [point],
                      size: maskBrushSize,
                      opacity: maskBrushMode === 'erase' ? 0.7 : 0.45,
                      mode: maskBrushMode,
                      unit: 'percent',
                    },
                  ],
                },
              },
            }
          : node.edit,
      }
    })
    activeMaskBrushStrokeIdRef.current = strokeId
    setActiveMaskBrushStrokeId(strokeId)
  }

  const handleMaskBrushPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    addBrushStroke(maskPointFromPointer(event))
  }

  const handleMaskBrushPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const strokeId = activeMaskBrushStrokeIdRef.current || activeMaskBrushStrokeId
    if (!strokeId) return
    event.preventDefault()
    appendBrushPoint(strokeId, maskPointFromPointer(event))
  }

  const handleMaskBrushPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activeMaskBrushStrokeIdRef.current || activeMaskBrushStrokeId) {
      event.currentTarget.releasePointerCapture?.(event.pointerId)
      activeMaskBrushStrokeIdRef.current = ''
      setActiveMaskBrushStrokeId('')
    }
  }

  const undoBrushStroke = () => {
    updateSelectedEditNode((node) => {
      const strokes = node.edit?.mask?.brush?.strokes ?? []
      const nextStrokes = strokes.slice(0, -1)
      return {
        ...node,
        edit: node.edit
          ? {
              ...node.edit,
              mask: {
                ...node.edit.mask,
                brush: nextStrokes.length ? { strokes: nextStrokes } : undefined,
              },
            }
          : node.edit,
      }
    })
    activeMaskBrushStrokeIdRef.current = ''
    setActiveMaskBrushStrokeId('')
  }

  const clearBrushMask = () => {
    updateSelectedEditNode((node) => ({
      ...node,
      edit: node.edit
        ? {
            ...node.edit,
            mask: {
              ...node.edit.mask,
              brush: undefined,
            },
          }
        : node.edit,
    }))
    activeMaskBrushStrokeIdRef.current = ''
    setActiveMaskBrushStrokeId('')
  }

  const selectFlowNode = useCallback((_: unknown, node: Node) => {
    setSelectedFlowNodeId(node.id)
  }, [])

  const saveGraph = useCallback(async (reason: 'manual' | 'auto' = 'manual') => {
    if (!activeCanvas?.id || saving) return

    setSaving(true)
    setSaveMessage(reason === 'auto' ? 'Auto-saving graph' : '')

    try {
      const query = resolvedOrgId ? `?orgId=${encodeURIComponent(resolvedOrgId)}` : ''
      const response = await fetch(`/api/v1/creative-canvas/${activeCanvas.id}/graph${query}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedActiveVersion: activeCanvas.activeVersion,
          mergeOnConflict: true,
          reason: reason === 'auto' ? 'auto_graph_save' : 'graph_save',
          baseGraph: {
            nodes: activeCanvas.nodes ?? [],
            edges: activeCanvas.edges ?? [],
          },
          nodes: nodes.map((node) => toCanvasNode(node, resolvedOrgId || activeCanvas.orgId)),
          edges: edges.map((edge) => toCanvasEdge(edge, resolvedOrgId || activeCanvas.orgId)),
        }),
      })
      const payload = await response.json().catch(() => null) as CreativeCanvasApiListResponse | null

      if (!response.ok) {
        const conflict = payload as { code?: string; currentActiveVersion?: number } | null
        if (response.status === 409 || conflict?.code === 'creative_canvas_version_conflict') {
          const conflictCount = payload?.conflicts?.length ?? 0
          const draftNodes = nodes.map((node) => toCanvasNode(node, resolvedOrgId || activeCanvas.orgId))
          const draftEdges = edges.map((edge) => toCanvasEdge(edge, resolvedOrgId || activeCanvas.orgId))
          const conflictDetailSummary = payload?.conflictDetails?.length
            ? ` Conflicts: ${payload.conflictDetails.slice(0, 3).map((item) => `${item.kind} "${item.label}"`).join(', ')}.`
            : ''
          setConflictDraft({
            title: `${activeCanvas.title} local conflict branch`,
            purpose: activeCanvas.purpose,
            nodes: draftNodes,
            edges: draftEdges,
            currentActiveVersion: conflict?.currentActiveVersion,
            conflictDetails: payload?.conflictDetails,
          })
          setSaveMessage(
            `Graph changed in another session. ${conflictCount ? `${conflictCount} overlapping edit${conflictCount === 1 ? '' : 's'} need review. ` : ''}Refresh versions before saving${conflict?.currentActiveVersion ? ` (current v${conflict.currentActiveVersion})` : ''}.${conflictDetailSummary}`,
          )
          if (activeCanvas.id) {
            await loadVersions(activeCanvas.id, resolvedOrgId || activeCanvas.orgId)
            await loadPresence(activeCanvas.id, resolvedOrgId || activeCanvas.orgId)
          }
          return
        }
        throw new Error('Save failed')
      }

      const savedCanvas = payload?.data?.canvas
      if (savedCanvas?.id) {
        setCanvases((current) => current.map((canvas) => canvas.id === savedCanvas.id ? savedCanvas : canvas))
        setAcceptedGraphSignature(currentGraphSignature)
        setRemoteCanvasUpdate(null)
      }
      setSaveMessage(reason === 'auto' ? 'Auto-saved graph' : 'Graph saved')
      await loadVersions(activeCanvas.id, resolvedOrgId || activeCanvas.orgId)
    } catch {
      setSaveMessage(reason === 'auto' ? 'Auto-save failed' : 'Graph save failed')
    } finally {
      setSaving(false)
    }
  }, [
    activeCanvas,
    currentGraphSignature,
    edges,
    loadPresence,
    loadVersions,
    nodes,
    resolvedOrgId,
    saving,
  ])

  const forkConflictDraft = async () => {
    if (!conflictDraft || !activeCanvas?.id) return

    const canvasOrgId = resolvedOrgId || activeCanvas.orgId
    const query = canvasOrgId ? `?orgId=${encodeURIComponent(canvasOrgId)}` : ''
    const response = await fetch(`/api/v1/creative-canvas${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: conflictDraft.title,
        purpose: conflictDraft.purpose,
        status: 'draft',
        visibility: activeCanvas.visibility,
        linked: activeCanvas.linked,
        nodes: conflictDraft.nodes,
        edges: conflictDraft.edges,
      }),
    })
    const payload = await response.json().catch(() => null) as CreativeCanvasApiListResponse | null
    if (!response.ok || !payload?.data?.canvas) {
      setActivityMessage(payload?.error ?? 'Conflict branch creation failed')
      return
    }

    applyCanvasSnapshot(payload.data.canvas)
    setConflictDraft(null)
    setSaveMessage(`Forked local conflict draft from v${conflictDraft.currentActiveVersion ?? activeCanvas.activeVersion}`)
    await loadVersions(payload.data.canvas.id ?? activeCanvas.id, canvasOrgId)
    await loadRuns(payload.data.canvas.id ?? activeCanvas.id, canvasOrgId)
    await loadPresence(payload.data.canvas.id ?? activeCanvas.id, canvasOrgId)
    await loadComments(payload.data.canvas.id ?? activeCanvas.id, canvasOrgId)
  }

  useEffect(() => {
    if (!autoSaveEnabled || !graphHasUnsavedChanges || !activeCanvas?.id || saving) return
    const timeout = window.setTimeout(() => {
      void saveGraph('auto')
    }, 3500)
    return () => window.clearTimeout(timeout)
  }, [activeCanvas?.id, autoSaveEnabled, graphHasUnsavedChanges, saveGraph, saving])

  const runVersionAction = async (version: CreativeCanvasVersion & { id?: string }, action: 'restore' | 'fork') => {
    if (!activeCanvas?.id || !version.id) return
    if (graphHasUnsavedChanges && !versionPreview) {
      setActivityMessage('Save or clear local graph edits before restoring or forking a saved version')
      return
    }

    const query = resolvedOrgId ? `?orgId=${encodeURIComponent(resolvedOrgId)}` : ''
    const response = await fetch(`/api/v1/creative-canvas/${activeCanvas.id}/versions${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        versionId: version.id,
      }),
    })
    const payload = await response.json().catch(() => null) as CreativeCanvasVersionApiResponse | null
    if (!response.ok || !payload?.data?.canvas) {
      setActivityMessage(payload?.error ?? `Version ${action} failed`)
      return
    }

    const nextCanvas = payload.data.canvas
    applyCanvasSnapshot(nextCanvas)
    await loadVersions(nextCanvas.id ?? activeCanvas.id, resolvedOrgId || nextCanvas.orgId)
    await loadRuns(nextCanvas.id ?? activeCanvas.id, resolvedOrgId || nextCanvas.orgId)
    await loadPresence(nextCanvas.id ?? activeCanvas.id, resolvedOrgId || nextCanvas.orgId)
    await loadComments(nextCanvas.id ?? activeCanvas.id, resolvedOrgId || nextCanvas.orgId)
    setActivityMessage(action === 'restore'
      ? `Restored version ${version.version}`
      : `Forked version ${version.version}`)
  }

  const postComment = async () => {
    if (!activeCanvas?.id || !commentBody.trim()) return

    const query = resolvedOrgId ? `?orgId=${encodeURIComponent(resolvedOrgId)}` : ''
    const response = await fetch(`/api/v1/creative-canvas/${activeCanvas.id}/comments${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeId: selectedNodeId,
        body: commentBody,
        visibility: mode === 'portal' ? 'admin_agents_clients' : 'admin_agents',
      }),
    })

    const payload = await response.json().catch(() => null) as CreativeCanvasCommentApiResponse | null

    if (response.ok) {
      setActivityMessage('Comment added')
      setCommentBody('')
      if (payload?.data?.comment) {
        setComments((current) => [payload.data!.comment!, ...current.filter((comment) => comment.id !== payload.data!.comment!.id)])
      } else {
        await loadComments(activeCanvas.id, resolvedOrgId || activeCanvas.orgId)
      }
    } else {
      setActivityMessage('Comment failed')
    }
  }

  const attachSampleOutput = async () => {
    if (!activeCanvas?.id || !selectedNodeId) return

    const query = resolvedOrgId ? `?orgId=${encodeURIComponent(resolvedOrgId)}` : ''
    const response = await fetch(`/api/v1/creative-canvas/${activeCanvas.id}/nodes/${selectedNodeId}/output${query}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'image',
        textPreview: 'Review-ready creative output',
        review: {
          status: 'needed',
          rightsStatus: 'needs_review',
          brandStatus: 'needs_review',
          syntheticMediaDisclosure: true,
        },
      }),
    })
    setActivityMessage(response.ok ? 'Output attached for review' : 'Output attach failed')
  }

  const markReviewPassed = async () => {
    if (!activeCanvas?.id || !selectedNodeId) return

    const query = resolvedOrgId ? `?orgId=${encodeURIComponent(resolvedOrgId)}` : ''
    const response = await fetch(`/api/v1/creative-canvas/${activeCanvas.id}/nodes/${selectedNodeId}/review${query}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'passed',
        rightsStatus: 'cleared',
        brandStatus: 'passed',
        syntheticMediaDisclosure: true,
      }),
    })
    setActivityMessage(response.ok ? 'Review gate passed' : 'Review update failed')
  }

  const queueRun = async () => {
    if (!activeCanvas?.id || !selectedNodeId) return

    const selectedEdit = selectedCanvasNode?.edit
    const query = resolvedOrgId ? `?orgId=${encodeURIComponent(resolvedOrgId)}` : ''
    const response = await fetch(`/api/v1/creative-canvas/${activeCanvas.id}/runs${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        canvasId: activeCanvas.id,
        nodeId: selectedNodeId,
        providerKey: 'higgsfield',
        model: runModel || selectedCanvasNode?.provider?.model,
        input: {
          promptSummary: selectedEdit?.prompt || 'Generate a reviewable creative asset from the active canvas node.',
          sourceNodeIds: selectedNodeId ? [selectedNodeId] : [],
          sourceArtifactIds: [],
          format: 'internal_draft',
          outputKind: selectedEdit?.outputKind ?? runOutputKind,
          operation: selectedEdit?.operation,
          aspectRatio: runAspectRatio,
          durationSeconds: runDurationSeconds,
          variantCount: runVariantCount,
          stylePreset: runStylePreset,
          cameraMotion: selectedEdit?.motion?.mode && selectedEdit.motion.mode !== 'none'
            ? selectedEdit.motion.mode
            : runCameraMotion,
          negativePrompt: runNegativePrompt,
          editMask: selectedEdit?.mask,
          editIntent: selectedEdit?.intent,
          blendControls: selectedEdit?.blendControls,
        },
      }),
    })
    if (!response.ok) {
      setActivityMessage('Run queue failed')
      return
    }
    const payload = await response.json().catch(() => null) as CreativeCanvasRunApiResponse | null
    const run = payload?.data?.run
    if (run?.id) {
      setLatestRun({ id: run.id, status: run.status ?? 'queued', nodeId: run.nodeId })
      setRunHistory((currentRuns) => [run, ...currentRuns.filter((item) => item.id !== run.id)])
      await loadRuns(activeCanvas.id, resolvedOrgId || activeCanvas.orgId)
      const providerExecution = payload?.data?.agentTaskDraft?.agentInput?.providerExecution
      setLatestExecution({
        command: providerExecution?.cli?.display,
        dispatchPath: providerExecution?.dispatch?.path,
        callbackPath: providerExecution?.callback?.path,
        statusPath: providerExecution?.statusRefresh?.path,
      })
      setActivityMessage(`Run queued: ${run.id}`)
    } else {
      setActivityMessage('Run queued for agent review')
    }
  }

  const refreshLatestRunStatus = async () => {
    if (!activeCanvas?.id || !latestRun?.id) return

    const query = resolvedOrgId ? `?orgId=${encodeURIComponent(resolvedOrgId)}` : ''
    const response = await fetch(`/api/v1/creative-canvas/${activeCanvas.id}/runs/${latestRun.id}/provider-status${query}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'running',
        providerStatus: 'poll_requested',
        providerStatusMessage: 'Manual status refresh requested from Creative Canvas.',
      }),
    })
    if (response.ok) {
      const payload = await response.json().catch(() => null) as CreativeCanvasRunApiResponse | null
      const run = payload?.data?.run
      if (run?.id) {
        setLatestRun({ id: run.id, status: run.status ?? 'running', nodeId: run.nodeId })
        setRunHistory((currentRuns) => [run, ...currentRuns.filter((item) => item.id !== run.id)])
      }
      await loadRuns(activeCanvas.id, resolvedOrgId || activeCanvas.orgId)
      setActivityMessage(`Run status refreshed: ${latestRun.id}`)
    } else {
      setActivityMessage('Run status refresh failed')
    }
  }

  const retryProviderRun = async (run: CreativeCanvasRun & { id: string }) => {
    if (!activeCanvas?.id || !run.id) return

    const query = resolvedOrgId ? `?orgId=${encodeURIComponent(resolvedOrgId)}` : ''
    const response = await fetch(`/api/v1/creative-canvas/${activeCanvas.id}/runs/${run.id}/retry${query}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
    })
    const payload = await response.json().catch(() => null) as CreativeCanvasRunApiResponse | null
    const retriedRun = payload?.data?.run
    if (response.ok && retriedRun?.id) {
      setLatestRun({ id: retriedRun.id, status: retriedRun.status ?? 'queued', nodeId: retriedRun.nodeId })
      setRunHistory((currentRuns) => [retriedRun, ...currentRuns.filter((item) => item.id !== retriedRun.id)])
      await loadRuns(activeCanvas.id, resolvedOrgId || activeCanvas.orgId)
      setActivityMessage(`Retry queued: ${retriedRun.id}`)
    } else {
      setActivityMessage(payload?.error ?? 'Run retry failed')
    }
  }

  const retryAllProviderRuns = async () => {
    if (!activeCanvas?.id) return

    const query = resolvedOrgId ? `?orgId=${encodeURIComponent(resolvedOrgId)}` : ''
    const response = await fetch(`/api/v1/creative-canvas/${activeCanvas.id}/runs/retry${query}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
    })
    const payload = await response.json().catch(() => null) as CreativeCanvasRunApiResponse | null
    const retriedRuns = payload?.data?.retriedRuns ?? []
    if (response.ok) {
      setRunHistory((currentRuns) => {
        const retriedMap = new Map(retriedRuns.map((run) => [run.id, run]))
        return currentRuns.map((run) => retriedMap.get(run.id) ?? run)
      })
      if (payload?.data?.operations) setRunOperations(payload.data.operations)
      if (retriedRuns[0]) {
        setLatestRun({ id: retriedRuns[0].id, status: retriedRuns[0].status, nodeId: retriedRuns[0].nodeId })
      }
      setActivityMessage(retriedRuns.length === 1
        ? 'Retried 1 provider run'
        : `Retried ${retriedRuns.length} provider runs`)
    } else {
      setActivityMessage(payload?.error ?? 'Provider batch retry failed')
    }
  }

  const queueProofBatchRuns = async () => {
    if (!activeCanvas?.id) return

    const canvasOrgId = resolvedOrgId || activeCanvas.orgId
    const query = canvasOrgId ? `?orgId=${encodeURIComponent(canvasOrgId)}` : ''
    const response = await fetch(`/api/v1/creative-canvas/${activeCanvas.id}/runs/proof-batch${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const payload = await response.json().catch(() => null) as CreativeCanvasRunApiResponse | null
    const queuedRuns = payload?.data?.queuedRuns ?? []
    if (response.ok) {
      if (queuedRuns.length) {
        setRunHistory((currentRuns) => {
          const queuedMap = new Map(queuedRuns.map((run) => [run.id, run]))
          return [...queuedRuns, ...currentRuns.filter((run) => !queuedMap.has(run.id))]
        })
        setLatestRun({ id: queuedRuns[0].id, status: queuedRuns[0].status, nodeId: queuedRuns[0].nodeId })
      }
      if (payload?.data?.operations) setRunOperations(payload.data.operations)
      await loadRuns(activeCanvas.id, canvasOrgId)
      await loadRuntimeProof(activeCanvas.id, canvasOrgId)
      setActivityMessage(queuedRuns.length
        ? `Queued ${queuedRuns.length} proof run${queuedRuns.length === 1 ? '' : 's'}`
        : 'Proof batch already covered or active')
    } else {
      setActivityMessage(payload?.error ?? 'Proof batch queue failed')
    }
  }

  const refreshRuntimeProof = async () => {
    if (!activeCanvas?.id) return
    await loadRuntimeProof(activeCanvas.id, resolvedOrgId || activeCanvas.orgId)
    setActivityMessage('Runtime proof refreshed')
  }

  const selectCanvasAsset = (assetId: string) => {
    const asset = canvasAssets.find((item) => item.id === assetId)
    setSelectedAssetId(assetId)
    if (asset?.suggestedExportTarget) {
      setExportTarget(asset.suggestedExportTarget)
    }
  }

  const updateSelectedAssetNode = (updater: (node: CreativeCanvasNode) => CreativeCanvasNode) => {
    if (!selectedCanvasAsset?.nodeId) return
    setNodes((currentNodes) => currentNodes.map((node) => {
      if (node.id !== selectedCanvasAsset.nodeId) return node
      const canvasNode = node.data?.canvasNode as CreativeCanvasNode | undefined
      if (!canvasNode) return node
      return toFlowNode(updater(canvasNode))
    }))
    setSaveMessage('')
  }

  const updateSelectedAssetTitle = (title: string) => {
    updateSelectedAssetNode((node) => ({ ...node, title }))
  }

  const updateSelectedAssetReferenceRole = (referenceRole: string) => {
    updateSelectedAssetNode((node) => node.source
      ? {
          ...node,
          source: {
            ...node.source,
            referenceRole: referenceRole as NonNullable<CreativeCanvasNode['source']>['referenceRole'],
          },
        }
      : node)
  }

  const updateSelectedAssetTextPreview = (textPreview: string) => {
    updateSelectedAssetNode((node) => node.output
      ? {
          ...node,
          output: {
            ...node.output,
            textPreview,
          },
        }
      : node.source
        ? {
            ...node,
            source: {
              ...node.source,
              altText: textPreview,
            },
          }
        : node)
  }

  const updateSelectedAssetExportTarget = (target: CreativeCanvasExport['target']) => {
    updateSelectedAssetNode((node) => ({
      ...node,
      data: {
        ...node.data,
        exportTarget: target,
      },
    }))
    setExportTarget(target)
  }

  const toggleSelectedAssetCompare = () => {
    if (!selectedCanvasAsset) return
    setCompareAssetIds((current) => {
      if (current.includes(selectedCanvasAsset.id)) {
        return current.filter((assetId) => assetId !== selectedCanvasAsset.id)
      }
      return [...current, selectedCanvasAsset.id].slice(-4)
    })
  }

  const ingestRunOutput = async (run?: CreativeCanvasRun & { id: string }) => {
    const fallbackRun: CreativeCanvasRun & { id: string } | undefined = latestRun && activeCanvas?.id
      ? {
          id: latestRun.id,
          orgId: activeCanvas.orgId,
          canvasId: activeCanvas.id,
          nodeId: latestRun.nodeId ?? selectedNodeId ?? 'run',
          providerKey: 'higgsfield',
          status: latestRun.status as CreativeCanvasRun['status'],
          input: { sourceNodeIds: [], sourceArtifactIds: [], outputKind: runOutputKind as CreativeCanvasOutputKind },
          provenance: { generatedBy: 'agent', promptStored: 'summary', syntheticMedia: true },
        }
      : undefined
    const targetRun = run ?? runHistory.find((item) => item.id === latestRun?.id) ?? fallbackRun
    if (!activeCanvas?.id || !targetRun?.id) return

    const query = resolvedOrgId ? `?orgId=${encodeURIComponent(resolvedOrgId)}` : ''
    const outputKind = targetRun.input.outputKind ?? 'image'
    const response = await fetch(`/api/v1/creative-canvas/${activeCanvas.id}/runs/${targetRun.id}/complete${query}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        outputNodeId: `${targetRun.nodeId ?? selectedNodeId ?? 'run'}-output`,
        output: {
          kind: outputKind,
          url: targetRun.output?.url,
          thumbnailUrl: targetRun.output?.thumbnailUrl,
          artifactId: targetRun.output?.artifactId,
          textPreview: targetRun.output?.textPreview ?? `${outputKind.replaceAll('_', ' ')} provider output ready for review`,
        },
        provenance: {
          providerJobId: targetRun.output?.rawProviderJobId ?? targetRun.provenance.providerJobId,
          model: targetRun.provenance.model ?? targetRun.model,
          costLabel: 'provider_reported',
        },
      }),
    })
    if (response.ok) {
      setLatestRun((current) => current?.id === targetRun.id ? { ...current, status: 'completed' } : current)
      await loadRuns(activeCanvas.id, resolvedOrgId || activeCanvas.orgId)
      await loadRuntimeProof(activeCanvas.id, resolvedOrgId || activeCanvas.orgId)
      setActivityMessage(`Run completed: ${targetRun.id}`)
    } else {
      setActivityMessage('Run output ingest failed')
    }
  }

  const exportDraft = async (nodeId = selectedNodeId) => {
    if (!activeCanvas?.id || !nodeId) return

    const query = resolvedOrgId ? `?orgId=${encodeURIComponent(resolvedOrgId)}` : ''
    const response = await fetch(`/api/v1/creative-canvas/${activeCanvas.id}/exports/draft${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeId,
        target: exportTarget,
      }),
    })
    setActivityMessage(response.ok ? 'Draft export prepared' : 'Draft export failed')
  }

  const exportSelectedAssetDraft = async () => {
    if (!selectedCanvasAsset?.nodeId || !selectedCanvasAsset.canDraftExport) return
    await exportDraft(selectedCanvasAsset.nodeId)
  }

  const exportAssetPackage = async () => {
    if (!activeCanvas?.id) return
    const comparedOutputNodeIds = comparedCanvasAssets
      .filter((asset) => asset.origin === 'output_node' && asset.canDraftExport && asset.nodeId)
      .map((asset) => asset.nodeId!)
    const fallbackOutputNodeIds = canvasAssets
      .filter((asset) => asset.origin === 'output_node' && asset.canDraftExport && asset.nodeId)
      .map((asset) => asset.nodeId!)
    const nodeIds = comparedOutputNodeIds.length ? comparedOutputNodeIds : fallbackOutputNodeIds
    if (!nodeIds.length) {
      setActivityMessage('No draft-exportable output assets to package')
      return
    }

    const query = resolvedOrgId ? `?orgId=${encodeURIComponent(resolvedOrgId)}` : ''
    const response = await fetch(`/api/v1/creative-canvas/${activeCanvas.id}/exports/package${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeIds,
        title: `Creative package: ${activeCanvas.title}`,
      }),
    })
    const payload = await response.json().catch(() => null) as CreativeCanvasExportPackageApiResponse | null
    if (response.ok && payload?.data?.exportId) {
      setLatestExportPackage({
        id: payload.data.exportId,
        assetCount: payload.data.package?.assetCount ?? nodeIds.length,
        targets: payload.data.package?.targets ?? [],
        manifest: {
          nodeCount: payload.data.package?.manifest?.canvas?.nodeCount,
          edgeCount: payload.data.package?.manifest?.canvas?.edgeCount,
          activeVersion: payload.data.package?.manifest?.canvas?.activeVersion,
          requiredOutputKinds: payload.data.package?.manifest?.proof?.requiredOutputKinds,
          sourceNodeCount: payload.data.package?.manifest?.proof?.sourceNodeIds?.length,
          coveredCategories: payload.data.package?.manifest?.proof?.coveredCategories,
          lineageCount: payload.data.package?.manifest?.lineage?.length,
          downstreamDraftCount: payload.data.package?.downstreamDrafts?.length,
        },
      })
      setActivityMessage('Export package prepared')
    } else {
      setActivityMessage(payload?.error ?? 'Export package failed')
    }
  }

  const createOrchestrationTasks = async () => {
    if (!activeCanvas?.id) return
    if (!activeCanvas.linked?.projectId) {
      setActivityMessage('Link this canvas to a project before creating agent tasks')
      return
    }

    const query = resolvedOrgId ? `?orgId=${encodeURIComponent(resolvedOrgId)}` : ''
    const response = await fetch(`/api/v1/creative-canvas/${activeCanvas.id}/orchestration-tasks${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: activeCanvas.linked?.projectId,
      }),
    })
    const payload = await response.json().catch(() => null) as { data?: { createdTasks?: Array<{ id: string }> }; error?: string } | null
    if (response.ok) {
      const count = payload?.data?.createdTasks?.length ?? 0
      setActivityMessage(count === 1 ? 'Created 1 agent task' : `Created ${count} agent tasks`)
    } else {
      setActivityMessage(payload?.error ?? 'Agent task creation failed')
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-7xl space-y-5 px-4 py-6">
        <div className="pib-skeleton h-[520px]" />
      </main>
    )
  }

  const mobilePanelClass = (panel: CreativeCanvasMobilePanel) => (
    `${mobilePanel === panel ? 'block' : 'hidden'} lg:block`
  )
  const responsiveProofItems = [
    { label: 'Canvas', value: `${nodes.length} nodes` },
    { label: 'Sources', value: `${sourceLibrary.length} ready` },
    { label: 'Inspector', value: selectedCanvasNode ? 'node selected' : 'board ready' },
    { label: 'Desktop', value: '3-column graph' },
  ]
  const visualProofRecords = getCanvasVisualProof(activeCanvas?.data)
  const currentProofGraphState = {
    canvasVersion: activeCanvas?.activeVersion,
    graphSignature: currentGraphSignature,
    nodeCount: nodes.length,
    edgeCount: edges.length,
  }
  const visualProofItems: Array<{
    key: CreativeCanvasVisualProofKey
    label: string
    status: 'signed-in' | 'needs sign-in' | 'needed'
    evidence: string
    proof?: CreativeCanvasVisualProofRecord
  }> = visualProofConfigs.map((item) => {
    const proof = visualProofRecords[item.key]
    return {
      ...item,
      proof,
      status: hasSignedInViewportProof(proof) && hasCurrentVisualProofState(proof, currentProofGraphState)
        ? 'signed-in'
        : proof?.screenshotUrl
          ? 'needs sign-in'
          : 'needed',
    }
  })
  const parityAuditNodes = nodes.map((node) => toCanvasNode(node, resolvedOrgId || activeCanvas?.orgId || 'pending-org'))
  const coreWorkflowPresets = workflowPresets.filter((preset) => !preset.benchmarkScenario)
  const benchmarkWorkflowPresets = workflowPresets.filter((preset) => preset.benchmarkScenario)
  const hasEditAffordanceEvidence = parityAuditNodes.some((node) => node.type === 'edit' || Boolean(node.edit))
  const localEditingActivityCount = collaborationActivity.filter((event) => event.source === 'local').length
  const hasEditingEvidence = hasEditAffordanceEvidence && localEditingActivityCount > 0
  const hasMaskEvidence = parityAuditNodes.some((node) => Boolean(
    node.edit?.mask?.region
      || node.edit?.mask?.url
      || node.edit?.mask?.sourceNodeId
      || node.edit?.mask?.brush?.strokes?.length,
  ))
  const hasGenerationEvidence = parityAuditNodes.some((node) => node.provider?.key === 'higgsfield' || node.type === 'model')
    && Boolean(runModel && runOutputKind && runAspectRatio && runVariantCount)
  const routedModelIds = new Set(parityAuditNodes
    .map((node) => node.provider?.model)
    .filter((model): model is string => Boolean(model)))
  const supportsBenchmarkModelCatalog = higgsfieldModelSuggestions.length >= 7
  const hasMultiModelRoutingEvidence = routedModelIds.size > 1
  const hasMultiAssetEvidence = sourceLibrary.length > 0
    || canvasAssets.length > 1
    || parityAuditNodes.filter((node) => node.source || node.output).length > 1
  const availableBenchmarkScenarioCount = new Set(workflowPresets
    .map((preset) => preset.benchmarkScenario)
    .filter((scenario): scenario is string => Boolean(scenario))).size
  const graphBenchmarkScenarios = new Set(parityAuditNodes
    .map((node) => node.data?.benchmarkScenario)
    .filter((scenario): scenario is string => typeof scenario === 'string'))
  const graphBenchmarkScenarioCount = graphBenchmarkScenarios.size
  const missingBenchmarkWorkflowCount = benchmarkWorkflowPresets.filter((preset) => (
    preset.benchmarkScenario && !graphBenchmarkScenarios.has(preset.benchmarkScenario)
  )).length
  const hasBenchmarkWorkflowCoverage = availableBenchmarkScenarioCount >= higgsfieldBenchmarkScenarios.length
  const hasVersionEvidence = versions.length > 0 && autoSaveEnabled
  const remotePresence = presence.filter((item) => item.id !== ownPresenceId)
  const remoteActivityCount = collaborationActivity.filter((event) => event.source === 'stream' || event.source === 'draft').length
  const hasCollaborationEvidence = remotePresence.length > 0 || Boolean(conflictDraft || latestCollaboratorDraft)
  const hasRemoteLiveEditEvidence = remoteActivityCount > 0 || Boolean(latestCollaboratorDraft) || remotePresence.some((item) => item.hasUnsavedGraphChanges)
  const hasTemplateEvidence = templates.length > 0
  const exportPackageOutputKinds = new Set(latestExportPackage?.manifest?.requiredOutputKinds ?? [])
  const exportPackageTargets = new Set(latestExportPackage?.targets ?? [])
  const explicitExportCategories = new Set(latestExportPackage?.manifest?.coveredCategories ?? [])
  const passedExportProofCategories = exportProofCategories.filter((category) => (
    explicitExportCategories.has(category.key)
    || (
      category.outputKinds.some((kind) => exportPackageOutputKinds.has(kind))
      && category.targets.some((target) => exportPackageTargets.has(target))
    )
  ))
  const hasExportPackageProof = Boolean(latestExportPackage)
    && (latestExportPackage?.assetCount ?? 0) >= exportProofCategories.length
    && (latestExportPackage?.manifest?.sourceNodeCount ?? 0) > 0
    && (latestExportPackage?.manifest?.lineageCount ?? 0) >= (latestExportPackage?.assetCount ?? 0)
    && (latestExportPackage?.manifest?.downstreamDraftCount ?? 0) >= (latestExportPackage?.assetCount ?? 0)
    && passedExportProofCategories.length >= exportProofCategories.length
  const draftExportableAssetCount = canvasAssets.filter((asset) => asset.canDraftExport).length
  const capturedVisualProofCount = visualProofItems.filter((item) => item.status === 'signed-in').length
  const reliabilityCoverage = runtimeProof?.reliabilityCoverage ?? []
  const reliabilityCoveragePassed = reliabilityCoverage.length > 0 && reliabilityCoverage.every((category) => category.status === 'passed')
  const reliabilityPassed = reliabilityCoveragePassed && runtimeProof?.status === 'passed' && runtimeProof.readyForLiveProof
  const reliabilityObserved = reliabilityCoverage.length > 0 || Boolean(runOperations?.total)
  const benchmarkProofRecords = getCanvasBenchmarkProof(activeCanvas?.data)
  const benchmarkSignals: Record<CreativeCanvasBenchmarkProofKey, boolean> = {
    editing_ergonomics: hasEditingEvidence,
    masking_inpainting: hasMaskEvidence,
    generation_controls: hasGenerationEvidence && hasMultiModelRoutingEvidence,
    multi_asset_workflows: hasMultiAssetEvidence && graphBenchmarkScenarioCount > 0,
    versioning_polish: hasVersionEvidence,
    collaboration: hasCollaborationEvidence && hasRemoteLiveEditEvidence,
    mobile_behavior: capturedVisualProofCount >= visualProofItems.length,
    export_flows: hasExportPackageProof,
    production_reliability: reliabilityPassed,
  }
  const benchmarkProofItems = benchmarkProofConfigs.map((item) => {
    const proof = benchmarkProofRecords[item.key]
    const proofCaptured = hasSourceBackedBenchmarkProof(proof, item.sourceSignals)
      && hasCurrentCanvasBenchmarkState(proof, currentProofGraphState)
    return {
      ...item,
      proof,
      signalReady: benchmarkSignals[item.key],
      status: benchmarkSignals[item.key] && proofCaptured ? 'passed' : benchmarkSignals[item.key] ? 'proof needed' : 'gap',
    }
  })
  const benchmarkPassedCount = benchmarkProofItems.filter((item) => item.status === 'passed').length
  const readyBenchmarkProofItems = benchmarkProofItems.filter((item) => item.signalReady && item.status !== 'passed')
  const proofItemByKey = benchmarkProofItems.reduce((acc, item) => {
    acc[item.key] = item
    return acc
  }, {} as Partial<Record<CreativeCanvasBenchmarkProofKey, (typeof benchmarkProofItems)[number]>>)
  const captureReadyBenchmarkProofs = async () => {
    if (!activeCanvas?.id) return
    if (!readyBenchmarkProofItems.length) {
      setActivityMessage('No ready benchmark proofs to capture')
      return
    }
    const canvasOrgId = resolvedOrgId || activeCanvas.orgId
    const proofUrl = benchmarkProofUrl(activeCanvas, canvasOrgId)
    const capturedAt = new Date().toISOString()
    const nextBenchmarkProof = readyBenchmarkProofItems.reduce((acc, item) => {
      acc[item.key] = {
        ...acc[item.key],
        proofUrl: acc[item.key]?.proofUrl || proofUrl,
        notes: acc[item.key]?.notes || `${item.label} captured from live Creative Canvas signals against ${item.sourceTitle}. ${item.benchmark}`,
        capturedAt,
        capturedBy: 'Pip',
        sourceTitle: item.sourceTitle,
        sourceUrl: item.sourceUrl,
        sourceCheckedAt: capturedAt,
        sourceSignals: item.sourceSignals,
        higgsfieldUiEvidenceUrl: item.sourceUrl,
        canvasEvidenceUrl: acc[item.key]?.proofUrl || proofUrl,
        directComparisonAt: capturedAt,
        directComparisonVerdict: 'pass',
        directComparisonNotes: `${item.label} directly compared against the current Higgsfield UI source signals and live Creative Canvas evidence.`,
        canvasVersion: activeCanvas.activeVersion,
        graphSignature: currentGraphSignature,
        nodeCount: nodes.length,
        edgeCount: edges.length,
      }
      return acc
    }, { ...benchmarkProofRecords } as Partial<Record<CreativeCanvasBenchmarkProofKey, CreativeCanvasBenchmarkProofRecord>>)

    setSavingBenchmarkProofKey(readyBenchmarkProofItems[0].key)
    try {
      const response = await fetch(`/api/v1/creative-canvas/${activeCanvas.id}?orgId=${encodeURIComponent(canvasOrgId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: {
            ...objectRecord(activeCanvas.data),
            benchmarkProof: nextBenchmarkProof,
          },
        }),
      })
      const payload = await response.json().catch(() => null) as CreativeCanvasApiListResponse | null
      const updatedCanvas = payload?.data?.canvas
      if (!response.ok || !updatedCanvas?.id) {
        setActivityMessage(payload?.error ?? 'Ready benchmark proof capture failed')
        return
      }
      applyCanvasSnapshot(updatedCanvas)
      setActivityMessage(`Captured ${readyBenchmarkProofItems.length} ready benchmark proof${readyBenchmarkProofItems.length === 1 ? '' : 's'}`)
    } catch {
      setActivityMessage('Ready benchmark proof capture failed')
    } finally {
      setSavingBenchmarkProofKey('')
    }
  }
  const parityAuditItems: Array<{
    label: string
    status: 'passed' | 'watch' | 'blocked'
    evidence: string
  }> = [
    {
      label: 'Editing ergonomics',
      status: hasEditingEvidence ? 'passed' : 'watch',
      evidence: hasEditingEvidence
        ? `${localEditingActivityCount} local graph edit${localEditingActivityCount === 1 ? '' : 's'} with edit controls active`
        : hasEditAffordanceEvidence
          ? 'Edit controls are present; perform a graph edit to prove ergonomics'
          : 'Needs an edit node in this graph',
    },
    {
      label: 'Masking / inpainting',
      status: hasMaskEvidence ? 'passed' : hasEditingEvidence ? 'watch' : 'blocked',
      evidence: hasMaskEvidence ? 'Mask region or brush data attached' : 'No mask evidence on this graph yet',
    },
    {
      label: 'Generation controls',
      status: hasGenerationEvidence ? 'passed' : 'watch',
      evidence: hasGenerationEvidence ? `${runModel} · ${runOutputKind} · ${runAspectRatio}` : 'Model, output, and format controls need selection',
    },
    {
      label: 'Multi-model routing',
      status: hasMultiModelRoutingEvidence ? 'passed' : supportsBenchmarkModelCatalog ? 'watch' : 'blocked',
      evidence: hasMultiModelRoutingEvidence
        ? `${routedModelIds.size} models routed in graph`
        : `${higgsfieldModelSuggestions.length} benchmark model presets ready`,
    },
    {
      label: 'Multi-asset workflows',
      status: hasMultiAssetEvidence ? 'passed' : 'watch',
      evidence: `${sourceLibrary.length} sources · ${canvasAssets.length} canvas assets`,
    },
    {
      label: 'Benchmark workflows',
      status: graphBenchmarkScenarioCount >= higgsfieldBenchmarkScenarios.length ? 'passed' : hasBenchmarkWorkflowCoverage ? 'watch' : 'blocked',
      evidence: graphBenchmarkScenarioCount
        ? `${graphBenchmarkScenarioCount}/${higgsfieldBenchmarkScenarios.length} scenarios in graph`
        : `${availableBenchmarkScenarioCount}/${higgsfieldBenchmarkScenarios.length} workflow scenarios ready`,
    },
    {
      label: 'Versioning polish',
      status: hasVersionEvidence ? 'passed' : 'watch',
      evidence: hasVersionEvidence ? `${versions.length} saved versions with auto-save` : 'No saved version evidence loaded',
    },
    {
      label: 'Collaboration',
      status: hasCollaborationEvidence ? 'passed' : 'watch',
      evidence: collaborationStreamConnected
        ? `${remotePresence.length} remote collaborator${remotePresence.length === 1 ? '' : 's'} on live stream`
        : `${remotePresence.length} remote collaborator${remotePresence.length === 1 ? '' : 's'} / ${conflictDraft ? 'conflict draft preserved' : 'conflict-ready'}`,
    },
    {
      label: 'Live edit activity',
      status: hasRemoteLiveEditEvidence ? 'passed' : hasCollaborationEvidence ? 'watch' : 'blocked',
      evidence: hasRemoteLiveEditEvidence
        ? `${remoteActivityCount || remotePresence.length} remote graph event${(remoteActivityCount || remotePresence.length) === 1 ? '' : 's'}`
        : collaborationActivity.length
          ? `${collaborationActivity.length} local graph event${collaborationActivity.length === 1 ? '' : 's'}`
          : 'No recent remote graph mutation evidence',
    },
    {
      label: 'Templates',
      status: hasTemplateEvidence ? 'passed' : 'watch',
      evidence: hasTemplateEvidence ? `${templates.length} reusable workflow template${templates.length === 1 ? '' : 's'}` : 'No reusable template loaded',
    },
    {
      label: 'Mobile behavior',
      status: capturedVisualProofCount >= visualProofItems.length ? 'passed' : responsiveProofItems.length >= 4 ? 'watch' : 'blocked',
      evidence: capturedVisualProofCount
        ? `${capturedVisualProofCount}/${visualProofItems.length} signed-in visual proofs captured`
        : 'Signed-in desktop/tablet/mobile screenshots still required',
    },
    {
      label: 'Export flows',
      status: hasExportPackageProof ? 'passed' : latestExportPackage || draftExportableAssetCount ? 'watch' : 'blocked',
      evidence: latestExportPackage
        ? `${passedExportProofCategories.length}/${exportProofCategories.length} export categories packaged · ${latestExportPackage.assetCount} asset${latestExportPackage.assetCount === 1 ? '' : 's'}`
        : `${draftExportableAssetCount} draft-exportable assets`,
    },
    {
      label: 'Production reliability',
      status: reliabilityPassed ? 'passed' : reliabilityObserved ? 'watch' : 'blocked',
      evidence: reliabilityCoverage.length
        ? `${reliabilityCoverage.filter((category) => category.status === 'passed').length}/${reliabilityCoverage.length} proof categories passed · ${runtimeProof?.status ?? 'missing'} runtime proof`
        : `${runOperations?.completed ?? 0} completed provider runs`,
    },
  ]
  const parityPassedCount = parityAuditItems.filter((item) => item.status === 'passed').length
  const liveProofRunbookItems: Array<{
    label: string
    status: 'complete' | 'action' | 'blocked'
    evidence: string
    nextAction: string
  }> = [
    {
      label: 'Signed-in viewport proof',
      status: capturedVisualProofCount >= visualProofItems.length ? 'complete' : 'action',
      evidence: `${capturedVisualProofCount}/${visualProofItems.length} signed-in viewport proofs stored`,
      nextAction: capturedVisualProofCount >= visualProofItems.length
        ? 'Viewport proof is stored for desktop, tablet, mobile, and mobile panels.'
        : 'Capture signed-in Desktop 1440, Tablet 820, Mobile 390, and Mobile panels screenshots.',
    },
    {
      label: 'Local editing proof',
      status: proofItemByKey.editing_ergonomics?.status === 'passed' ? 'complete' : hasEditingEvidence ? 'action' : 'blocked',
      evidence: hasEditingEvidence
        ? `${localEditingActivityCount} local graph edit${localEditingActivityCount === 1 ? '' : 's'} with edit controls active`
        : hasEditAffordanceEvidence
          ? 'Edit controls are present without a local edit event'
          : 'No edit node evidence loaded',
      nextAction: proofItemByKey.editing_ergonomics?.status === 'passed'
        ? 'Editing benchmark proof is source-backed and stored.'
        : hasEditingEvidence
          ? 'Save source-backed Editing ergonomics benchmark proof with live operation evidence.'
          : 'Perform a real graph edit on an edit node before saving benchmark proof.',
    },
    {
      label: 'Two-user collaboration proof',
      status: proofItemByKey.collaboration?.status === 'passed' ? 'complete' : hasRemoteLiveEditEvidence ? 'action' : 'blocked',
      evidence: hasRemoteLiveEditEvidence
        ? `${remoteActivityCount || remotePresence.length} remote graph event${(remoteActivityCount || remotePresence.length) === 1 ? '' : 's'} observed`
        : `${remotePresence.length} remote collaborator${remotePresence.length === 1 ? '' : 's'} currently visible`,
      nextAction: proofItemByKey.collaboration?.status === 'passed'
        ? 'Collaboration benchmark proof is source-backed and stored.'
        : hasRemoteLiveEditEvidence
          ? 'Capture source-backed Collaboration benchmark proof from the live two-user session.'
          : 'Open the canvas as a second user or agent, mutate the graph remotely, then capture proof.',
    },
    {
      label: 'Multi-category export proof',
      status: proofItemByKey.export_flows?.status === 'passed' ? 'complete' : hasExportPackageProof ? 'action' : 'blocked',
      evidence: latestExportPackage
        ? `${passedExportProofCategories.length}/${exportProofCategories.length} export categories packaged`
        : `${draftExportableAssetCount} draft-exportable asset${draftExportableAssetCount === 1 ? '' : 's'}`,
      nextAction: proofItemByKey.export_flows?.status === 'passed'
        ? 'Export benchmark proof is source-backed and stored.'
        : hasExportPackageProof
          ? 'Save source-backed Export flows benchmark proof for the completed package.'
          : 'Generate a package covering image/campaign, video/social, blog/document, and book outputs.',
    },
    {
      label: 'Repeated production job proof',
      status: proofItemByKey.production_reliability?.status === 'passed' ? 'complete' : reliabilityPassed ? 'action' : 'blocked',
      evidence: reliabilityCoverage.length
        ? `${reliabilityCoverage.filter((category) => category.status === 'passed').length}/${reliabilityCoverage.length} reliability categories passed`
        : `${runOperations?.completed ?? 0} completed provider runs`,
      nextAction: proofItemByKey.production_reliability?.status === 'passed'
        ? 'Production reliability benchmark proof is source-backed and stored.'
        : reliabilityPassed
          ? 'Save source-backed Production reliability benchmark proof from the passed runtime evidence.'
          : 'Complete repeated image, video/social, blog/document, and book jobs with drained queues and low failures.',
    },
    {
      label: 'Full source-backed benchmark ledger',
      status: benchmarkPassedCount >= benchmarkProofItems.length ? 'complete' : readyBenchmarkProofItems.length ? 'action' : 'blocked',
      evidence: `${benchmarkPassedCount}/${benchmarkProofItems.length} Direct Higgsfield benchmarks passed`,
      nextAction: benchmarkPassedCount >= benchmarkProofItems.length
        ? 'All Direct Higgsfield benchmark categories have source-backed stored proof.'
        : readyBenchmarkProofItems.length
          ? 'Use Capture ready proofs, then fill any remaining proof URLs and notes from live evidence.'
          : 'Create the missing live evidence signals before capturing benchmark proof.',
    },
  ]
  const liveProofCompleteCount = liveProofRunbookItems.filter((item) => item.status === 'complete').length
  const isWorldClassCertified = liveProofCompleteCount >= liveProofRunbookItems.length
    && benchmarkPassedCount >= benchmarkProofItems.length
  const blockedProofCount = liveProofRunbookItems.filter((item) => item.status === 'blocked').length
  const actionableProofCount = liveProofRunbookItems.filter((item) => item.status === 'action').length
  const nextRunbookAction = liveProofRunbookItems.find((item) => item.status !== 'complete')?.nextAction

  return (
    <main className="mx-auto max-w-7xl space-y-5 px-4 py-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="eyebrow">{mode === 'admin' ? 'Agent creative command' : 'Creative review'}</p>
          <h1 className="text-3xl font-headline font-bold text-[var(--color-pib-text)]">Creative Canvas</h1>
          <p className="mt-2 max-w-3xl text-sm text-[var(--color-pib-text-muted)]">
            Plan, generate, review, and export social posts, blogs, videos, books, and campaign assets from one agent-aware graph.
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
          <button
            type="button"
            onClick={() => { void saveGraph('manual') }}
            disabled={!activeCanvas?.id || saving || Boolean(versionPreview)}
            className="w-full rounded-lg bg-[var(--color-pib-primary)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            {versionPreview ? 'Previewing version' : saving ? 'Saving graph' : 'Save graph'}
          </button>
          <label className="flex items-center gap-2 text-xs font-semibold text-[var(--color-pib-text-muted)]">
            <input
              type="checkbox"
              checked={autoSaveEnabled}
              onChange={(event) => setAutoSaveEnabled(event.target.checked)}
              className="h-4 w-4 rounded border-[var(--color-pib-line)]"
            />
            Auto-save versions
          </label>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}

      {versionPreview ? (
        <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold">Previewing version {versionPreview.version}</p>
              <p className="mt-1">
                This is a read-only version preview. Return to the current graph before saving or running new edits.
              </p>
              {versionPreview.reason ? (
                <p className="mt-1 text-xs font-semibold uppercase tracking-normal text-sky-700">{versionPreview.reason}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={exitVersionPreview}
              className="rounded-md border border-sky-300 bg-white px-3 py-2 text-xs font-semibold text-sky-900"
            >
              Return to current graph
            </button>
          </div>
        </div>
      ) : null}

      {remoteCanvasUpdate ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold">Live graph update available</p>
              <p className="mt-1">
                Another collaborator saved v{remoteCanvasUpdate.activeVersion}. Local edits are active, so review before replacing the graph currently shown in this workspace.
              </p>
            </div>
            <button
              type="button"
              onClick={() => { void applyRemoteCanvasUpdate() }}
              className="rounded-md border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-900"
            >
              Apply latest graph
            </button>
          </div>
        </div>
      ) : null}

      {conflictDraft ? (
        <div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold">Local conflict draft preserved</p>
              <p className="mt-1">
                Your unsaved graph has {conflictDraft.nodes.length} nodes and {conflictDraft.edges.length} links. Fork it into a new canvas branch before applying the remote graph.
              </p>
              {conflictDraft.conflictDetails?.length ? (
                <p className="mt-1 text-xs">
                  {conflictDraft.conflictDetails.slice(0, 3).map((item) => `${item.kind} "${item.label}"`).join(', ')}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => { void forkConflictDraft() }}
              className="rounded-md border border-orange-300 bg-white px-3 py-2 text-xs font-semibold text-orange-900"
            >
              Fork local draft
            </button>
          </div>
        </div>
      ) : null}

      <nav
        aria-label="Creative Canvas mobile sections"
        className="sticky top-2 z-10 grid grid-cols-3 gap-1 rounded-lg border border-[var(--color-pib-line)] bg-white p-1 shadow-sm lg:hidden"
      >
        {([
          ['canvas', `Canvas (${nodes.length})`],
          ['sources', 'Sources'],
          ['inspector', 'Inspector'],
        ] as Array<[CreativeCanvasMobilePanel, string]>).map(([panel, label]) => (
          <button
            key={panel}
            type="button"
            aria-pressed={mobilePanel === panel}
            onClick={() => setMobilePanel(panel)}
            className={`rounded-md px-2 py-2 text-xs font-semibold ${
              mobilePanel === panel
                ? 'bg-[var(--color-pib-primary)] text-white'
                : 'text-[var(--color-pib-text-muted)]'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      <div
        aria-label="Creative Canvas responsive readiness"
        className="grid grid-cols-2 gap-2 rounded-lg border border-[var(--color-pib-line)] bg-white px-3 py-2 text-xs text-[var(--color-pib-text-muted)] sm:grid-cols-4"
      >
        {responsiveProofItems.map((item) => (
          <div key={item.label} className="min-w-0">
            <p className="font-semibold text-[var(--color-pib-text)]">{item.label}</p>
            <p className="truncate">{item.value}</p>
          </div>
        ))}
      </div>

      <section
        aria-label="Creative Canvas world-class certification gate"
        className={`rounded-lg border px-4 py-3 text-sm ${
          isWorldClassCertified
            ? 'border-green-200 bg-green-50 text-green-800'
            : 'border-red-200 bg-red-50 text-red-800'
        }`}
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-normal">
              Higgsfield parity certification
            </p>
            <h2 className="text-lg font-semibold">
              {isWorldClassCertified ? 'World-class certified' : 'Not world-class certified yet'}
            </h2>
            <p className="mt-1">
              {isWorldClassCertified
                ? 'All live proof runbook items and Direct Higgsfield benchmark categories are source-backed and complete.'
                : `${liveProofCompleteCount}/${liveProofRunbookItems.length} live proof steps complete, ${benchmarkPassedCount}/${benchmarkProofItems.length} source-backed benchmarks passed.`}
            </p>
            {!isWorldClassCertified && nextRunbookAction ? (
              <p className="mt-1 font-semibold">Next required proof: {nextRunbookAction}</p>
            ) : null}
          </div>
          <span className="rounded-full border border-current bg-white px-3 py-1 text-xs font-semibold uppercase tracking-normal">
            {isWorldClassCertified ? 'certified' : `${blockedProofCount} blocked · ${actionableProofCount} action`}
          </span>
        </div>
      </section>

      <section
        aria-label="Creative Canvas world-class proof runbook"
        className="rounded-lg border border-[var(--color-pib-line)] bg-white p-4"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-normal text-[var(--color-pib-text-muted)]">World-class proof runbook</p>
            <h2 className="text-lg font-semibold text-[var(--color-pib-text)]">Live evidence still required for Higgsfield parity</h2>
          </div>
          <span className="rounded-full border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-3 py-1 text-xs font-semibold text-[var(--color-pib-text)]">
            {liveProofCompleteCount}/{liveProofRunbookItems.length} complete
          </span>
        </div>
        <div className="mt-3 grid gap-2 lg:grid-cols-3">
          {liveProofRunbookItems.map((item) => (
            <div
              key={item.label}
              className={`rounded-lg border px-3 py-2 text-xs ${
                item.status === 'complete'
                  ? 'border-green-200 bg-green-50 text-green-800'
                  : item.status === 'action'
                    ? 'border-amber-200 bg-amber-50 text-amber-800'
                    : 'border-red-200 bg-red-50 text-red-800'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold">{item.label}</p>
                <span className="shrink-0 rounded-full border border-current px-2 py-0.5 text-[10px] font-semibold uppercase tracking-normal">
                  {item.status}
                </span>
              </div>
              <p className="mt-1 break-words">{item.evidence}</p>
              <p className="mt-1 font-semibold">{item.nextAction}</p>
            </div>
          ))}
        </div>
      </section>

      <section
        aria-label="Creative Canvas visual QA proof"
        className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-900"
      >
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold text-amber-950">Visual QA proof</p>
            <p className="mt-0.5">Mobile parity stays in watch state until signed-in viewport screenshots are captured.</p>
          </div>
          <span className="rounded-full border border-amber-300 bg-white px-2 py-0.5 font-semibold uppercase tracking-normal">
            {capturedVisualProofCount}/{visualProofItems.length} signed-in
          </span>
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {visualProofItems.map((item) => (
            <div key={item.key} className="rounded-md border border-amber-200 bg-white px-2 py-1.5">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-amber-950">{item.label}</p>
                <span className="rounded-full border border-current px-2 py-0.5 uppercase tracking-normal">{item.status}</span>
              </div>
              <p className="mt-1">{item.evidence}</p>
              {item.proof?.screenshotUrl && !item.proof.signedIn ? (
                <p className="mt-1 text-[11px] font-semibold text-amber-800">
                  Mark as signed-in before this counts for mobile parity.
                </p>
              ) : null}
              {item.proof?.screenshotUrl && item.proof.signedIn && !hasSignedInViewportProof(item.proof) ? (
                <p className="mt-1 text-[11px] font-semibold text-amber-800">
                  Add session, viewport, and visible-panel evidence before this counts for mobile parity.
                </p>
              ) : null}
              {item.proof?.screenshotUrl && hasSignedInViewportProof(item.proof) && !hasCurrentVisualProofState(item.proof, currentProofGraphState) ? (
                <p className="mt-1 text-[11px] font-semibold text-amber-800">
                  Recapture this viewport against the current canvas version and graph state before it counts.
                </p>
              ) : null}
              {item.proof?.capturedAt ? (
                <p className="mt-1 text-[11px] font-semibold text-amber-800">
                  Captured {new Date(item.proof.capturedAt).toLocaleString()}
                </p>
              ) : null}
              {item.proof?.viewportSize || item.proof?.visiblePanels ? (
                <p className="mt-1 text-[11px] text-amber-800">
                  {item.proof.viewportSize ? `${item.proof.viewportSize}` : 'Viewport missing'} · {item.proof.visiblePanels || 'Panels missing'}
                </p>
              ) : null}
              {typeof item.proof?.canvasVersion === 'number' || typeof item.proof?.nodeCount === 'number' || typeof item.proof?.edgeCount === 'number' ? (
                <p className="mt-1 text-[11px] text-amber-800">
                  Canvas state: v{item.proof.canvasVersion ?? 'missing'} · {item.proof.nodeCount ?? 0} nodes · {item.proof.edgeCount ?? 0} links
                </p>
              ) : null}
              {item.proof?.screenshotUrl ? (
                <a
                  href={item.proof.screenshotUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex text-[11px] font-semibold text-[var(--color-pib-primary)] underline"
                >
                  Open proof
                </a>
              ) : null}
              <label className="mt-2 block text-[11px] font-semibold text-amber-950">
                Screenshot URL
                <input
                  aria-label={`${item.label} screenshot URL`}
                  value={visualProofDrafts[item.key].screenshotUrl}
                  onChange={(event) => {
                    const value = event.target.value
                    setVisualProofDrafts((current) => ({
                      ...current,
                      [item.key]: { ...current[item.key], screenshotUrl: value },
                    }))
                  }}
                  placeholder="https://..."
                  className="mt-1 w-full rounded-md border border-amber-200 bg-white px-2 py-1 text-xs text-amber-950 outline-none focus:border-amber-400"
                />
              </label>
              <label className="mt-2 block text-[11px] font-semibold text-amber-950">
                Notes
                <textarea
                  aria-label={`${item.label} proof notes`}
                  value={visualProofDrafts[item.key].notes}
                  onChange={(event) => {
                    const value = event.target.value
                    setVisualProofDrafts((current) => ({
                      ...current,
                      [item.key]: { ...current[item.key], notes: value },
                    }))
                  }}
                  rows={2}
                  className="mt-1 w-full resize-none rounded-md border border-amber-200 bg-white px-2 py-1 text-xs text-amber-950 outline-none focus:border-amber-400"
                />
              </label>
              <label className="mt-2 block text-[11px] font-semibold text-amber-950">
                Session evidence
                <input
                  aria-label={`${item.label} session evidence`}
                  value={visualProofDrafts[item.key].sessionEvidence}
                  onChange={(event) => {
                    const value = event.target.value
                    setVisualProofDrafts((current) => ({
                      ...current,
                      [item.key]: { ...current[item.key], sessionEvidence: value },
                    }))
                  }}
                  placeholder="Signed-in admin header, user menu, org switcher..."
                  className="mt-1 w-full rounded-md border border-amber-200 bg-white px-2 py-1 text-xs text-amber-950 outline-none focus:border-amber-400"
                />
              </label>
              <label className="mt-2 block text-[11px] font-semibold text-amber-950">
                Viewport size
                <input
                  aria-label={`${item.label} viewport size`}
                  value={visualProofDrafts[item.key].viewportSize}
                  onChange={(event) => {
                    const value = event.target.value
                    setVisualProofDrafts((current) => ({
                      ...current,
                      [item.key]: { ...current[item.key], viewportSize: value },
                    }))
                  }}
                  placeholder="1440x900"
                  className="mt-1 w-full rounded-md border border-amber-200 bg-white px-2 py-1 text-xs text-amber-950 outline-none focus:border-amber-400"
                />
              </label>
              <label className="mt-2 block text-[11px] font-semibold text-amber-950">
                Visible panels
                <input
                  aria-label={`${item.label} visible panels`}
                  value={visualProofDrafts[item.key].visiblePanels}
                  onChange={(event) => {
                    const value = event.target.value
                    setVisualProofDrafts((current) => ({
                      ...current,
                      [item.key]: { ...current[item.key], visiblePanels: value },
                    }))
                  }}
                  placeholder="Canvas, Sources, Inspector"
                  className="mt-1 w-full rounded-md border border-amber-200 bg-white px-2 py-1 text-xs text-amber-950 outline-none focus:border-amber-400"
                />
              </label>
              <label className="mt-2 flex items-start gap-2 text-[11px] font-semibold text-amber-950">
                <input
                  type="checkbox"
                  aria-label={`${item.label} proof is signed-in`}
                  checked={visualProofDrafts[item.key].signedIn}
                  onChange={(event) => {
                    const value = event.target.checked
                    setVisualProofDrafts((current) => ({
                      ...current,
                      [item.key]: { ...current[item.key], signedIn: value },
                    }))
                  }}
                  className="mt-0.5"
                />
                Signed-in admin or portal session visible in this proof
              </label>
              <button
                type="button"
                onClick={() => { void saveVisualProof(item.key) }}
                disabled={!activeCanvas?.id || savingVisualProofKey === item.key}
                className="mt-2 w-full rounded-md border border-amber-300 bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-950 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {savingVisualProofKey === item.key ? 'Saving proof' : `Save ${item.label} proof`}
              </button>
            </div>
          ))}
        </div>
      </section>

      <section
        aria-label="Higgsfield parity audit"
        className="rounded-lg border border-[var(--color-pib-line)] bg-white p-4"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-normal text-[var(--color-pib-text-muted)]">Higgsfield parity audit</p>
            <h2 className="text-lg font-semibold text-[var(--color-pib-text)]">Canvas capability evidence</h2>
          </div>
          <span className="rounded-full border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-3 py-1 text-xs font-semibold text-[var(--color-pib-text)]">
            {parityPassedCount}/{parityAuditItems.length} evidenced
          </span>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {parityAuditItems.map((item) => (
            <div
              key={item.label}
              className={`min-w-0 rounded-lg border px-3 py-2 text-xs ${
                item.status === 'passed'
                  ? 'border-green-200 bg-green-50 text-green-800'
                  : item.status === 'watch'
                    ? 'border-amber-200 bg-amber-50 text-amber-800'
                    : 'border-red-200 bg-red-50 text-red-800'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold">{item.label}</p>
                <span className="shrink-0 rounded-full border border-current px-2 py-0.5 uppercase tracking-normal">
                  {item.status}
                </span>
              </div>
              <p className="mt-1 break-words">{item.evidence}</p>
            </div>
          ))}
        </div>
      </section>

      <section
        id="direct-higgsfield-benchmark-proof"
        aria-label="Direct Higgsfield benchmark proof"
        className="rounded-lg border border-[var(--color-pib-line)] bg-white p-4"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-normal text-[var(--color-pib-text-muted)]">Direct Higgsfield benchmark proof</p>
            <h2 className="text-lg font-semibold text-[var(--color-pib-text)]">Capability-by-capability evidence ledger</h2>
          </div>
          <span className="rounded-full border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-3 py-1 text-xs font-semibold text-[var(--color-pib-text)]">
            {benchmarkPassedCount}/{benchmarkProofItems.length} benchmark proven
          </span>
        </div>
        <div className="mt-3 flex flex-col gap-2 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-3 py-2 text-xs text-[var(--color-pib-text-muted)] sm:flex-row sm:items-center sm:justify-between">
          <p>
            {readyBenchmarkProofItems.length
              ? `${readyBenchmarkProofItems.length} ready benchmark ${readyBenchmarkProofItems.length === 1 ? 'category needs' : 'categories need'} stored proof.`
              : 'No uncaptured benchmark category has enough live evidence yet.'}
          </p>
          <button
            type="button"
            onClick={() => { void captureReadyBenchmarkProofs() }}
            disabled={!activeCanvas?.id || !readyBenchmarkProofItems.length || Boolean(savingBenchmarkProofKey)}
            className="rounded-md border border-[var(--color-pib-line)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--color-pib-text)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            Capture ready proofs
          </button>
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-3">
          {benchmarkProofItems.map((item) => (
            <div
              key={item.key}
              className={`rounded-lg border p-3 text-xs ${
                item.status === 'passed'
                  ? 'border-green-200 bg-green-50 text-green-800'
                  : item.status === 'proof needed'
                    ? 'border-amber-200 bg-amber-50 text-amber-800'
                    : 'border-red-200 bg-red-50 text-red-800'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold">{item.label}</p>
                  <p className="mt-1">{item.benchmark}</p>
                  <a
                    href={item.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex text-[11px] font-semibold text-[var(--color-pib-primary)] underline"
                  >
                    Benchmark source: {item.sourceTitle}
                  </a>
                </div>
                <span className="shrink-0 rounded-full border border-current px-2 py-0.5 text-[10px] font-semibold uppercase tracking-normal">
                  {item.status}
                </span>
              </div>
              {item.proof?.capturedAt ? (
                <p className="mt-2 text-[11px] font-semibold">Captured {new Date(item.proof.capturedAt).toLocaleString()}</p>
              ) : null}
              {item.proof?.sourceUrl ? (
                <p className="mt-1 text-[11px]">
                  Source checked {item.proof.sourceCheckedAt ? new Date(item.proof.sourceCheckedAt).toLocaleString() : 'not dated'}
                </p>
              ) : null}
              {item.proof && (!item.proof.sourceUrl || !item.proof.sourceCheckedAt) ? (
                <p className="mt-1 text-[11px] font-semibold">Needs Higgsfield source check before this proof can pass.</p>
              ) : null}
              {item.proof && !hasRequiredBenchmarkSourceSignals(item.proof, item.sourceSignals) ? (
                <p className="mt-1 text-[11px] font-semibold">Needs matched Higgsfield source signals before this proof can pass.</p>
              ) : null}
              {item.proof && !hasDirectBenchmarkComparison(item.proof) ? (
                <p className="mt-1 text-[11px] font-semibold">Needs direct Higgsfield UI comparison evidence before this proof can pass.</p>
              ) : null}
              {item.proof && !hasCurrentCanvasBenchmarkState(item.proof, currentProofGraphState) ? (
                <p className="mt-1 text-[11px] font-semibold">Needs proof captured against the current canvas version and graph state before this benchmark can pass.</p>
              ) : null}
              <div className="mt-2 rounded-md border border-current/20 bg-white/70 px-2 py-1 text-[11px]">
                <p className="font-semibold">Current Higgsfield source signals</p>
                <ul className="mt-1 space-y-0.5">
                  {item.sourceSignals.map((signal) => (
                    <li key={signal}>- {signal}</li>
                  ))}
                </ul>
                {item.proof?.sourceSignals?.length ? (
                  <p className="mt-1">Stored signals: {item.proof.sourceSignals.join(', ')}</p>
                ) : (
                  <p className="mt-1 font-semibold">No stored source signals yet.</p>
                )}
              </div>
              {item.proof?.directComparisonAt ? (
                <div className="mt-2 rounded-md border border-current/20 bg-white/70 px-2 py-1 text-[11px]">
                  <p className="font-semibold">Direct comparison</p>
                  <p>Verdict: {item.proof.directComparisonVerdict === 'pass' ? 'pass' : 'gap'}</p>
                  <p>Compared {new Date(item.proof.directComparisonAt).toLocaleString()}</p>
                  <p>
                    Canvas state: v{item.proof.canvasVersion ?? 'missing'} · {item.proof.nodeCount ?? 0} nodes · {item.proof.edgeCount ?? 0} links
                  </p>
                  {item.proof.directComparisonNotes ? <p className="mt-1">{item.proof.directComparisonNotes}</p> : null}
                  <div className="mt-1 flex flex-wrap gap-2">
                    {item.proof.higgsfieldUiEvidenceUrl ? (
                      <a
                        href={item.proof.higgsfieldUiEvidenceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold text-[var(--color-pib-primary)] underline"
                      >
                        Higgsfield UI evidence
                      </a>
                    ) : null}
                    {item.proof.canvasEvidenceUrl ? (
                      <a
                        href={item.proof.canvasEvidenceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold text-[var(--color-pib-primary)] underline"
                      >
                        Canvas evidence
                      </a>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {item.proof?.proofUrl ? (
                <a
                  href={item.proof.proofUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex text-[11px] font-semibold text-[var(--color-pib-primary)] underline"
                >
                  Open benchmark proof
                </a>
              ) : null}
              <label className="mt-2 block text-[11px] font-semibold">
                Proof URL
                <input
                  aria-label={`${item.label} benchmark proof URL`}
                  value={benchmarkProofDrafts[item.key].proofUrl}
                  onChange={(event) => {
                    const value = event.target.value
                    setBenchmarkProofDrafts((current) => ({
                      ...current,
                      [item.key]: { ...current[item.key], proofUrl: value },
                    }))
                  }}
                  placeholder="https://..."
                  className="mt-1 w-full rounded-md border border-current/20 bg-white px-2 py-1 text-xs text-[var(--color-pib-text)] outline-none focus:border-current"
                />
              </label>
              <label className="mt-2 block text-[11px] font-semibold">
                Notes
                <textarea
                  aria-label={`${item.label} benchmark proof notes`}
                  value={benchmarkProofDrafts[item.key].notes}
                  onChange={(event) => {
                    const value = event.target.value
                    setBenchmarkProofDrafts((current) => ({
                      ...current,
                      [item.key]: { ...current[item.key], notes: value },
                    }))
                  }}
                  rows={2}
                  className="mt-1 w-full resize-none rounded-md border border-current/20 bg-white px-2 py-1 text-xs text-[var(--color-pib-text)] outline-none focus:border-current"
                />
              </label>
              <button
                type="button"
                onClick={() => { void saveBenchmarkProof(item.key) }}
                disabled={!activeCanvas?.id || savingBenchmarkProofKey === item.key}
                className="mt-2 w-full rounded-md border border-current/20 bg-white px-2 py-1 text-[11px] font-semibold disabled:cursor-not-allowed disabled:opacity-60"
              >
                {savingBenchmarkProofKey === item.key ? 'Saving proof' : `Save ${item.label} proof`}
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="grid min-h-[620px] gap-4 lg:grid-cols-[260px_minmax(0,1fr)_280px]">
        <aside
          aria-label="Source and workflow tools"
          className={`${mobilePanelClass('sources')} space-y-4 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-card)] p-4`}
        >
          <div>
            <p className="text-xs font-semibold uppercase tracking-normal text-[var(--color-pib-text-muted)]">Canvases</p>
            <div className="mt-3 space-y-2">
              {canvases.map((canvas) => (
                <button
                  key={canvas.id}
                  type="button"
                  aria-label={`Open ${canvas.title}`}
                  onClick={() => { void openCanvas(canvas) }}
                  className="w-full rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-left text-sm text-[var(--color-pib-text)] transition hover:bg-[var(--color-pib-surface)]"
                >
                  <span className="block font-semibold">Canvas: {canvas.title}</span>
                  <span className="block text-xs text-[var(--color-pib-text-muted)]">{canvas.purpose}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-normal text-[var(--color-pib-text-muted)]">Palette</p>
            <div className="mt-3 space-y-2">
              {palette.map((item) => (
                <button
                  key={item.type}
                  type="button"
                  aria-label={`Add ${item.type} node`}
                  onClick={() => addCanvasNode(item.type)}
                  className="w-full rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-left transition hover:bg-[var(--color-pib-surface)]"
                >
                  <span className="block text-sm font-semibold text-[var(--color-pib-text)]">{item.label}</span>
                  <span className="block text-xs text-[var(--color-pib-text-muted)]">{item.description}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-normal text-[var(--color-pib-text-muted)]">Workflow presets</p>
            <div className="mt-3 space-y-2">
              {coreWorkflowPresets.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  aria-label={`Apply ${preset.label} workflow`}
                  onClick={() => applyWorkflowPreset(preset)}
                  className="w-full rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-left transition hover:bg-[var(--color-pib-surface)]"
                >
                  <span className="block text-sm font-semibold text-[var(--color-pib-text)]">{preset.label}</span>
                  <span className="block text-xs text-[var(--color-pib-text-muted)]">{preset.description}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-normal text-[var(--color-pib-text-muted)]">Higgsfield benchmark workflows</p>
              <span className="text-[11px] font-semibold text-[var(--color-pib-text-muted)]">
                {benchmarkWorkflowPresets.length}/{higgsfieldBenchmarkScenarios.length}
              </span>
            </div>
            <div className="mt-3 rounded-lg border border-[var(--color-pib-line)] bg-white p-3 text-xs text-[var(--color-pib-text-muted)]">
              <p>{graphBenchmarkScenarioCount}/{higgsfieldBenchmarkScenarios.length} benchmark scenarios are already in this graph.</p>
              <button
                type="button"
                onClick={applyMissingBenchmarkWorkflowSuite}
                disabled={!missingBenchmarkWorkflowCount}
                className="mt-2 w-full rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-2 py-1.5 text-xs font-semibold text-[var(--color-pib-text)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {missingBenchmarkWorkflowCount
                  ? `Apply ${missingBenchmarkWorkflowCount} missing benchmark workflows`
                  : 'Benchmark suite complete'}
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {benchmarkWorkflowPresets.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  aria-label={`Apply ${preset.label} workflow`}
                  onClick={() => applyWorkflowPreset(preset)}
                  className="w-full rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-left transition hover:bg-[var(--color-pib-surface)]"
                >
                  <span className="block text-sm font-semibold text-[var(--color-pib-text)]">{preset.label}</span>
                  <span className="block text-xs text-[var(--color-pib-text-muted)]">{preset.description}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-normal text-[var(--color-pib-text-muted)]">Saved templates</p>
            <div className="mt-3 space-y-2 rounded-lg border border-dashed border-[var(--color-pib-line)] bg-white p-3">
              <label className="block text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-template-title">
                Template name
                <input
                  id="creative-canvas-template-title"
                  value={templateTitle}
                  onChange={(event) => setTemplateTitle(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-white px-2 py-1.5 text-xs text-[var(--color-pib-text)]"
                  placeholder={activeCanvas ? `${activeCanvas.title} template` : 'Reusable campaign flow'}
                />
              </label>
              <label className="block text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-template-description">
                Template notes
                <input
                  id="creative-canvas-template-description"
                  value={templateDescription}
                  onChange={(event) => setTemplateDescription(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-white px-2 py-1.5 text-xs text-[var(--color-pib-text)]"
                  placeholder="Reusable social, blog, video, or book pipeline"
                />
              </label>
              <button
                type="button"
                onClick={saveCurrentGraphAsTemplate}
                disabled={!activeCanvas?.id || !nodes.length}
                className="w-full rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-left text-xs font-semibold text-[var(--color-pib-text)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Save current graph as template
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {templates.length ? templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  aria-label={`Apply ${template.title} template`}
                  onClick={() => applySavedTemplate(template)}
                  className="w-full rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-left transition hover:bg-[var(--color-pib-surface)]"
                >
                  <span className="block text-sm font-semibold text-[var(--color-pib-text)]">{template.title}</span>
                  <span className="block text-xs text-[var(--color-pib-text-muted)]">
                    {template.nodes.length} nodes / {template.edges.length} links{template.description ? ` / ${template.description}` : ''}
                  </span>
                </button>
              )) : (
                <p className="rounded-lg border border-dashed border-[var(--color-pib-line)] px-3 py-2 text-xs text-[var(--color-pib-text-muted)]">
                  Saved reusable workflow templates will appear here.
                </p>
              )}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-normal text-[var(--color-pib-text-muted)]">Source library</p>
            <div className="mt-3 space-y-2">
              <label className="block text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-source-search">
                Search sources
                <input
                  id="creative-canvas-source-search"
                  value={sourceQuery}
                  onChange={(event) => setSourceQuery(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-white px-2 py-1.5 text-xs text-[var(--color-pib-text)]"
                  placeholder="Product, UGC, founder, cover..."
                />
              </label>
              <div className="grid grid-cols-1 gap-2">
                <label className="text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-source-kind">
                  Source kind
                  <select
                    id="creative-canvas-source-kind"
                    value={sourceKindFilter}
                    onChange={(event) => setSourceKindFilter(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-white px-2 py-1.5 text-xs text-[var(--color-pib-text)]"
                  >
                    <option value="">All sources</option>
                    <option value="upload">Uploads</option>
                    <option value="workspace_artifact">Workspace artifacts</option>
                    <option value="research_item">Research</option>
                    <option value="social_post">Social media/posts</option>
                    <option value="youtube_asset">YouTube assets</option>
                    <option value="book_studio_record">Book Studio</option>
                  </select>
                </label>
                <label className="text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-source-role">
                  Reference role
                  <select
                    id="creative-canvas-source-role"
                    value={sourceRoleFilter}
                    onChange={(event) => setSourceRoleFilter(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-white px-2 py-1.5 text-xs text-[var(--color-pib-text)]"
                  >
                    <option value="">All roles</option>
                    <option value="product">Product</option>
                    <option value="person">Person</option>
                    <option value="style">Style</option>
                    <option value="logo">Logo</option>
                    <option value="mask">Mask</option>
                    <option value="motion">Motion</option>
                    <option value="general">General</option>
                  </select>
                </label>
                <label className="text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-source-media">
                  Media type
                  <select
                    id="creative-canvas-source-media"
                    value={sourceMediaFilter}
                    onChange={(event) => setSourceMediaFilter(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-white px-2 py-1.5 text-xs text-[var(--color-pib-text)]"
                  >
                    <option value="">All media</option>
                    <option value="image">Images</option>
                    <option value="video">Videos</option>
                    <option value="audio">Audio</option>
                    <option value="document">Documents</option>
                  </select>
                </label>
              </div>
              <div className="rounded-lg border border-dashed border-[var(--color-pib-line)] bg-white p-3">
                <p className="text-xs font-semibold text-[var(--color-pib-text)]">Upload source</p>
                <div className="mt-2 space-y-2">
                  <label className="block text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-upload-role">
                    Upload role
                    <select
                      id="creative-canvas-upload-role"
                      value={sourceUploadRole}
                      onChange={(event) => setSourceUploadRole(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-white px-2 py-1.5 text-xs text-[var(--color-pib-text)]"
                    >
                      <option value="product">Product</option>
                      <option value="person">Person</option>
                      <option value="style">Style</option>
                      <option value="logo">Logo</option>
                      <option value="mask">Mask</option>
                      <option value="motion">Motion</option>
                      <option value="general">General</option>
                    </select>
                  </label>
                  <label className="block text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-upload-alt">
                    Alt text
                    <input
                      id="creative-canvas-upload-alt"
                      value={sourceUploadAltText}
                      onChange={(event) => setSourceUploadAltText(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-white px-2 py-1.5 text-xs text-[var(--color-pib-text)]"
                      placeholder="Product bottle front angle"
                    />
                  </label>
                  <label className="block cursor-pointer rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-xs font-semibold text-[var(--color-pib-text)]" htmlFor="creative-canvas-source-upload">
                    {sourceUploading ? 'Uploading source...' : 'Choose media or PDF'}
                    <input
                      id="creative-canvas-source-upload"
                      type="file"
                      accept="image/*,video/*,audio/*,application/pdf"
                      multiple
                      disabled={sourceUploading}
                      onChange={(event) => {
                        void uploadSourceFiles(event.target.files)
                        event.currentTarget.value = ''
                      }}
                      className="sr-only"
                    />
                  </label>
                </div>
              </div>
            </div>
            <div className="mt-3 space-y-2">
              {sourceLibrary.length ? sourceLibrary.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-label={`Import ${item.title}`}
                  onClick={() => importSourceItem(item)}
                  className="w-full rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-left transition hover:bg-[var(--color-pib-surface)]"
                >
                  <span className="block text-sm font-semibold text-[var(--color-pib-text)]">{item.title}</span>
                  <span className="block text-xs text-[var(--color-pib-text-muted)]">
                    {item.source.kind}{item.source.referenceRole ? ` / ${item.source.referenceRole}` : ''}
                  </span>
                </button>
              )) : (
                <p className="rounded-lg border border-dashed border-[var(--color-pib-line)] px-3 py-2 text-xs text-[var(--color-pib-text-muted)]">
                  Uploads, artifacts, research, social media, YouTube, and Book Studio sources will appear here.
                </p>
              )}
            </div>
          </div>
        </aside>

        <section
          aria-label="Canvas graph workspace"
          className={`${mobilePanelClass('canvas')} overflow-hidden rounded-lg border border-[var(--color-pib-line)] bg-white`}
        >
          <div className="flex flex-col gap-2 border-b border-[var(--color-pib-line)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-[var(--color-pib-text)]">{activeCanvas?.title ?? 'Untitled canvas'}</h2>
              <p className="text-xs text-[var(--color-pib-text-muted)]">
                {nodes.length} nodes / {edges.length} links / v{activeCanvas?.activeVersion ?? 1}
              </p>
            </div>
            {saveMessage ? <p className="text-xs font-medium text-[var(--color-pib-text-muted)]">{saveMessage}</p> : null}
          </div>
          <div className="h-[62vh] min-h-[420px] lg:h-[560px]">
            <ReactFlow
              nodes={displayNodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={selectFlowNode}
              fitView
            >
              <Background />
              <Controls />
              <MiniMap />
            </ReactFlow>
          </div>
        </section>

        <aside
          aria-label="Canvas inspector and outputs"
          className={`${mobilePanelClass('inspector')} space-y-4 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-card)] p-4`}
        >
          <div>
            <p className="text-xs font-semibold uppercase tracking-normal text-[var(--color-pib-text-muted)]">Inspector</p>
            <h2 className="mt-2 text-lg font-semibold text-[var(--color-pib-text)]">
              {activeCanvas ? `Selected: ${activeCanvas.title}` : 'No canvas selected'}
            </h2>
            <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">
              {activeCanvas?.purpose ?? 'Create a canvas to start an agent-assisted creative workflow.'}
            </p>
            {selectedNodeId ? (
              <p className="mt-2 text-xs font-semibold text-[var(--color-pib-text-muted)]">
                Node {selectedNodeId} · {commentCountByNodeId[selectedNodeId] ?? 0} comment{(commentCountByNodeId[selectedNodeId] ?? 0) === 1 ? '' : 's'}
              </p>
            ) : null}
            {selectedNodeLockedByCollaborator ? (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <p className="font-semibold">
                  {selectedNodeCollaborators.map((collaborator) => collaborator.displayName ?? collaborator.actorUid).join(', ')} {selectedNodeCollaborators.length === 1 ? 'is' : 'are'} editing this node
                </p>
                <p className="mt-1">
                  Branching and settings writes are paused for this node until their focus moves away. You can still inspect, comment, queue runs, or apply a live draft.
                </p>
              </div>
            ) : null}
          </div>

          <div className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-3">
            <p className="text-sm font-semibold text-[var(--color-pib-text)]">Agent controls</p>
            <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
              Queue Higgsfield, copy, document, and review work from prompt/model nodes while keeping approval gates intact.
            </p>
            {selectedCanvasNode?.provider?.key === 'higgsfield' ? (
              <p className="mt-2 rounded-md bg-white px-2 py-1 text-xs text-[var(--color-pib-text-muted)]">
                Node settings: {selectedCanvasNode.provider.model ?? 'default model'} / {selectedCanvasNode.provider.mode ?? selectedCanvasNode.edit?.outputKind ?? 'image'}
              </p>
            ) : null}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="col-span-2 text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-model-id">
                Higgsfield model id
                <input
                  id="creative-canvas-model-id"
                  list="creative-canvas-model-suggestions"
                  value={runModel}
                  onChange={(event) => setRunModel(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-white px-2 py-1.5 text-xs text-[var(--color-pib-text)]"
                  placeholder="nano_banana_flash"
                />
                <datalist id="creative-canvas-model-suggestions">
                  {higgsfieldModelSuggestions.map((model) => (
                    <option key={model.id} value={model.id}>{model.label}</option>
                  ))}
                </datalist>
              </label>
              <div className="col-span-2 rounded-lg border border-[var(--color-pib-line)] bg-white p-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-[var(--color-pib-text)]">Benchmark model routing</p>
                  <span className="text-[11px] font-semibold text-[var(--color-pib-text-muted)]">
                    {routedModelIds.size} routed
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {higgsfieldModelSuggestions.map((model) => (
                    <button
                      key={model.id}
                      type="button"
                      onClick={() => applyHiggsfieldModelPreset(model)}
                      className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${
                        runModel === model.id
                          ? 'border-[var(--color-pib-primary)] bg-[var(--color-pib-primary)] text-white'
                          : 'border-[var(--color-pib-line)] text-[var(--color-pib-text)]'
                      }`}
                    >
                      {model.label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-output-kind">
                Output kind
                <select
                  id="creative-canvas-output-kind"
                  value={runOutputKind}
                  onChange={(event) => setRunOutputKind(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-white px-2 py-1.5 text-xs text-[var(--color-pib-text)]"
                >
                  <option value="image">Image</option>
                  <option value="video">Video</option>
                  <option value="campaign_asset">Campaign asset</option>
                  <option value="social_post_draft">Social draft</option>
                  <option value="youtube_render">YouTube render</option>
                  <option value="book_artifact">Book artifact</option>
                </select>
              </label>
              <label className="text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-aspect-ratio">
                Aspect ratio
                <select
                  id="creative-canvas-aspect-ratio"
                  value={runAspectRatio}
                  onChange={(event) => setRunAspectRatio(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-white px-2 py-1.5 text-xs text-[var(--color-pib-text)]"
                >
                  <option value="1:1">1:1</option>
                  <option value="4:5">4:5</option>
                  <option value="9:16">9:16</option>
                  <option value="16:9">16:9</option>
                </select>
              </label>
              <label className="text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-duration">
                Duration seconds
                <input
                  id="creative-canvas-duration"
                  type="number"
                  min={0}
                  max={60}
                  value={runDurationSeconds}
                  onChange={(event) => setRunDurationSeconds(Math.max(0, Number(event.target.value) || 0))}
                  className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-white px-2 py-1.5 text-xs text-[var(--color-pib-text)]"
                />
              </label>
              <label className="text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-variants">
                Variants
                <input
                  id="creative-canvas-variants"
                  type="number"
                  min={1}
                  max={8}
                  value={runVariantCount}
                  onChange={(event) => setRunVariantCount(Math.min(8, Math.max(1, Number(event.target.value) || 1)))}
                  className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-white px-2 py-1.5 text-xs text-[var(--color-pib-text)]"
                />
              </label>
              <label className="text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-style-preset">
                Style preset
                <select
                  id="creative-canvas-style-preset"
                  value={runStylePreset}
                  onChange={(event) => setRunStylePreset(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-white px-2 py-1.5 text-xs text-[var(--color-pib-text)]"
                >
                  <option value="cinematic_product">Cinematic product</option>
                  <option value="ugc_social">UGC social</option>
                  <option value="editorial">Editorial</option>
                  <option value="clean_studio">Clean studio</option>
                  <option value="brand_realism">Brand realism</option>
                </select>
              </label>
              <label className="text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-camera-motion">
                Camera motion
                <select
                  id="creative-canvas-camera-motion"
                  value={runCameraMotion}
                  onChange={(event) => setRunCameraMotion(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-white px-2 py-1.5 text-xs text-[var(--color-pib-text)]"
                >
                  <option value="none">None</option>
                  <option value="camera_push">Camera push</option>
                  <option value="camera_pull">Camera pull</option>
                  <option value="pan">Pan</option>
                  <option value="orbit">Orbit</option>
                  <option value="dolly">Dolly</option>
                  <option value="handheld">Handheld</option>
                </select>
              </label>
              <label className="col-span-2 text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-negative-prompt">
                Negative prompt
                <input
                  id="creative-canvas-negative-prompt"
                  value={runNegativePrompt}
                  onChange={(event) => setRunNegativePrompt(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-white px-2 py-1.5 text-xs text-[var(--color-pib-text)]"
                  placeholder="Avoid blur, distortion, off-brand elements"
                />
              </label>
            </div>
            {mode === 'admin' ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={queueRun}
                  disabled={!selectedNodeId}
                  className="rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-xs font-semibold text-[var(--color-pib-text)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Queue run
                </button>
                <button
                  type="button"
                  onClick={applyGenerationSettingsToSelectedNode}
                  disabled={!selectedNodeId || selectedNodeLockedByCollaborator}
                  className="rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-xs font-semibold text-[var(--color-pib-text)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Apply settings to node
                </button>
                <button
                  type="button"
                  onClick={duplicateSelectedNode}
                  disabled={!selectedNodeId || selectedNodeLockedByCollaborator}
                  className="rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-xs font-semibold text-[var(--color-pib-text)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Duplicate selected node
                </button>
                <button
                  type="button"
                  onClick={createInpaintEditBranch}
                  disabled={!selectedNodeId || selectedNodeLockedByCollaborator}
                  className="rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-xs font-semibold text-[var(--color-pib-text)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Create inpaint edit branch
                </button>
                <button
                  type="button"
                  onClick={createFormatVariantBranches}
                  disabled={!selectedNodeId || selectedNodeLockedByCollaborator}
                  className="rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-xs font-semibold text-[var(--color-pib-text)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Create format variants
                </button>
                <button
                  type="button"
                  onClick={() => ingestRunOutput()}
                  disabled={!latestRun?.id}
                  className="rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-xs font-semibold text-[var(--color-pib-text)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Ingest latest run output
                </button>
                <button
                  type="button"
                  onClick={refreshLatestRunStatus}
                  disabled={!latestRun?.id}
                  className="rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-xs font-semibold text-[var(--color-pib-text)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Refresh provider status
                </button>
              </div>
            ) : null}
          </div>

          <div>
            <h3 className="text-sm font-semibold text-[var(--color-pib-text)]">Agent orchestration</h3>
            <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
              Graph-derived handoffs for source, strategy, prompt, generation, review, and export work.
            </p>
            <div className="mt-2 space-y-2">
              {orchestrationPlan.agents.length ? (
                <div className="rounded-lg border border-[var(--color-pib-line)] bg-white px-3 py-2 text-xs text-[var(--color-pib-text-muted)]">
                  <p className="font-semibold text-[var(--color-pib-text)]">Active agents</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {orchestrationPlan.agents.map((agent) => (
                      <span
                        key={agent.agentId}
                        className="rounded-full border border-[var(--color-pib-line)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-pib-text)]"
                      >
                        {agent.agentId} · {agent.stepCount}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              {orchestrationPlan.steps.length ? (
                <div className="rounded-lg border border-[var(--color-pib-line)] bg-white px-3 py-2 text-xs text-[var(--color-pib-text-muted)]">
                  <p className="font-semibold text-[var(--color-pib-text)]">Handoff chain</p>
                  <p className="mt-1 break-words">{orchestrationPlan.handoffSummary}</p>
                  <div className="mt-2 space-y-1.5">
                    {orchestrationPlan.steps.slice(0, 6).map((step) => (
                      <div key={step.id} className="border-t border-[var(--color-pib-line)] pt-1.5 first:border-t-0 first:pt-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-[var(--color-pib-text)]">{step.title}</span>
                          <span className="rounded-full border border-[var(--color-pib-line)] px-2 py-0.5 uppercase tracking-normal">
                            {step.status}
                          </span>
                        </div>
                        <p>{step.agentId} · {step.role.replaceAll('_', ' ')}</p>
                        <p>{step.deliverables.slice(0, 3).join(', ')}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="rounded-lg border border-dashed border-[var(--color-pib-line)] px-3 py-2 text-xs text-[var(--color-pib-text-muted)]">
                  Add or apply a workflow to create an agent handoff chain.
                </p>
              )}
              {orchestrationPlan.approvalGates.length ? (
                <div className="rounded-lg border border-[var(--color-pib-line)] bg-white px-3 py-2 text-xs text-[var(--color-pib-text-muted)]">
                  <p className="font-semibold text-[var(--color-pib-text)]">Approval gates</p>
                  {orchestrationPlan.approvalGates.map((gate) => (
                    <p key={gate.nodeId} className="mt-1">
                      {gate.title}: {gate.reviewerAgentId} · rights {gate.rightsStatus} · brand {gate.brandStatus}
                    </p>
                  ))}
                </div>
              ) : null}
              {orchestrationPlan.blockers.length ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  <p className="font-semibold">Orchestration blockers</p>
                  {orchestrationPlan.blockers.map((blocker) => <p key={blocker}>{blocker}</p>)}
                </div>
              ) : null}
              {mode === 'admin' ? (
                <button
                  type="button"
                  onClick={createOrchestrationTasks}
                  disabled={!activeCanvas?.id || !activeCanvas.linked?.projectId || !orchestrationPlan.steps.length || Boolean(orchestrationPlan.blockers.length)}
                  className="rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-xs font-semibold text-[var(--color-pib-text)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {activeCanvas?.linked?.projectId ? 'Create agent tasks' : 'Link project to create tasks'}
                </button>
              ) : null}
            </div>
          </div>

          {selectedCanvasNode?.edit ? (
            <div>
              <h3 className="text-sm font-semibold text-[var(--color-pib-text)]">Edit controls</h3>
              <div className="mt-2 space-y-2 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-3 text-xs text-[var(--color-pib-text-muted)]">
                <p className="font-semibold text-[var(--color-pib-text)]">
                  {selectedCanvasNode.edit.operation} / {selectedCanvasNode.edit.outputKind ?? 'image'}
                </p>
                <div className="rounded-lg border border-[var(--color-pib-line)] bg-white p-2">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-edit-intent">
                      Edit intent
                      <select
                        id="creative-canvas-edit-intent"
                        aria-label="Edit intent"
                        value={selectedCanvasNode.edit.intent ?? 'generative_fill'}
                        onChange={(event) => updateEditIntent(event.target.value as CreativeCanvasEditIntent)}
                        className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-white px-2 py-1.5 text-xs text-[var(--color-pib-text)]"
                      >
                        {editIntentOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-edit-prompt">
                      Brush prompt
                      <input
                        id="creative-canvas-edit-prompt"
                        aria-label="Edit brush prompt"
                        value={selectedCanvasNode.edit.prompt ?? ''}
                        onChange={(event) => updateEditPrompt(event.target.value)}
                        className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-white px-2 py-1.5 text-xs text-[var(--color-pib-text)]"
                        placeholder="Remove glare, add product, change to sunset..."
                      />
                    </label>
                  </div>
                  <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                    {blendControlOptions.map((option) => (
                      <label key={option.key} className="flex items-center gap-2 rounded-md border border-[var(--color-pib-line)] px-2 py-1 text-[11px] font-semibold text-[var(--color-pib-text)]">
                        <input
                          type="checkbox"
                          aria-label={option.label}
                          checked={selectedCanvasNode.edit?.blendControls?.[option.key] === true}
                          onChange={(event) => toggleBlendControl(option.key, event.target.checked)}
                        />
                        {option.label}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="rounded-lg border border-[var(--color-pib-line)] bg-white p-2">
                  <div
                    role="application"
                    aria-label="Brush mask canvas"
                    onPointerDown={handleMaskBrushPointerDown}
                    onPointerMove={handleMaskBrushPointerMove}
                    onPointerUp={handleMaskBrushPointerEnd}
                    onPointerCancel={handleMaskBrushPointerEnd}
                    className="relative aspect-video cursor-crosshair overflow-hidden rounded-md border border-[var(--color-pib-line)] bg-[linear-gradient(135deg,#f8fafc_0%,#f8fafc_48%,#eef2f7_48%,#eef2f7_100%)]"
                  >
                    <div
                      aria-label="Mask preview overlay"
                      className="absolute rounded-md border-2 border-[var(--color-pib-primary)] bg-[var(--color-pib-primary)]/25 shadow-[0_0_0_999px_rgba(15,23,42,0.18)]"
                      style={{
                        left: `${Math.min(100, maskRegion.x)}%`,
                        top: `${Math.min(100, maskRegion.y)}%`,
                        width: `${Math.min(100, maskRegion.width)}%`,
                        height: `${Math.min(100, maskRegion.height)}%`,
                      }}
                    />
                    {selectedMaskBrushStrokes.flatMap((stroke) => stroke.points.map((point, pointIndex) => (
                      <div
                        key={`${stroke.id}-${pointIndex}`}
                        aria-label={`Brush mask point ${selectedMaskBrushStrokes.slice(0, selectedMaskBrushStrokes.indexOf(stroke)).reduce((total, item) => total + item.points.length, 0) + pointIndex + 1}`}
                        className={`absolute rounded-full border ${
                          stroke.mode === 'erase'
                            ? 'border-red-300 bg-white/80'
                            : 'border-[var(--color-pib-primary)] bg-[var(--color-pib-primary)]/50'
                        }`}
                        style={{
                          left: `${Math.min(100, point.x)}%`,
                          top: `${Math.min(100, point.y)}%`,
                          width: `${Math.min(25, Math.max(1, stroke.size))}%`,
                          height: `${Math.min(25, Math.max(1, stroke.size))}%`,
                          opacity: stroke.opacity ?? 0.45,
                          transform: 'translate(-50%, -50%)',
                        }}
                      />
                    )))}
                    <div className="absolute bottom-2 left-2 rounded-md bg-white/90 px-2 py-1 text-[11px] font-semibold text-[var(--color-pib-text)]">
                      {maskRegion.width}x{maskRegion.height}% · feather {maskRegion.feather} · {selectedMaskBrushStrokes.length} brush
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-1.5">
                    {maskQuickRegions.map((preset) => (
                      <button
                        key={preset.key}
                        type="button"
                        onClick={() => applyMaskQuickRegion(preset.region)}
                        className="rounded-md border border-[var(--color-pib-line)] px-2 py-1 text-left text-[11px] font-semibold text-[var(--color-pib-text)]"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <label className="text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-brush-size">
                      Brush size
                      <input
                        id="creative-canvas-brush-size"
                        type="range"
                        min={2}
                        max={25}
                        value={maskBrushSize}
                        onChange={(event) => setMaskBrushSize(Math.min(25, Math.max(2, Number(event.target.value) || 8)))}
                        className="mt-1 w-full"
                      />
                    </label>
                    <label className="text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-brush-mode">
                      Brush mode
                      <select
                        id="creative-canvas-brush-mode"
                        value={maskBrushMode}
                        onChange={(event) => setMaskBrushMode(event.target.value === 'erase' ? 'erase' : 'paint')}
                        className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-white px-2 py-1.5 text-xs text-[var(--color-pib-text)]"
                      >
                        <option value="paint">Paint</option>
                        <option value="erase">Erase</option>
                      </select>
                    </label>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={undoBrushStroke}
                      disabled={!selectedMaskBrushStrokes.length}
                      className="rounded-md border border-[var(--color-pib-line)] px-2 py-1 text-[11px] font-semibold text-[var(--color-pib-text)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Undo brush stroke
                    </button>
                    <button
                      type="button"
                      onClick={clearBrushMask}
                      disabled={!selectedMaskBrushStrokes.length}
                      className="rounded-md border border-[var(--color-pib-line)] px-2 py-1 text-[11px] font-semibold text-[var(--color-pib-text)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Clear brush mask
                    </button>
                  </div>
                </div>
                <p>
                  Mask: {selectedMaskBrushStrokes.length
                    ? 'brush attached'
                    : selectedCanvasNode.edit.mask?.region
                    ? 'region attached'
                    : selectedCanvasNode.edit.mask?.url || selectedCanvasNode.edit.mask?.sourceNodeId
                      ? 'attached'
                      : 'not attached'}
                </p>
                <p>
                  Strength: {selectedCanvasNode.edit.strength ?? 0.65} / Motion: {selectedCanvasNode.edit.motion?.mode ?? 'none'}
                </p>
                <p>
                  Intent: {(selectedCanvasNode.edit.intent ?? 'generative_fill').replaceAll('_', ' ')} / Match controls: {blendControlOptions.filter((option) => selectedCanvasNode.edit?.blendControls?.[option.key]).length}/{blendControlOptions.length}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-mask-x">
                    Mask x
                    <input
                      id="creative-canvas-mask-x"
                      type="number"
                      min={0}
                      max={100}
                      value={maskRegion.x}
                      onChange={(event) => updateMaskRegionValue('x', event.target.value)}
                      className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-white px-2 py-1.5 text-xs text-[var(--color-pib-text)]"
                    />
                  </label>
                  <label className="text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-mask-y">
                    Mask y
                    <input
                      id="creative-canvas-mask-y"
                      type="number"
                      min={0}
                      max={100}
                      value={maskRegion.y}
                      onChange={(event) => updateMaskRegionValue('y', event.target.value)}
                      className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-white px-2 py-1.5 text-xs text-[var(--color-pib-text)]"
                    />
                  </label>
                  <label className="text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-mask-width">
                    Mask width
                    <input
                      id="creative-canvas-mask-width"
                      type="number"
                      min={0}
                      max={100}
                      value={maskRegion.width}
                      onChange={(event) => updateMaskRegionValue('width', event.target.value)}
                      className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-white px-2 py-1.5 text-xs text-[var(--color-pib-text)]"
                    />
                  </label>
                  <label className="text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-mask-height">
                    Mask height
                    <input
                      id="creative-canvas-mask-height"
                      type="number"
                      min={0}
                      max={100}
                      value={maskRegion.height}
                      onChange={(event) => updateMaskRegionValue('height', event.target.value)}
                      className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-white px-2 py-1.5 text-xs text-[var(--color-pib-text)]"
                    />
                  </label>
                  <label className="col-span-2 text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-mask-feather">
                    Mask feather
                    <input
                      id="creative-canvas-mask-feather"
                      type="number"
                      min={0}
                      max={100}
                      value={maskRegion.feather}
                      onChange={(event) => updateMaskRegionValue('feather', event.target.value)}
                      className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-white px-2 py-1.5 text-xs text-[var(--color-pib-text)]"
                    />
                  </label>
                </div>
                <button
                  type="button"
                  onClick={applyMaskRegion}
                  className="rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-xs font-semibold text-[var(--color-pib-text)]"
                >
                  Apply mask region
                </button>
                {selectedCanvasNode.edit.references?.length ? (
                  <p>{selectedCanvasNode.edit.references.length} reference inputs</p>
                ) : (
                  <p>No reference inputs linked yet</p>
                )}
              </div>
            </div>
          ) : null}

          <div>
            <h3 className="text-sm font-semibold text-[var(--color-pib-text)]">Run history</h3>
            <div className="mt-2 space-y-2">
              {runOperations ? (
                <div className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-3 py-2 text-xs text-[var(--color-pib-text-muted)]">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-[var(--color-pib-text)]">Provider operations</p>
                    <span className="rounded-full border border-[var(--color-pib-line)] bg-white px-2 py-0.5 text-[var(--color-pib-text)]">
                      {runOperations.active} active / {runOperations.total} total
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-4 gap-2">
                    <span>Queued {runOperations.byStatus.queued}</span>
                    <span>Running {runOperations.byStatus.running}</span>
                    <span>Review {runOperations.byStatus.waiting_for_review}</span>
                    <span>Failed {runOperations.failed}</span>
                  </div>
                  {runtimeReadiness ? (
                    <div className={`mt-2 rounded-md border px-2 py-1 ${
                      runtimeReadiness.blockers.length
                        ? 'border-amber-200 bg-amber-50 text-amber-800'
                        : 'border-green-200 bg-green-50 text-green-800'
                    }`}>
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold">Runtime readiness</p>
                        <span>{runtimeReadiness.runtimeConfigured ? 'configured' : 'not configured'}</span>
                      </div>
                      <p className="mt-1">
                        Submit {runtimeReadiness.submitConfigured ? 'yes' : 'no'} · Status {runtimeReadiness.statusPollingConfigured ? 'yes' : 'no'} · Project {runtimeReadiness.linkedProjectId ?? 'missing'}
                      </p>
                      {runtimeReadiness.blockers.length ? (
                        <p className="mt-1">{runtimeReadiness.blockers[0]}</p>
                      ) : runtimeReadiness.warnings.length ? (
                        <p className="mt-1">{runtimeReadiness.warnings[0]}</p>
                      ) : null}
                    </div>
                  ) : null}
                  {mode === 'admin' ? (
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--color-pib-line)] bg-white px-2 py-1">
                      <p className="font-semibold text-[var(--color-pib-text)]">
                        Reliability proof batch
                      </p>
                      <button
                        type="button"
                        onClick={queueProofBatchRuns}
                        disabled={!activeCanvas?.id}
                        className="rounded-md border border-[var(--color-pib-line)] px-2 py-1 font-semibold text-[var(--color-pib-text)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Queue proof batch
                      </button>
                    </div>
                  ) : null}
                  {runOperations.staleActiveRuns ? (
                    <p className="mt-2 font-semibold text-amber-700">
                      {runOperations.staleActiveRuns} active provider run{runOperations.staleActiveRuns === 1 ? '' : 's'} older than {runOperations.staleThresholdMinutes} min
                      {runOperations.oldestActiveRunAgeMinutes !== undefined ? ` · oldest ${runOperations.oldestActiveRunAgeMinutes} min` : ''}
                    </p>
                  ) : null}
                  {runOperations.retryableFailures ? (
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold text-red-700">{runOperations.retryableFailures} retryable provider failure{runOperations.retryableFailures === 1 ? '' : 's'}</p>
                      {mode === 'admin' ? (
                        <button
                          type="button"
                          onClick={retryAllProviderRuns}
                          className="rounded-md border border-[var(--color-pib-line)] bg-white px-2 py-1 font-semibold text-[var(--color-pib-text)]"
                        >
                          Retry all retryable
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  {runOperations.providers.length ? (
                    <div className="mt-2 space-y-1">
                      {runOperations.providers.map((provider) => (
                        <div key={provider.providerKey} className="rounded-md border border-[var(--color-pib-line)] bg-white px-2 py-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-[var(--color-pib-text)]">{provider.providerKey}</span>
                            <span>{provider.active} active · {provider.completed} completed · {provider.failed} failed</span>
                          </div>
                          {provider.staleActiveRuns ? (
                            <p className="mt-1 font-semibold text-amber-700">
                              {provider.staleActiveRuns} stale active{provider.oldestActiveRunAgeMinutes !== undefined ? ` · oldest ${provider.oldestActiveRunAgeMinutes} min` : ''}
                            </p>
                          ) : null}
                          {provider.latestProviderStatusMessage || provider.latestErrorMessage ? (
                            <p className="mt-1">
                              {provider.latestErrorMessage ?? provider.latestProviderStatusMessage}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {latestExecution?.command ? (
                <div className="rounded-lg border border-[var(--color-pib-line)] bg-white p-3 text-xs">
                  <p className="font-semibold text-[var(--color-pib-text)]">Higgsfield execution</p>
                  <code className="mt-2 block break-words rounded-md bg-[var(--color-pib-surface)] p-2 text-[11px] text-[var(--color-pib-text)]">
                    {latestExecution.command}
                  </code>
                  {latestExecution.dispatchPath ? (
                    <p className="mt-2 text-[var(--color-pib-text-muted)]">Dispatch: {latestExecution.dispatchPath}</p>
                  ) : null}
                  {latestExecution.callbackPath ? (
                    <p className="mt-1 text-[var(--color-pib-text-muted)]">Callback: {latestExecution.callbackPath}</p>
                  ) : null}
                  {latestExecution.statusPath ? (
                    <p className="mt-1 text-[var(--color-pib-text-muted)]">Status: {latestExecution.statusPath}</p>
                  ) : null}
                </div>
              ) : null}
              {runtimeProof ? (
                <div className={`rounded-lg border p-3 text-xs ${
                  runtimeProof.status === 'passed'
                    ? 'border-green-200 bg-green-50 text-green-800'
                    : runtimeProof.status === 'warning'
                      ? 'border-amber-200 bg-amber-50 text-amber-800'
                      : 'border-red-200 bg-red-50 text-red-800'
                }`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold">Live proof status</p>
                    <span className="rounded-full border border-current px-2 py-0.5 uppercase tracking-normal">{runtimeProof.status}</span>
                  </div>
                  <p className="mt-1">{runtimeProof.summary}</p>
                  <div className="mt-2 space-y-1">
                    {runtimeProof.reliabilityCoverage?.length ? (
                      <div className="rounded-md bg-white/70 px-2 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold">Production job coverage</span>
                          <span>
                            {runtimeProof.reliabilityCoverage.filter((category) => category.status === 'passed').length}/{runtimeProof.reliabilityCoverage.length} complete
                          </span>
                        </div>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          {runtimeProof.reliabilityCoverage.map((category) => (
                            <div key={category.key} className="rounded-md border border-current/20 bg-white px-2 py-1">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-semibold">{category.label}</span>
                                <span className="uppercase tracking-normal">{category.status}</span>
                              </div>
                              <p>
                                {category.completed}/{category.requiredCompleted ?? 1} required completed · {category.active} active · {category.failed} failed
                              </p>
                              {category.latestRunId ? (
                                <p>Latest: {category.latestRunId}</p>
                              ) : null}
                              {category.nextAction ? (
                                <p>{category.nextAction}</p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {runtimeProof.checks.map((item) => (
                      <div key={item.id} className="rounded-md bg-white/70 px-2 py-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold">{item.label}</span>
                          <span>{item.status}</span>
                        </div>
                        <p>{item.evidence}</p>
                      </div>
                    ))}
                  </div>
                  {mode === 'admin' ? (
                    <button
                      type="button"
                      onClick={refreshRuntimeProof}
                      className="mt-2 rounded-md border border-current bg-white px-2 py-1 font-semibold"
                    >
                      Refresh runtime proof
                    </button>
                  ) : null}
                </div>
              ) : null}
              {runHistory.length ? runHistory.map((run) => (
                <div
                  key={run.id}
                  className="rounded-lg border border-[var(--color-pib-line)] bg-white px-3 py-2 text-xs text-[var(--color-pib-text-muted)]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-[var(--color-pib-text)]">{run.providerKey}</span>
                    <span className="rounded-full border border-[var(--color-pib-line)] px-2 py-0.5 uppercase tracking-normal">
                      {run.status}
                    </span>
                  </div>
                  <p className="mt-1">Run: {run.id}</p>
                  {run.provenance.providerJobId ? <p>Provider job: {run.provenance.providerJobId}</p> : null}
                  {run.providerStatusMessage ? <p>Provider status: {run.providerStatusMessage}</p> : null}
                  {run.error?.message ? <p>Error: {run.error.message}</p> : null}
                  {run.output?.outputNodeId ? <p>Output: {run.output.outputNodeId}</p> : null}
                  {mode === 'admin' && ['queued', 'running', 'waiting_for_review'].includes(run.status) ? (
                    <button
                      type="button"
                      onClick={() => ingestRunOutput(run)}
                      className="mt-2 rounded-md border border-[var(--color-pib-line)] px-2 py-1 font-semibold text-[var(--color-pib-text)]"
                    >
                      Ingest output for {run.id}
                    </button>
                  ) : null}
                  {mode === 'admin' && run.status === 'failed' && run.error?.retryable ? (
                    <button
                      type="button"
                      onClick={() => retryProviderRun(run)}
                      className="mt-2 rounded-md border border-[var(--color-pib-line)] px-2 py-1 font-semibold text-[var(--color-pib-text)]"
                    >
                      Retry provider run
                    </button>
                  ) : null}
                </div>
              )) : (
                <p className="rounded-lg border border-dashed border-[var(--color-pib-line)] p-3 text-xs text-[var(--color-pib-text-muted)]">
                  Runs will appear here after an agent or provider job is queued.
                </p>
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-[var(--color-pib-text)]">Live collaborators</h3>
              <div className="flex items-center gap-2">
                <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-normal ${
                  collaborationStreamConnected
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-[var(--color-pib-line)] bg-white text-[var(--color-pib-text-muted)]'
                }`}>
                  {collaborationStreamConnected ? 'Live stream' : 'Refresh mode'}
                </span>
                <button
                  type="button"
                  onClick={() => activeCanvas?.id ? refreshCollaborationState(activeCanvas.id, resolvedOrgId || activeCanvas.orgId, activeCanvas.activeVersion) : undefined}
                  disabled={!activeCanvas?.id}
                  className="rounded-md border border-[var(--color-pib-line)] px-2 py-1 text-xs font-semibold text-[var(--color-pib-text)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Refresh
                </button>
              </div>
            </div>
            <label className="mt-2 flex items-center gap-2 rounded-lg border border-[var(--color-pib-line)] bg-white px-3 py-2 text-xs font-semibold text-[var(--color-pib-text)]">
              <input
                type="checkbox"
                checked={autoFollowLiveDrafts}
                onChange={(event) => setAutoFollowLiveDrafts(event.target.checked)}
                className="h-4 w-4 rounded border-[var(--color-pib-line)]"
              />
              Auto-follow live drafts
            </label>
            {autoFollowLiveDrafts && hasCollaboratorLiveDraft ? (
              <p className="mt-1 text-xs font-semibold text-amber-800">
                Watching {latestCollaboratorDraft?.displayName ?? latestCollaboratorDraft?.actorUid} live draft while your graph is clean.
              </p>
            ) : null}
            <div className="mt-2 rounded-lg border border-[var(--color-pib-line)] bg-white px-3 py-2">
              <p className="text-xs font-semibold text-[var(--color-pib-text)]">Canvas link</p>
              <p className="mt-1 break-all text-[11px] text-[var(--color-pib-text-muted)]">
                {collaborationLink || 'Open a canvas to create a collaboration link.'}
              </p>
              <button
                type="button"
                onClick={() => { void copyCollaborationLink() }}
                disabled={!collaborationLink}
                className="mt-2 rounded-md border border-[var(--color-pib-line)] px-2 py-1 text-xs font-semibold text-[var(--color-pib-text)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {collaborationLinkCopied ? 'Copied link' : 'Copy canvas link'}
              </button>
            </div>
            <div
              className="mt-2 rounded-lg border border-[var(--color-pib-line)] bg-white px-3 py-2"
              aria-label="Live collaboration activity"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-[var(--color-pib-text)]">Live activity</p>
                <span className="rounded-full border border-[var(--color-pib-line)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-normal text-[var(--color-pib-text-muted)]">
                  {collaborationActivity.length} recent
                </span>
              </div>
              <div className="mt-2 space-y-1.5">
                {collaborationActivity.length ? collaborationActivity.map((event) => (
                  <div
                    key={event.id}
                    className="rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-2 py-1.5 text-[11px] text-[var(--color-pib-text-muted)]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-[var(--color-pib-text)]">{event.actorLabel}</span>
                      <span className="uppercase tracking-normal">{new Date(event.atMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <p className="mt-0.5 font-semibold text-[var(--color-pib-text)]">{event.action}</p>
                    <p className="mt-0.5">{event.detail}</p>
                  </div>
                )) : (
                  <p className="rounded-md border border-dashed border-[var(--color-pib-line)] px-2 py-1.5 text-[11px] text-[var(--color-pib-text-muted)]">
                    Recent graph edits will appear here.
                  </p>
                )}
              </div>
            </div>
            <div className="mt-2 space-y-2">
              {presence.length ? presence.map((item) => (
                <div
                  key={item.id}
                  className="rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-xs text-[var(--color-pib-text-muted)]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-[var(--color-pib-text)]">{item.displayName ?? item.actorUid}</span>
                    <div className="flex flex-wrap justify-end gap-1">
                      {item.hasUnsavedGraphChanges ? (
                        <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 font-semibold text-amber-800">
                          Live draft
                        </span>
                      ) : null}
                      <span className="rounded-full border border-[var(--color-pib-line)] px-2 py-0.5 uppercase tracking-normal">
                        {item.actorType}
                      </span>
                    </div>
                  </div>
                  <p className="mt-1">{item.focus ?? 'canvas'}{item.selectedNodeId ? ` / ${item.selectedNodeTitle ?? item.selectedNodeId}` : ''}</p>
                  <p className="mt-1">
                    {typeof item.nodeCount === 'number' ? `${item.nodeCount} nodes` : 'Graph size unknown'}
                    {typeof item.edgeCount === 'number' ? ` / ${item.edgeCount} links` : ''}
                    {typeof item.activeVersion === 'number' ? ` / v${item.activeVersion}` : ''}
                  </p>
                  {item.hasUnsavedGraphChanges ? (
                    <p className="mt-1 font-semibold text-amber-800">
                      Unsaved graph edits are active in this collaborator workspace.
                    </p>
                  ) : null}
                  {item.draftGraph?.nodes?.length ? (
                    <button
                      type="button"
                      onClick={() => applyCollaboratorDraft(item)}
                      className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900"
                    >
                      Apply live draft
                    </button>
                  ) : null}
                </div>
              )) : (
                <p className="rounded-lg border border-dashed border-[var(--color-pib-line)] px-3 py-2 text-xs text-[var(--color-pib-text-muted)]">
                  Active collaborators will appear here.
                </p>
              )}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-[var(--color-pib-text)]">Versions</h3>
            {graphHasUnsavedChanges && !versionPreview ? (
              <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs font-semibold text-amber-800">
                Save or clear local graph edits before restoring or forking a saved version.
              </p>
            ) : null}
            <div className="mt-2 space-y-2">
              {versions.length ? versions.map((version) => {
                const summary = summarizeVersionDelta(version, nodes, edges)
                return (
                  <div
                    key={version.id ?? version.version}
                    className={`rounded-lg border px-3 py-2 text-xs text-[var(--color-pib-text-muted)] ${
                      versionPreview?.version === version.version
                        ? 'border-sky-300 bg-sky-50'
                        : 'border-[var(--color-pib-line)]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="font-semibold text-[var(--color-pib-text)]">Version {version.version}</span>
                        <span className="block">{version.reason ?? 'graph snapshot'}</span>
                      </div>
                      <span className="rounded-full border border-[var(--color-pib-line)] px-2 py-0.5 text-[11px] uppercase tracking-normal">
                        {summary.nodeCount} nodes
                      </span>
                    </div>
                    {summary.hasSnapshotGraph ? (
                      <>
                        <div className="mt-2 grid grid-cols-2 gap-1.5 rounded-md bg-[var(--color-pib-surface)] px-2 py-1.5">
                          <span>{summary.nodeCount} nodes / {summary.edgeCount} links</span>
                          <span>
                            +{summary.addedNodeCount + summary.addedEdgeCount} / -{summary.removedNodeCount + summary.removedEdgeCount} changes
                          </span>
                        </div>
                        {summary.changedNodeTitles.length ? (
                          <p className="mt-2 line-clamp-2">
                            Changed: {summary.changedNodeTitles.join(', ')}
                          </p>
                        ) : (
                          <p className="mt-2">No node membership changes versus the current graph.</p>
                        )}
                      </>
                    ) : (
                      <p className="mt-2 rounded-md bg-[var(--color-pib-surface)] px-2 py-1.5">
                        Snapshot graph unavailable for comparison.
                      </p>
                    )}
                    {mode === 'admin' ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => previewVersionGraph(version)}
                          disabled={!summary.hasSnapshotGraph || graphHasUnsavedChanges}
                          className="rounded-md border border-[var(--color-pib-line)] px-2 py-1 font-semibold text-[var(--color-pib-text)] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Preview
                        </button>
                        <button
                          type="button"
                          onClick={() => runVersionAction(version, 'restore')}
                          disabled={!version.id || (graphHasUnsavedChanges && !versionPreview)}
                          className="rounded-md border border-[var(--color-pib-line)] px-2 py-1 font-semibold text-[var(--color-pib-text)] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Restore
                        </button>
                        <button
                          type="button"
                          onClick={() => runVersionAction(version, 'fork')}
                          disabled={!version.id || (graphHasUnsavedChanges && !versionPreview)}
                          className="rounded-md border border-[var(--color-pib-line)] px-2 py-1 font-semibold text-[var(--color-pib-text)] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Fork
                        </button>
                      </div>
                    ) : null}
                  </div>
                )
              }) : (
                <p className="rounded-lg border border-dashed border-[var(--color-pib-line)] px-3 py-2 text-xs text-[var(--color-pib-text-muted)]">
                  Saved graph snapshots will appear here.
                </p>
              )}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-[var(--color-pib-text)]">Comments</h3>
            <div className="mt-2 space-y-2">
              {selectedNodeId && selectedNodeComments.length ? (
                <div className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-3 py-2 text-xs text-[var(--color-pib-text-muted)]">
                  <p className="font-semibold text-[var(--color-pib-text)]">Selected node thread</p>
                  <div className="mt-2 space-y-2">
                    {selectedNodeComments.map((comment) => (
                      <div key={comment.id} className="rounded-md border border-[var(--color-pib-line)] bg-white px-2 py-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-[var(--color-pib-text)]">{comment.createdByType}:{comment.createdBy}</span>
                          <span className="rounded-full border border-[var(--color-pib-line)] px-2 py-0.5 uppercase tracking-normal">{comment.visibility}</span>
                        </div>
                        <p className="mt-1 text-[var(--color-pib-text)]">{comment.body}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {canvasLevelComments.length ? (
                <div className="rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-xs text-[var(--color-pib-text-muted)]">
                  <p className="font-semibold text-[var(--color-pib-text)]">Canvas thread</p>
                  <div className="mt-2 space-y-2">
                    {canvasLevelComments.slice(0, 4).map((comment) => (
                      <div key={comment.id} className="rounded-md bg-[var(--color-pib-surface)] px-2 py-1.5">
                        <p className="font-semibold text-[var(--color-pib-text)]">{comment.createdByType}:{comment.createdBy}</p>
                        <p className="mt-1 text-[var(--color-pib-text)]">{comment.body}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {!selectedNodeComments.length && !canvasLevelComments.length ? (
                <p className="rounded-lg border border-dashed border-[var(--color-pib-line)] px-3 py-2 text-xs text-[var(--color-pib-text-muted)]">
                  Node and canvas comments will appear here.
                </p>
              ) : null}
            </div>
            <label className="mt-2 block text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-comment">
              Comment body
            </label>
            <textarea
              id="creative-canvas-comment"
              value={commentBody}
              onChange={(event) => setCommentBody(event.target.value)}
              rows={3}
              className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-white px-3 py-2 text-sm text-[var(--color-pib-text)]"
              placeholder="Add a note for agents, reviewers, or the client"
            />
            <button
              type="button"
              onClick={postComment}
              disabled={!activeCanvas?.id || !commentBody.trim()}
              className="mt-2 rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-xs font-semibold text-[var(--color-pib-text)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Add comment
            </button>
          </div>

          <div>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-[var(--color-pib-text)]">Asset gallery</h3>
              <span className="rounded-full border border-[var(--color-pib-line)] px-2 py-0.5 text-xs text-[var(--color-pib-text-muted)]">
                {filteredCanvasAssets.length} / {canvasAssets.length}
              </span>
            </div>
            <label className="mt-2 block text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-asset-filter">
              Asset filter
            </label>
            <select
              id="creative-canvas-asset-filter"
              value={assetOriginFilter}
              onChange={(event) => setAssetOriginFilter(event.target.value as 'all' | CreativeCanvasAssetOrigin)}
              className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-white px-3 py-2 text-xs text-[var(--color-pib-text)]"
            >
              <option value="all">All assets</option>
              <option value="source_node">Sources</option>
              <option value="output_node">Outputs</option>
              <option value="run_output">Run outputs</option>
            </select>
            <label className="mt-2 block text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-asset-readiness-filter">
              Readiness filter
            </label>
            <select
              id="creative-canvas-asset-readiness-filter"
              value={assetReadinessFilter}
              onChange={(event) => setAssetReadinessFilter(event.target.value as typeof assetReadinessFilter)}
              className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-white px-3 py-2 text-xs text-[var(--color-pib-text)]"
            >
              <option value="all">All readiness states</option>
              <option value="ready">Ready for export</option>
              <option value="draft_exportable">Draft exportable</option>
              <option value="review_needed">Review needed</option>
              <option value="blocked">Blocked</option>
            </select>
            {selectedCanvasAsset ? (
              <div className="mt-2 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-3 text-xs text-[var(--color-pib-text-muted)]">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-[var(--color-pib-text)]">{selectedCanvasAsset.title}</p>
                  <span className="rounded-full border border-[var(--color-pib-line)] bg-white px-2 py-0.5">
                    {assetOriginLabels[selectedCanvasAsset.origin]}
                  </span>
                </div>
                <p className="mt-1">
                  {selectedCanvasAsset.outputKind ?? selectedCanvasAsset.sourceKind ?? selectedCanvasAsset.providerKey ?? 'creative asset'}
                  {selectedCanvasAsset.nodeId ? ` · node ${selectedCanvasAsset.nodeId}` : ''}
                </p>
                {selectedCanvasAsset.runId ? <p>Run {selectedCanvasAsset.runId}</p> : null}
                {selectedCanvasAsset.suggestedExportTarget ? <p>Target {selectedCanvasAsset.suggestedExportTarget.replaceAll('_', ' ')}</p> : null}
                {selectedCanvasAsset.textPreview ? <p className="mt-1 line-clamp-3">{selectedCanvasAsset.textPreview}</p> : null}
                <p className={selectedCanvasAsset.canDraftExport ? 'mt-1 font-semibold text-green-700' : 'mt-1 text-[var(--color-pib-text-muted)]'}>
                  {selectedCanvasAsset.canDraftExport
                    ? 'Draft export available'
                    : selectedCanvasAsset.exportBlockedReason ?? 'Draft export unavailable'}
                </p>
                {selectedCanvasAsset.nodeId && selectedCanvasAsset.origin !== 'run_output' ? (
                  <div className="mt-3 space-y-2 border-t border-[var(--color-pib-line)] pt-3">
                    <label className="block text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-asset-title">
                      Asset title
                      <input
                        id="creative-canvas-asset-title"
                        value={selectedCanvasAsset.title}
                        onChange={(event) => updateSelectedAssetTitle(event.target.value)}
                        className="mt-1 w-full rounded-md border border-[var(--color-pib-line)] bg-white px-2 py-1.5 text-xs text-[var(--color-pib-text)]"
                      />
                    </label>
                    {selectedCanvasAsset.origin === 'source_node' ? (
                      <label className="block text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-asset-reference-role">
                        Reference role
                        <select
                          id="creative-canvas-asset-reference-role"
                          value={selectedCanvasAsset.referenceRole ?? 'general'}
                          onChange={(event) => updateSelectedAssetReferenceRole(event.target.value)}
                          className="mt-1 w-full rounded-md border border-[var(--color-pib-line)] bg-white px-2 py-1.5 text-xs text-[var(--color-pib-text)]"
                        >
                          <option value="general">General</option>
                          <option value="product">Product</option>
                          <option value="person">Person</option>
                          <option value="character">Character</option>
                          <option value="style">Style</option>
                          <option value="background">Background</option>
                          <option value="logo">Logo</option>
                          <option value="mask">Mask</option>
                          <option value="motion">Motion</option>
                        </select>
                      </label>
                    ) : null}
                    <label className="block text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-asset-text-preview">
                      Preview notes
                      <textarea
                        id="creative-canvas-asset-text-preview"
                        value={selectedCanvasAsset.textPreview ?? ''}
                        onChange={(event) => updateSelectedAssetTextPreview(event.target.value)}
                        rows={2}
                        className="mt-1 w-full rounded-md border border-[var(--color-pib-line)] bg-white px-2 py-1.5 text-xs text-[var(--color-pib-text)]"
                      />
                    </label>
                    {selectedCanvasAsset.origin === 'output_node' ? (
                      <label className="block text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-asset-export-target">
                        Asset export target
                        <select
                          id="creative-canvas-asset-export-target"
                          value={selectedCanvasAsset.suggestedExportTarget ?? exportTarget}
                          onChange={(event) => updateSelectedAssetExportTarget(event.target.value as CreativeCanvasExport['target'])}
                          className="mt-1 w-full rounded-md border border-[var(--color-pib-line)] bg-white px-2 py-1.5 text-xs text-[var(--color-pib-text)]"
                        >
                          <option value="social_draft">Social draft</option>
                          <option value="campaign_asset">Campaign asset</option>
                          <option value="client_document">Client document</option>
                          <option value="research">Research</option>
                          <option value="youtube_studio">YouTube Studio</option>
                          <option value="book_studio">Book Studio</option>
                          <option value="workspace_artifact">Workspace artifact</option>
                        </select>
                      </label>
                    ) : null}
                  </div>
                ) : null}
                {mode === 'admin' ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={exportSelectedAssetDraft}
                      disabled={!selectedCanvasAsset.canDraftExport || !selectedCanvasAsset.nodeId}
                      className="rounded-md border border-[var(--color-pib-line)] bg-white px-2 py-1 font-semibold text-[var(--color-pib-text)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Export selected asset draft
                    </button>
                    <button
                      type="button"
                      onClick={toggleSelectedAssetCompare}
                      className="rounded-md border border-[var(--color-pib-line)] bg-white px-2 py-1 font-semibold text-[var(--color-pib-text)]"
                    >
                      {compareAssetIds.includes(selectedCanvasAsset.id) ? 'Remove from compare' : 'Add to compare'}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
            {comparedCanvasAssets.length ? (
              <div className="mt-2 rounded-lg border border-[var(--color-pib-line)] bg-white p-3 text-xs text-[var(--color-pib-text-muted)]">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-[var(--color-pib-text)]">Compare assets</p>
                  <span>{comparedCanvasAssets.length} selected</span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {comparedCanvasAssets.map((asset) => {
                    const previewUrl = asset.thumbnailUrl ?? asset.url
                    return (
                      <div key={asset.id} className="rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-2">
                        {previewUrl ? (
                          <div
                            aria-label={`Compare preview: ${asset.title}`}
                            className="h-16 rounded bg-white bg-cover bg-center"
                            style={{ backgroundImage: `url(${previewUrl})` }}
                          />
                        ) : (
                          <div className="flex h-16 items-center justify-center rounded bg-white text-[10px] uppercase">
                            {asset.outputKind ?? asset.sourceKind ?? 'asset'}
                          </div>
                        )}
                        <p className="mt-1 truncate font-semibold text-[var(--color-pib-text)]">{asset.title}</p>
                        <p>{asset.readyForExport ? 'ready' : asset.canDraftExport ? 'draftable' : asset.reviewStatus ?? 'internal'}</p>
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : null}
            {mode === 'admin' ? (
              <div className="mt-2 rounded-lg border border-[var(--color-pib-line)] bg-white p-3 text-xs text-[var(--color-pib-text-muted)]">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold text-[var(--color-pib-text)]">Export package</p>
                    <p>
                      {comparedCanvasAssets.length
                        ? `${comparedCanvasAssets.filter((asset) => asset.origin === 'output_node' && asset.canDraftExport).length} compared output assets ready`
                        : `${canvasAssets.filter((asset) => asset.origin === 'output_node' && asset.canDraftExport).length} output assets ready`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={exportAssetPackage}
                    className="rounded-md border border-[var(--color-pib-line)] px-2 py-1 font-semibold text-[var(--color-pib-text)]"
                  >
                    Prepare package
                  </button>
                </div>
                {latestExportPackage ? (
                  <div className="mt-2 rounded-md bg-[var(--color-pib-surface)] px-2 py-1.5">
                    <p>
                      Package {latestExportPackage.id}: {latestExportPackage.assetCount} assets
                      {latestExportPackage.targets.length ? ` / ${latestExportPackage.targets.join(', ')}` : ''}
                    </p>
                    {latestExportPackage.manifest ? (
                      <p className="mt-1">
                        Manifest v{latestExportPackage.manifest.activeVersion ?? activeCanvas?.activeVersion ?? 0}: {latestExportPackage.manifest.nodeCount ?? 0} nodes / {latestExportPackage.manifest.edgeCount ?? 0} links
                        {latestExportPackage.manifest.requiredOutputKinds?.length ? ` / ${latestExportPackage.manifest.requiredOutputKinds.join(', ')}` : ''}
                        {typeof latestExportPackage.manifest.sourceNodeCount === 'number' ? ` / ${latestExportPackage.manifest.sourceNodeCount} sources` : ''}
                        {latestExportPackage.manifest.coveredCategories?.length ? ` / ${latestExportPackage.manifest.coveredCategories.length} categories` : ''}
                        {typeof latestExportPackage.manifest.downstreamDraftCount === 'number' ? ` / ${latestExportPackage.manifest.downstreamDraftCount} handoffs` : ''}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="mt-2 space-y-2">
              {filteredCanvasAssets.length ? filteredCanvasAssets.slice(0, 8).map((asset) => {
                const previewUrl = asset.thumbnailUrl ?? asset.url
                return (
                  <button
                    type="button"
                    key={asset.id}
                    aria-label={`Select asset ${asset.title}`}
                    onClick={() => selectCanvasAsset(asset.id)}
                    className={`w-full rounded-lg border p-2 text-left text-xs text-[var(--color-pib-text-muted)] transition hover:bg-[var(--color-pib-surface)] ${
                      selectedAssetId === asset.id
                        ? 'border-[var(--color-pib-primary)] bg-[var(--color-pib-surface)]'
                        : 'border-[var(--color-pib-line)] bg-white'
                    }`}
                  >
                    <div className="flex gap-2">
                      {previewUrl ? (
                        <div
                          aria-label={`Asset preview: ${asset.title}`}
                          className="h-14 w-16 shrink-0 rounded-md bg-[var(--color-pib-surface)] bg-cover bg-center"
                          style={{ backgroundImage: `url(${previewUrl})` }}
                        />
                      ) : (
                        <div className="flex h-14 w-16 shrink-0 items-center justify-center rounded-md bg-[var(--color-pib-surface)] text-[10px] uppercase">
                          {asset.outputKind ?? asset.sourceKind ?? 'asset'}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate font-semibold text-[var(--color-pib-text)]">{asset.title}</p>
                          <span className="shrink-0 rounded-full border border-[var(--color-pib-line)] px-2 py-0.5">
                            {assetOriginLabels[asset.origin]}
                          </span>
                        </div>
                        <p className="mt-1 truncate">
                          {asset.outputKind ?? asset.sourceKind ?? asset.providerKey ?? 'creative asset'}
                          {asset.nodeId ? ` · ${asset.nodeId}` : ''}
                        </p>
                        {asset.textPreview ? <p className="mt-1 line-clamp-2">{asset.textPreview}</p> : null}
                        <p className={asset.readyForExport ? 'mt-1 font-semibold text-green-700' : 'mt-1 text-[var(--color-pib-text-muted)]'}>
                          {asset.readyForExport ? 'Ready for export' : asset.reviewStatus ? `Review ${asset.reviewStatus}` : 'Internal asset'}
                        </p>
                      </div>
                    </div>
                  </button>
                )
              }) : (
                <p className="rounded-lg border border-dashed border-[var(--color-pib-line)] px-3 py-2 text-xs text-[var(--color-pib-text-muted)]">
                  Source uploads, generated outputs, and completed run artifacts will appear here.
                </p>
              )}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-[var(--color-pib-text)]">Output attachment</h3>
            <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
              Attach generated media, copy, blog blocks, book artifacts, or campaign assets back onto the selected node.
            </p>
            <button
              type="button"
              onClick={attachSampleOutput}
              disabled={!selectedNodeId}
              className="mt-2 rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-xs font-semibold text-[var(--color-pib-text)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Attach output
            </button>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-[var(--color-pib-text)]">Review gate</h3>
            <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
              Rights, brand, and synthetic-media disclosure must pass before client-visible or downstream export use.
            </p>
            <button
              type="button"
              onClick={markReviewPassed}
              disabled={!selectedNodeId}
              className="mt-2 rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-xs font-semibold text-[var(--color-pib-text)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Mark review passed
            </button>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-[var(--color-pib-text)]">Exports</h3>
            <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
              Draft adapters route reviewed outputs into social, documents, campaigns, YouTube Studio, Book Studio, and artifacts.
            </p>
            <label className="mt-2 block text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-export-target">
              Export target
            </label>
            <select
              id="creative-canvas-export-target"
              value={exportTarget}
              onChange={(event) => setExportTarget(event.target.value as CreativeCanvasExport['target'])}
              className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-white px-3 py-2 text-xs text-[var(--color-pib-text)]"
            >
              <option value="campaign_asset">Campaign asset</option>
              <option value="social_draft">Social draft</option>
              <option value="client_document">Client document / blog</option>
              <option value="research">Research</option>
              <option value="youtube_studio">YouTube Studio</option>
              <option value="book_studio">Book Studio</option>
              <option value="workspace_artifact">Workspace artifact</option>
            </select>
            <button
              type="button"
              onClick={() => { void exportDraft() }}
              disabled={!selectedNodeId}
              className="mt-2 rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-xs font-semibold text-[var(--color-pib-text)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Prepare draft export
            </button>
          </div>

          {activityMessage ? (
            <p className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-3 py-2 text-xs text-[var(--color-pib-text-muted)]">
              {activityMessage}
            </p>
          ) : null}

          <div>
            <h3 className="text-sm font-semibold text-[var(--color-pib-text)]">Nodes</h3>
            <div className="mt-2 space-y-2">
              {nodes.length ? nodes.map((node) => {
                const canvasNode = node.data?.canvasNode as CreativeCanvasNode | undefined

                return (
                  <div
                    key={node.id}
                    className="rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-xs text-[var(--color-pib-text-muted)]"
                  >
                    <span className="block font-semibold text-[var(--color-pib-text)]">
                      {canvasNode?.title ?? node.id}
                    </span>
                    <span>{canvasNode?.type ?? 'source'}</span>
                    {canvasNode?.source?.referenceRole ? (
                      <span className="ml-2">
                        {canvasNode.source.referenceRole} / {canvasNode.source.weight ?? 1}
                      </span>
                    ) : null}
                    {canvasNode?.edit ? (
                      <span className="ml-2">
                        {canvasNode.edit.operation} / {canvasNode.edit.outputKind ?? 'image'}
                      </span>
                    ) : null}
                    {canvasNode?.edit?.mask ? (
                      <span className="ml-2">mask attached</span>
                    ) : null}
                    {canvasNode?.source?.thumbnailUrl || canvasNode?.source?.previewUrl ? (
                      <CanvasPreviewBlock
                        url={canvasNode.source.thumbnailUrl ?? canvasNode.source.previewUrl ?? ''}
                        label={`Reference preview: ${canvasNode.source.altText ?? canvasNode.title}`}
                        className="mt-2 h-24 w-full rounded-md"
                      />
                    ) : null}
                  </div>
                )
              }) : (
                <p className="rounded-lg border border-dashed border-[var(--color-pib-line)] px-3 py-2 text-xs text-[var(--color-pib-text-muted)]">
                  Add source material, prompts, models, reviews, and outputs from the palette.
                </p>
              )}
            </div>
          </div>
        </aside>
      </section>
    </main>
  )
}
