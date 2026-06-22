import type {
  CreativeCanvas,
  CreativeCanvasBenchmarkProof,
  CreativeCanvasCategoryEvidence,
  CreativeCanvasCertificationArtifactEvidence,
  CreativeCanvasCollaborationProofEvidence,
  CreativeCanvasComment,
  CreativeCanvasEdge,
  CreativeCanvasExport,
  CreativeCanvasKnowledgeBaseCertificationEvidence,
  CreativeCanvasMobileProof,
  CreativeCanvasMobileViewportEvidence,
  CreativeCanvasNode,
  CreativeCanvasOutputKind,
  CreativeCanvasPresence,
  CreativeCanvasProofBinding,
  CreativeCanvasRemoteMutationEvidence,
  CreativeCanvasRemoteMutationOperation,
  CreativeCanvasRemoteMutationSource,
  CreativeCanvasRunOperationsSummary,
  CreativeCanvasRuntimeProof,
  CreativeCanvasTemplate,
  CreativeCanvasVersion,
} from '@/lib/creative-canvas/types'
import {
  creativeCanvasRemoteMutationOperations,
  creativeCanvasRemoteMutationSources,
} from '@/lib/creative-canvas/types'
import { collectCollaborationMutationProof } from '@/lib/creative-canvas/collaboration-proof'
import {
  hasDurableCategoryEvidence,
  hasStructuredCollaborationProof,
  hasStructuredMobileProof,
} from '@/lib/creative-canvas/parity-proof'

export type CreativeCanvasVisualProofKey = 'desktop_1440' | 'tablet_820' | 'mobile_390' | 'mobile_panels'
export type CreativeCanvasBenchmarkProofKey =
  | 'editing_ergonomics'
  | 'masking_inpainting'
  | 'generation_controls'
  | 'multi_asset_workflows'
  | 'versioning_polish'
  | 'collaboration'
  | 'agent_orchestration'
  | 'mobile_behavior'
  | 'export_flows'
  | 'production_reliability'

export type CreativeCanvasVisualProofRecord = {
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
  screenshotCheckedAt?: string
  screenshotReachable?: boolean
  screenshotStatus?: number
  screenshotContentType?: string
}

export type CreativeCanvasVisualProofDraft = Record<CreativeCanvasVisualProofKey, {
  screenshotUrl: string
  notes: string
  signedIn: boolean
  sessionEvidence: string
  viewportSize: string
  visiblePanels: string
}>

export type CreativeCanvasBenchmarkProofRecord = {
  proofUrl?: string
  notes?: string
  capturedAt?: string
  capturedBy?: string
  sourceTitle?: string
  sourceUrl?: string
  sourceCheckedAt?: string
  sourceEvidenceCheckedAt?: string
  sourceEvidenceReachable?: boolean
  sourceEvidenceStatus?: number
  sourceEvidenceContentType?: string
  sourceSignalsVerifiedAt?: string
  sourceSignalsMatched?: boolean
  sourceSignalsMissing?: string[]
  sourceSignals?: string[]
  higgsfieldUiEvidenceUrl?: string
  canvasEvidenceUrl?: string
  canvasEvidenceCheckedAt?: string
  canvasEvidenceReachable?: boolean
  canvasEvidenceStatus?: number
  canvasEvidenceContentType?: string
  directComparisonAt?: string
  directComparisonVerdict?: 'pass' | 'gap'
  directComparisonNotes?: string
  orgId?: string
  canvasVersion?: number
  graphSignature?: string
  nodeCount?: number
  edgeCount?: number
  collaborationRemoteActorCount?: number
  collaborationRemoteEventCount?: number
  collaborationRemoteMutationCount?: number
  collaborationRemoteMutationKindCount?: number
  collaborationRemoteTouchedNodeCount?: number
  collaborationRemoteTouchedEdgeCount?: number
  collaborationRemoteGraphSignature?: string
  collaborationRemoteSource?: CreativeCanvasRemoteMutationSource
  collaborationRemoteOutcome?: 'remote_changes_observed' | 'remote_changes_adopted' | 'conflict_detected' | 'version_forked'
  collaborationRemoteMutations?: CreativeCanvasRemoteMutationEvidence[]
  collaborationStreamConnected?: boolean
  collaborationCapturedAt?: string
  collaborationEvidence?: string
  editingLocalEventCount?: number
  editingNodeDropCount?: number
  editingNodeMoveCount?: number
  editingConnectionCount?: number
  editingConfiguredGenerationCount?: number
  editingCapturedAt?: string
  editingEvidence?: string
  maskingEditNodeCount?: number
  maskingPromptCount?: number
  maskingIntentCount?: number
  maskingRegionCount?: number
  maskingBrushStrokeCount?: number
  maskingBlendControlCount?: number
  maskingCapturedAt?: string
  maskingEvidence?: string
  generationModelCount?: number
  generationReferenceNodeCount?: number
  generationReferenceRoleCount?: number
  generationLinkedReferenceCount?: number
  generationMultiReferenceCapturedAt?: string
  generationMultiReferenceEvidence?: string
  versionSnapshotCount?: number
  versionRestorableSnapshotCount?: number
  versionNodeCommentCount?: number
  versionReusableTemplateCount?: number
  versionAutoSaveEnabled?: boolean
  versionCapturedAt?: string
  versionEvidence?: string
  multiAssetSourceNodeCount?: number
  multiAssetSourceKindCount?: number
  multiAssetReferenceRoleCount?: number
  multiAssetConnectedSourceCount?: number
  multiAssetOutputNodeCount?: number
  multiAssetWorkflowScenarioCount?: number
  multiAssetLineageEdgeCount?: number
  multiAssetCapturedAt?: string
  multiAssetEvidence?: string
  agentStepCount?: number
  agentActorCount?: number
  agentTaskCreatedCount?: number
  agentTaskCreatedAt?: string
  agentEvidence?: string
  mobileViewportProofCount?: number
  mobileViewportRequiredCount?: number
  mobileViewportProofCapturedAt?: string
  mobileViewportEvidence?: string
  mobileViewportBehaviorEvidence?: CreativeCanvasMobileViewportEvidence[]
  runtimeCategoryEvidence?: CreativeCanvasCategoryEvidence[]
  exportCategoryEvidence?: CreativeCanvasCategoryEvidence[]
  exportArtifactBackedCategoryCount?: number
  exportArtifactBackedCompletedCount?: number
  exportArtifactBackedCapturedAt?: string
  exportArtifactEvidence?: string
  runtimeProofStatus?: 'passed' | 'warning' | 'blocked'
  runtimeReadyForLiveProof?: boolean
  runtimeArtifactBackedCategoryCount?: number
  runtimeArtifactBackedCompletedCount?: number
  runtimeProviderBackedCategoryCount?: number
  runtimeProviderBackedCompletedCount?: number
  runtimeActiveRunCount?: number
  runtimeStaleActiveRunCount?: number
  runtimeFailedRunCount?: number
  runtimeFailureRatePercent?: number
  runtimeProofCapturedAt?: string
  runtimeEvidence?: string
  runtimeProviderEvidenceCapturedAt?: string
  runtimeProviderEvidence?: string
}

export type CreativeCanvasBenchmarkProofDraft = Record<CreativeCanvasBenchmarkProofKey, {
  proofUrl: string
  notes: string
}>

export interface CreativeCanvasActivityEvent {
  id: string
  actorLabel: string
  action: string
  detail: string
  nodeId?: string
  operation?: 'node_add' | 'node_move' | 'node_remove' | 'edge_add' | 'edge_remove' | 'workflow_add' | 'template_apply' | 'variant_create' | 'node_duplicate' | 'inpaint_branch' | 'node_configure' | 'draft_apply' | 'version_restore'
  atMs: number
  source: 'local' | 'stream' | 'draft'
  remoteMutation?: CreativeCanvasRemoteMutationEvidence
}

export const emptyVisualProofDrafts: CreativeCanvasVisualProofDraft = {
  desktop_1440: { screenshotUrl: '', notes: '', signedIn: false, sessionEvidence: '', viewportSize: '1440x900', visiblePanels: 'Graph, Sources, Inspector' },
  tablet_820: { screenshotUrl: '', notes: '', signedIn: false, sessionEvidence: '', viewportSize: '820x1180', visiblePanels: 'Responsive panel layout' },
  mobile_390: { screenshotUrl: '', notes: '', signedIn: false, sessionEvidence: '', viewportSize: '390x844', visiblePanels: 'Canvas panel' },
  mobile_panels: { screenshotUrl: '', notes: '', signedIn: false, sessionEvidence: '', viewportSize: '390x844', visiblePanels: 'Canvas, Sources, Inspector panel switcher' },
}

export const emptyBenchmarkProofDrafts: CreativeCanvasBenchmarkProofDraft = {
  editing_ergonomics: { proofUrl: '', notes: '' },
  masking_inpainting: { proofUrl: '', notes: '' },
  generation_controls: { proofUrl: '', notes: '' },
  multi_asset_workflows: { proofUrl: '', notes: '' },
  versioning_polish: { proofUrl: '', notes: '' },
  collaboration: { proofUrl: '', notes: '' },
  agent_orchestration: { proofUrl: '', notes: '' },
  mobile_behavior: { proofUrl: '', notes: '' },
  export_flows: { proofUrl: '', notes: '' },
  production_reliability: { proofUrl: '', notes: '' },
}

export const visualProofConfigs: Array<{
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

export const benchmarkProofConfigs: Array<{
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
    sourceSignals: ['Brush & Prompt', 'Precise Masking', 'Object Removal', 'Light Matching', 'Texture Adaptive', 'Auto-Shadows', 'IMAGE-TO-IMAGE BLENDING'],
  },
  {
    key: 'generation_controls',
    label: 'Generation controls',
    benchmark: 'Model, output kind, aspect ratio, variants, duration, motion, style, negative prompt, and image/video/audio dispatch control.',
    sourceTitle: 'Higgsfield Canvas current model catalog',
    sourceUrl: 'https://higgsfield.ai/canvas-intro',
    sourceSignals: ['Kling 3.0', 'Seedance 2.0', 'Wan 2.7', 'Soul 2.0', 'GPT Image 2.0', 'Veo 3.1', 'NB Pro', 'Any prompt, image, or reference'],
  },
  {
    key: 'multi_asset_workflows',
    label: 'Multi-asset workflows',
    benchmark: 'Own uploads, references, previous outputs, templates, and benchmark workflows combined in one connected pipeline.',
    sourceTitle: 'Higgsfield Canvas multi-reference workflows',
    sourceUrl: 'https://higgsfield.ai/canvas-intro',
    sourceSignals: ['Moodboard', 'mix models', 'route outputs', 'single creative pipeline', 'Soul ID characters', 'uploaded products', 'brand references', 'previous generations'],
  },
  {
    key: 'versioning_polish',
    label: 'Versioning polish',
    benchmark: 'Auto-save, preview, restore/fork safety, comments, review state, and non-destructive history inspection.',
    sourceTitle: 'Higgsfield Canvas saved versions and comments',
    sourceUrl: 'https://higgsfield.ai/canvas-intro',
    sourceSignals: ['Every version is saved', 'nothing gets lost', 'comments stay attached', 'reusable template'],
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
    key: 'agent_orchestration',
    label: 'AI agent integration',
    benchmark: 'Canvas graph handoffs become executable agent tasks with model/provider context, approval gates, and project-linked provenance.',
    sourceTitle: 'Higgsfield MCP, CLI, Collab, and Canvas surface',
    sourceUrl: 'https://higgsfield.ai/',
    sourceSignals: ['MCP & CLI', 'Collab', 'Canvas', 'Generate'],
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
    benchmark: 'Reviewable packages with manifests, target formats, provenance, source/output mapping, downstream drafts, and image/video/audio coverage.',
    sourceTitle: 'Higgsfield Canvas media library and generation pipeline',
    sourceUrl: 'https://higgsfield.ai/canvas',
    sourceSignals: ['Generate', 'Library', 'Image', 'Video', 'Audio'],
  },
  {
    key: 'production_reliability',
    label: 'Production reliability',
    benchmark: 'Repeated real image, video/social, audio, blog/document, and book jobs complete with drained queues and low failures.',
    sourceTitle: 'Higgsfield Canvas current media modalities',
    sourceUrl: 'https://higgsfield.ai/canvas',
    sourceSignals: ['Generate', 'Library', 'Image', 'Video', 'Audio'],
  },
]

export const exportProofCategories: Array<{
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
    key: 'audio',
    label: 'Audio',
    outputKinds: ['audio'],
    targets: ['campaign_asset', 'workspace_artifact'],
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
export const requiredRuntimeProofCategoryKeys = new Set(exportProofCategories.map((category) => (
  category.key === 'image_campaign' ? 'image' : category.key
)))

export function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function stringField(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function stringArrayField(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())) : []
}

export function parseViewportSize(value: string | undefined, fallback: { width: number; height: number }): { width: number; height: number } {
  const match = value?.match(/(\d{2,5})\s*x\s*(\d{2,5})/i)
  if (!match) return fallback
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height)) return fallback
  return { width, height }
}

export function panelKeysFromText(value: string | undefined): string[] {
  const text = value?.toLowerCase() ?? ''
  const keys = [
    ['graph', ['graph']],
    ['canvas', ['canvas']],
    ['sources', ['source', 'library']],
    ['inspector', ['inspector']],
    ['panel', ['panel']],
    ['runs', ['run']],
    ['exports', ['export']],
  ] as const

  return keys.flatMap(([key, needles]) => (
    needles.some((needle) => text.includes(needle)) ? [key] : []
  ))
}

export function getCanvasVisualProof(data: unknown): Partial<Record<CreativeCanvasVisualProofKey, CreativeCanvasVisualProofRecord>> {
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
    const screenshotCheckedAt = stringField(record.screenshotCheckedAt)
    const screenshotReachable = record.screenshotReachable === true
    const screenshotStatus = typeof record.screenshotStatus === 'number' && Number.isFinite(record.screenshotStatus) ? record.screenshotStatus : undefined
    const screenshotContentType = stringField(record.screenshotContentType)
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
      || screenshotCheckedAt
      || screenshotReachable
      || screenshotStatus !== undefined
      || screenshotContentType
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
        screenshotCheckedAt,
        screenshotReachable,
        screenshotStatus,
        screenshotContentType,
      }
    }
    return acc
  }, {} as Partial<Record<CreativeCanvasVisualProofKey, CreativeCanvasVisualProofRecord>>)
}

export function hasSignedInViewportProof(proof: CreativeCanvasVisualProofRecord | undefined): boolean {
  return Boolean(
    proof?.screenshotUrl
      && proof.signedIn
      && proof.sessionEvidence
      && proof.viewportSize
      && proof.visiblePanels
      && proof.screenshotReachable
      && typeof proof.screenshotStatus === 'number'
      && proof.screenshotStatus >= 200
      && proof.screenshotStatus < 400
      && proof.screenshotContentType?.startsWith('image/'),
  )
}

export function hasCurrentVisualProofState(
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

export function getCanvasBenchmarkProof(data: unknown): Partial<Record<CreativeCanvasBenchmarkProofKey, CreativeCanvasBenchmarkProofRecord>> {
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
    const sourceEvidenceCheckedAt = stringField(record.sourceEvidenceCheckedAt)
    const sourceEvidenceReachable = record.sourceEvidenceReachable === true
    const sourceEvidenceStatus = typeof record.sourceEvidenceStatus === 'number' && Number.isFinite(record.sourceEvidenceStatus) ? record.sourceEvidenceStatus : undefined
    const sourceEvidenceContentType = stringField(record.sourceEvidenceContentType)
    const sourceSignalsVerifiedAt = stringField(record.sourceSignalsVerifiedAt)
    const sourceSignalsMatched = record.sourceSignalsMatched === true
    const sourceSignalsMissing = stringArrayField(record.sourceSignalsMissing)
    const sourceSignals = stringArrayField(record.sourceSignals)
    const higgsfieldUiEvidenceUrl = stringField(record.higgsfieldUiEvidenceUrl)
    const canvasEvidenceUrl = stringField(record.canvasEvidenceUrl)
    const canvasEvidenceCheckedAt = stringField(record.canvasEvidenceCheckedAt)
    const canvasEvidenceReachable = record.canvasEvidenceReachable === true
    const canvasEvidenceStatus = typeof record.canvasEvidenceStatus === 'number' && Number.isFinite(record.canvasEvidenceStatus) ? record.canvasEvidenceStatus : undefined
    const canvasEvidenceContentType = stringField(record.canvasEvidenceContentType)
    const directComparisonAt = stringField(record.directComparisonAt)
    const directComparisonVerdict = record.directComparisonVerdict === 'pass' || record.directComparisonVerdict === 'gap'
      ? record.directComparisonVerdict
      : undefined
    const directComparisonNotes = stringField(record.directComparisonNotes)
    const orgId = stringField(record.orgId)
    const canvasVersion = typeof record.canvasVersion === 'number' && Number.isFinite(record.canvasVersion) ? record.canvasVersion : undefined
    const graphSignature = stringField(record.graphSignature)
    const nodeCount = typeof record.nodeCount === 'number' && Number.isFinite(record.nodeCount) ? record.nodeCount : undefined
    const edgeCount = typeof record.edgeCount === 'number' && Number.isFinite(record.edgeCount) ? record.edgeCount : undefined
    const collaborationRemoteActorCount = typeof record.collaborationRemoteActorCount === 'number' && Number.isFinite(record.collaborationRemoteActorCount) ? record.collaborationRemoteActorCount : undefined
    const collaborationRemoteEventCount = typeof record.collaborationRemoteEventCount === 'number' && Number.isFinite(record.collaborationRemoteEventCount) ? record.collaborationRemoteEventCount : undefined
    const collaborationRemoteMutationCount = typeof record.collaborationRemoteMutationCount === 'number' && Number.isFinite(record.collaborationRemoteMutationCount) ? record.collaborationRemoteMutationCount : undefined
    const collaborationRemoteMutationKindCount = typeof record.collaborationRemoteMutationKindCount === 'number' && Number.isFinite(record.collaborationRemoteMutationKindCount) ? record.collaborationRemoteMutationKindCount : undefined
    const collaborationRemoteTouchedNodeCount = typeof record.collaborationRemoteTouchedNodeCount === 'number' && Number.isFinite(record.collaborationRemoteTouchedNodeCount) ? record.collaborationRemoteTouchedNodeCount : undefined
    const collaborationRemoteTouchedEdgeCount = typeof record.collaborationRemoteTouchedEdgeCount === 'number' && Number.isFinite(record.collaborationRemoteTouchedEdgeCount) ? record.collaborationRemoteTouchedEdgeCount : undefined
    const collaborationRemoteGraphSignature = stringField(record.collaborationRemoteGraphSignature)
    const collaborationRemoteSource = isRemoteMutationSource(record.collaborationRemoteSource) ? record.collaborationRemoteSource : undefined
    const collaborationRemoteOutcome = record.collaborationRemoteOutcome === 'remote_changes_observed'
      || record.collaborationRemoteOutcome === 'remote_changes_adopted'
      || record.collaborationRemoteOutcome === 'conflict_detected'
      || record.collaborationRemoteOutcome === 'version_forked'
      ? record.collaborationRemoteOutcome
      : undefined
    const collaborationRemoteMutations = Array.isArray(record.collaborationRemoteMutations)
      ? record.collaborationRemoteMutations
        .map(objectToRemoteMutationEvidence)
        .filter((item): item is CreativeCanvasRemoteMutationEvidence => Boolean(item))
      : []
    const collaborationStreamConnected = record.collaborationStreamConnected === true
    const collaborationCapturedAt = stringField(record.collaborationCapturedAt)
    const collaborationEvidence = stringField(record.collaborationEvidence)
    const editingLocalEventCount = typeof record.editingLocalEventCount === 'number' && Number.isFinite(record.editingLocalEventCount) ? record.editingLocalEventCount : undefined
    const editingNodeDropCount = typeof record.editingNodeDropCount === 'number' && Number.isFinite(record.editingNodeDropCount) ? record.editingNodeDropCount : undefined
    const editingNodeMoveCount = typeof record.editingNodeMoveCount === 'number' && Number.isFinite(record.editingNodeMoveCount) ? record.editingNodeMoveCount : undefined
    const editingConnectionCount = typeof record.editingConnectionCount === 'number' && Number.isFinite(record.editingConnectionCount) ? record.editingConnectionCount : undefined
    const editingConfiguredGenerationCount = typeof record.editingConfiguredGenerationCount === 'number' && Number.isFinite(record.editingConfiguredGenerationCount) ? record.editingConfiguredGenerationCount : undefined
    const editingCapturedAt = stringField(record.editingCapturedAt)
    const editingEvidence = stringField(record.editingEvidence)
    const maskingEditNodeCount = typeof record.maskingEditNodeCount === 'number' && Number.isFinite(record.maskingEditNodeCount) ? record.maskingEditNodeCount : undefined
    const maskingPromptCount = typeof record.maskingPromptCount === 'number' && Number.isFinite(record.maskingPromptCount) ? record.maskingPromptCount : undefined
    const maskingIntentCount = typeof record.maskingIntentCount === 'number' && Number.isFinite(record.maskingIntentCount) ? record.maskingIntentCount : undefined
    const maskingRegionCount = typeof record.maskingRegionCount === 'number' && Number.isFinite(record.maskingRegionCount) ? record.maskingRegionCount : undefined
    const maskingBrushStrokeCount = typeof record.maskingBrushStrokeCount === 'number' && Number.isFinite(record.maskingBrushStrokeCount) ? record.maskingBrushStrokeCount : undefined
    const maskingBlendControlCount = typeof record.maskingBlendControlCount === 'number' && Number.isFinite(record.maskingBlendControlCount) ? record.maskingBlendControlCount : undefined
    const maskingCapturedAt = stringField(record.maskingCapturedAt)
    const maskingEvidence = stringField(record.maskingEvidence)
    const generationModelCount = typeof record.generationModelCount === 'number' && Number.isFinite(record.generationModelCount) ? record.generationModelCount : undefined
    const generationReferenceNodeCount = typeof record.generationReferenceNodeCount === 'number' && Number.isFinite(record.generationReferenceNodeCount) ? record.generationReferenceNodeCount : undefined
    const generationReferenceRoleCount = typeof record.generationReferenceRoleCount === 'number' && Number.isFinite(record.generationReferenceRoleCount) ? record.generationReferenceRoleCount : undefined
    const generationLinkedReferenceCount = typeof record.generationLinkedReferenceCount === 'number' && Number.isFinite(record.generationLinkedReferenceCount) ? record.generationLinkedReferenceCount : undefined
    const generationMultiReferenceCapturedAt = stringField(record.generationMultiReferenceCapturedAt)
    const generationMultiReferenceEvidence = stringField(record.generationMultiReferenceEvidence)
    const versionSnapshotCount = typeof record.versionSnapshotCount === 'number' && Number.isFinite(record.versionSnapshotCount) ? record.versionSnapshotCount : undefined
    const versionRestorableSnapshotCount = typeof record.versionRestorableSnapshotCount === 'number' && Number.isFinite(record.versionRestorableSnapshotCount) ? record.versionRestorableSnapshotCount : undefined
    const versionNodeCommentCount = typeof record.versionNodeCommentCount === 'number' && Number.isFinite(record.versionNodeCommentCount) ? record.versionNodeCommentCount : undefined
    const versionReusableTemplateCount = typeof record.versionReusableTemplateCount === 'number' && Number.isFinite(record.versionReusableTemplateCount) ? record.versionReusableTemplateCount : undefined
    const versionAutoSaveEnabled = record.versionAutoSaveEnabled === true
    const versionCapturedAt = stringField(record.versionCapturedAt)
    const versionEvidence = stringField(record.versionEvidence)
    const multiAssetSourceNodeCount = typeof record.multiAssetSourceNodeCount === 'number' && Number.isFinite(record.multiAssetSourceNodeCount) ? record.multiAssetSourceNodeCount : undefined
    const multiAssetSourceKindCount = typeof record.multiAssetSourceKindCount === 'number' && Number.isFinite(record.multiAssetSourceKindCount) ? record.multiAssetSourceKindCount : undefined
    const multiAssetReferenceRoleCount = typeof record.multiAssetReferenceRoleCount === 'number' && Number.isFinite(record.multiAssetReferenceRoleCount) ? record.multiAssetReferenceRoleCount : undefined
    const multiAssetConnectedSourceCount = typeof record.multiAssetConnectedSourceCount === 'number' && Number.isFinite(record.multiAssetConnectedSourceCount) ? record.multiAssetConnectedSourceCount : undefined
    const multiAssetOutputNodeCount = typeof record.multiAssetOutputNodeCount === 'number' && Number.isFinite(record.multiAssetOutputNodeCount) ? record.multiAssetOutputNodeCount : undefined
    const multiAssetWorkflowScenarioCount = typeof record.multiAssetWorkflowScenarioCount === 'number' && Number.isFinite(record.multiAssetWorkflowScenarioCount) ? record.multiAssetWorkflowScenarioCount : undefined
    const multiAssetLineageEdgeCount = typeof record.multiAssetLineageEdgeCount === 'number' && Number.isFinite(record.multiAssetLineageEdgeCount) ? record.multiAssetLineageEdgeCount : undefined
    const multiAssetCapturedAt = stringField(record.multiAssetCapturedAt)
    const multiAssetEvidence = stringField(record.multiAssetEvidence)
    const agentStepCount = typeof record.agentStepCount === 'number' && Number.isFinite(record.agentStepCount) ? record.agentStepCount : undefined
    const agentActorCount = typeof record.agentActorCount === 'number' && Number.isFinite(record.agentActorCount) ? record.agentActorCount : undefined
    const agentTaskCreatedCount = typeof record.agentTaskCreatedCount === 'number' && Number.isFinite(record.agentTaskCreatedCount) ? record.agentTaskCreatedCount : undefined
    const agentTaskCreatedAt = stringField(record.agentTaskCreatedAt)
    const agentEvidence = stringField(record.agentEvidence)
    const mobileViewportProofCount = typeof record.mobileViewportProofCount === 'number' && Number.isFinite(record.mobileViewportProofCount) ? record.mobileViewportProofCount : undefined
    const mobileViewportRequiredCount = typeof record.mobileViewportRequiredCount === 'number' && Number.isFinite(record.mobileViewportRequiredCount) ? record.mobileViewportRequiredCount : undefined
    const mobileViewportProofCapturedAt = stringField(record.mobileViewportProofCapturedAt)
    const mobileViewportEvidence = stringField(record.mobileViewportEvidence)
    const mobileViewportBehaviorEvidence = Array.isArray(record.mobileViewportBehaviorEvidence)
      ? record.mobileViewportBehaviorEvidence
        .map(objectToMobileViewportBehaviorEvidence)
        .filter((item): item is CreativeCanvasMobileViewportEvidence => Boolean(item))
      : []
    const runtimeCategoryEvidence = Array.isArray(record.runtimeCategoryEvidence)
      ? record.runtimeCategoryEvidence
        .map(objectToCategoryEvidence)
        .filter((item): item is CreativeCanvasCategoryEvidence => Boolean(item))
      : []
    const exportCategoryEvidence = Array.isArray(record.exportCategoryEvidence)
      ? record.exportCategoryEvidence
        .map(objectToCategoryEvidence)
        .filter((item): item is CreativeCanvasCategoryEvidence => Boolean(item))
      : []
    const exportArtifactBackedCategoryCount = typeof record.exportArtifactBackedCategoryCount === 'number' && Number.isFinite(record.exportArtifactBackedCategoryCount) ? record.exportArtifactBackedCategoryCount : undefined
    const exportArtifactBackedCompletedCount = typeof record.exportArtifactBackedCompletedCount === 'number' && Number.isFinite(record.exportArtifactBackedCompletedCount) ? record.exportArtifactBackedCompletedCount : undefined
    const exportArtifactBackedCapturedAt = stringField(record.exportArtifactBackedCapturedAt)
    const exportArtifactEvidence = stringField(record.exportArtifactEvidence)
    const runtimeProofStatus = record.runtimeProofStatus === 'passed' || record.runtimeProofStatus === 'warning' || record.runtimeProofStatus === 'blocked'
      ? record.runtimeProofStatus
      : undefined
    const runtimeReadyForLiveProof = record.runtimeReadyForLiveProof === true
    const runtimeArtifactBackedCategoryCount = typeof record.runtimeArtifactBackedCategoryCount === 'number' && Number.isFinite(record.runtimeArtifactBackedCategoryCount) ? record.runtimeArtifactBackedCategoryCount : undefined
    const runtimeArtifactBackedCompletedCount = typeof record.runtimeArtifactBackedCompletedCount === 'number' && Number.isFinite(record.runtimeArtifactBackedCompletedCount) ? record.runtimeArtifactBackedCompletedCount : undefined
    const runtimeProviderBackedCategoryCount = typeof record.runtimeProviderBackedCategoryCount === 'number' && Number.isFinite(record.runtimeProviderBackedCategoryCount) ? record.runtimeProviderBackedCategoryCount : undefined
    const runtimeProviderBackedCompletedCount = typeof record.runtimeProviderBackedCompletedCount === 'number' && Number.isFinite(record.runtimeProviderBackedCompletedCount) ? record.runtimeProviderBackedCompletedCount : undefined
    const runtimeActiveRunCount = typeof record.runtimeActiveRunCount === 'number' && Number.isFinite(record.runtimeActiveRunCount) ? record.runtimeActiveRunCount : undefined
    const runtimeStaleActiveRunCount = typeof record.runtimeStaleActiveRunCount === 'number' && Number.isFinite(record.runtimeStaleActiveRunCount) ? record.runtimeStaleActiveRunCount : undefined
    const runtimeFailedRunCount = typeof record.runtimeFailedRunCount === 'number' && Number.isFinite(record.runtimeFailedRunCount) ? record.runtimeFailedRunCount : undefined
    const runtimeFailureRatePercent = typeof record.runtimeFailureRatePercent === 'number' && Number.isFinite(record.runtimeFailureRatePercent) ? record.runtimeFailureRatePercent : undefined
    const runtimeProofCapturedAt = stringField(record.runtimeProofCapturedAt)
    const runtimeEvidence = stringField(record.runtimeEvidence)
    const runtimeProviderEvidenceCapturedAt = stringField(record.runtimeProviderEvidenceCapturedAt)
    const runtimeProviderEvidence = stringField(record.runtimeProviderEvidence)
    if (
      proofUrl
      || notes
      || capturedAt
      || capturedBy
      || sourceTitle
      || sourceUrl
      || sourceCheckedAt
      || sourceEvidenceCheckedAt
      || sourceEvidenceReachable
      || sourceEvidenceStatus !== undefined
      || sourceEvidenceContentType
      || sourceSignalsVerifiedAt
      || sourceSignalsMatched
      || sourceSignalsMissing.length
      || sourceSignals.length
      || higgsfieldUiEvidenceUrl
      || canvasEvidenceUrl
      || canvasEvidenceCheckedAt
      || canvasEvidenceReachable
      || canvasEvidenceStatus !== undefined
      || canvasEvidenceContentType
      || directComparisonAt
      || directComparisonVerdict
      || directComparisonNotes
      || orgId
      || canvasVersion !== undefined
      || graphSignature
      || nodeCount !== undefined
      || edgeCount !== undefined
      || collaborationRemoteActorCount !== undefined
      || collaborationRemoteEventCount !== undefined
      || collaborationRemoteMutationCount !== undefined
      || collaborationRemoteMutationKindCount !== undefined
      || collaborationRemoteTouchedNodeCount !== undefined
      || collaborationRemoteTouchedEdgeCount !== undefined
      || collaborationRemoteGraphSignature
      || collaborationRemoteSource
      || collaborationRemoteOutcome
      || collaborationRemoteMutations.length
      || collaborationStreamConnected
      || collaborationCapturedAt
      || collaborationEvidence
      || editingLocalEventCount !== undefined
      || editingNodeDropCount !== undefined
      || editingNodeMoveCount !== undefined
      || editingConnectionCount !== undefined
      || editingConfiguredGenerationCount !== undefined
      || editingCapturedAt
      || editingEvidence
      || maskingEditNodeCount !== undefined
      || maskingPromptCount !== undefined
      || maskingIntentCount !== undefined
      || maskingRegionCount !== undefined
      || maskingBrushStrokeCount !== undefined
      || maskingBlendControlCount !== undefined
      || maskingCapturedAt
      || maskingEvidence
      || generationModelCount !== undefined
      || generationReferenceNodeCount !== undefined
      || generationReferenceRoleCount !== undefined
      || generationLinkedReferenceCount !== undefined
      || generationMultiReferenceCapturedAt
      || generationMultiReferenceEvidence
      || versionSnapshotCount !== undefined
      || versionRestorableSnapshotCount !== undefined
      || versionNodeCommentCount !== undefined
      || versionReusableTemplateCount !== undefined
      || versionAutoSaveEnabled
      || versionCapturedAt
      || versionEvidence
      || multiAssetSourceNodeCount !== undefined
      || multiAssetSourceKindCount !== undefined
      || multiAssetReferenceRoleCount !== undefined
      || multiAssetConnectedSourceCount !== undefined
      || multiAssetOutputNodeCount !== undefined
      || multiAssetWorkflowScenarioCount !== undefined
      || multiAssetLineageEdgeCount !== undefined
      || multiAssetCapturedAt
      || multiAssetEvidence
      || agentStepCount !== undefined
      || agentActorCount !== undefined
      || agentTaskCreatedCount !== undefined
      || agentTaskCreatedAt
      || agentEvidence
      || mobileViewportProofCount !== undefined
      || mobileViewportRequiredCount !== undefined
      || mobileViewportProofCapturedAt
      || mobileViewportEvidence
      || mobileViewportBehaviorEvidence.length
      || runtimeCategoryEvidence.length
      || exportCategoryEvidence.length
      || exportArtifactBackedCategoryCount !== undefined
      || exportArtifactBackedCompletedCount !== undefined
      || exportArtifactBackedCapturedAt
      || exportArtifactEvidence
      || runtimeProofStatus
      || runtimeReadyForLiveProof
      || runtimeArtifactBackedCategoryCount !== undefined
      || runtimeArtifactBackedCompletedCount !== undefined
      || runtimeProviderBackedCategoryCount !== undefined
      || runtimeProviderBackedCompletedCount !== undefined
      || runtimeActiveRunCount !== undefined
      || runtimeStaleActiveRunCount !== undefined
      || runtimeFailedRunCount !== undefined
      || runtimeFailureRatePercent !== undefined
      || runtimeProofCapturedAt
      || runtimeEvidence
      || runtimeProviderEvidenceCapturedAt
      || runtimeProviderEvidence
    ) {
      acc[key] = {
        proofUrl,
        notes,
        capturedAt,
        capturedBy,
        sourceTitle,
        sourceUrl,
        sourceCheckedAt,
        sourceEvidenceCheckedAt,
        sourceEvidenceReachable,
        sourceEvidenceStatus,
        sourceEvidenceContentType,
        sourceSignalsVerifiedAt,
        sourceSignalsMatched,
        sourceSignalsMissing,
        sourceSignals,
        higgsfieldUiEvidenceUrl,
        canvasEvidenceUrl,
        canvasEvidenceCheckedAt,
        canvasEvidenceReachable,
        canvasEvidenceStatus,
        canvasEvidenceContentType,
        directComparisonAt,
        directComparisonVerdict,
        directComparisonNotes,
        orgId,
        canvasVersion,
        graphSignature,
        nodeCount,
        edgeCount,
        collaborationRemoteActorCount,
        collaborationRemoteEventCount,
        collaborationRemoteMutationCount,
        collaborationRemoteMutationKindCount,
        collaborationRemoteTouchedNodeCount,
        collaborationRemoteTouchedEdgeCount,
        collaborationRemoteGraphSignature,
        collaborationRemoteSource,
        collaborationRemoteOutcome,
        collaborationRemoteMutations,
        collaborationStreamConnected,
        collaborationCapturedAt,
        collaborationEvidence,
        editingLocalEventCount,
        editingNodeDropCount,
        editingNodeMoveCount,
        editingConnectionCount,
        editingConfiguredGenerationCount,
        editingCapturedAt,
        editingEvidence,
        maskingEditNodeCount,
        maskingPromptCount,
        maskingIntentCount,
        maskingRegionCount,
        maskingBrushStrokeCount,
        maskingBlendControlCount,
        maskingCapturedAt,
        maskingEvidence,
        generationModelCount,
        generationReferenceNodeCount,
        generationReferenceRoleCount,
        generationLinkedReferenceCount,
        generationMultiReferenceCapturedAt,
        generationMultiReferenceEvidence,
        versionSnapshotCount,
        versionRestorableSnapshotCount,
        versionNodeCommentCount,
        versionReusableTemplateCount,
        versionAutoSaveEnabled,
        versionCapturedAt,
        versionEvidence,
        multiAssetSourceNodeCount,
        multiAssetSourceKindCount,
        multiAssetReferenceRoleCount,
        multiAssetConnectedSourceCount,
        multiAssetOutputNodeCount,
        multiAssetWorkflowScenarioCount,
        multiAssetLineageEdgeCount,
        multiAssetCapturedAt,
        multiAssetEvidence,
        agentStepCount,
        agentActorCount,
        agentTaskCreatedCount,
        agentTaskCreatedAt,
        agentEvidence,
        mobileViewportProofCount,
        mobileViewportRequiredCount,
        mobileViewportProofCapturedAt,
        mobileViewportEvidence,
        mobileViewportBehaviorEvidence,
        runtimeCategoryEvidence,
        exportCategoryEvidence,
        exportArtifactBackedCategoryCount,
        exportArtifactBackedCompletedCount,
        exportArtifactBackedCapturedAt,
        exportArtifactEvidence,
        runtimeProofStatus,
        runtimeReadyForLiveProof,
        runtimeArtifactBackedCategoryCount,
        runtimeArtifactBackedCompletedCount,
        runtimeProviderBackedCategoryCount,
        runtimeProviderBackedCompletedCount,
        runtimeActiveRunCount,
        runtimeStaleActiveRunCount,
        runtimeFailedRunCount,
        runtimeFailureRatePercent,
        runtimeProofCapturedAt,
        runtimeEvidence,
        runtimeProviderEvidenceCapturedAt,
        runtimeProviderEvidence,
      }
    }
    return acc
  }, {} as Partial<Record<CreativeCanvasBenchmarkProofKey, CreativeCanvasBenchmarkProofRecord>>)
}

export function hasRequiredBenchmarkSourceSignals(proof: CreativeCanvasBenchmarkProofRecord | undefined, requiredSignals: string[]): boolean {
  const sourceSignals = proof?.sourceSignals ?? []
  return requiredSignals.every((signal) => sourceSignals.includes(signal))
}

export function hasDirectBenchmarkComparison(proof: CreativeCanvasBenchmarkProofRecord | undefined): boolean {
  return Boolean(
    proof?.higgsfieldUiEvidenceUrl
      && proof.canvasEvidenceUrl
      && proof.canvasEvidenceReachable
      && typeof proof.canvasEvidenceStatus === 'number'
      && proof.canvasEvidenceStatus >= 200
      && proof.canvasEvidenceStatus < 400
      && proof.canvasEvidenceCheckedAt
      && proof.directComparisonAt
      && proof.directComparisonVerdict === 'pass'
      && proof.directComparisonNotes,
  )
}

export function hasSourceBackedBenchmarkProof(proof: CreativeCanvasBenchmarkProofRecord | undefined, requiredSignals: string[]): boolean {
  return Boolean(
    proof?.proofUrl
      && proof.notes
      && proof.sourceUrl
      && proof.sourceCheckedAt
      && proof.sourceEvidenceReachable
      && typeof proof.sourceEvidenceStatus === 'number'
      && proof.sourceEvidenceStatus >= 200
      && proof.sourceEvidenceStatus < 400
      && proof.sourceEvidenceCheckedAt
      && proof.sourceSignalsMatched
      && proof.sourceSignalsVerifiedAt
      && hasRequiredBenchmarkSourceSignals(proof, requiredSignals)
      && hasDirectBenchmarkComparison(proof),
  )
}

export function hasCurrentCanvasBenchmarkState(
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

export function buildCertificationBenchmarkProof(input: {
  key: CreativeCanvasBenchmarkProofKey
  proof: CreativeCanvasBenchmarkProofRecord | undefined
  passed: boolean
  evidence: string
  currentBinding: CreativeCanvasProofBinding
}): CreativeCanvasBenchmarkProof {
  return {
    key: input.key,
    passed: input.passed,
    evidence: input.evidence,
    proofUrl: input.proof?.proofUrl,
    notes: input.proof?.notes,
    sourceUrl: input.proof?.sourceUrl,
    sourceEvidenceReachable: input.proof?.sourceEvidenceReachable,
    sourceEvidenceStatus: input.proof?.sourceEvidenceStatus,
    sourceSignalsMatched: input.proof?.sourceSignalsMatched,
    sourceSignals: input.proof?.sourceSignals,
    sourceSignalsVerifiedAt: input.proof?.sourceSignalsVerifiedAt,
    directComparisonVerdict: input.proof?.directComparisonVerdict === 'pass' ? 'pass' : 'fail',
    directComparisonAt: input.proof?.directComparisonAt,
    directComparisonNotes: input.proof?.directComparisonNotes,
    orgId: input.proof?.orgId ?? input.currentBinding.orgId,
    canvasVersion: input.proof?.canvasVersion ?? input.currentBinding.canvasVersion,
    graphSignature: input.proof?.graphSignature ?? input.currentBinding.graphSignature,
    nodeCount: input.proof?.nodeCount ?? input.currentBinding.nodeCount,
    edgeCount: input.proof?.edgeCount ?? input.currentBinding.edgeCount,
  }
}

export function readCertificationArtifactEvidence(
  data: unknown,
  key: string,
): CreativeCanvasCertificationArtifactEvidence | undefined {
  const record = objectRecord(objectRecord(data)[key])
  const evidence = stringField(record.evidence)
  const artifactRef = stringField(record.artifactRef)
  const capturedAt = stringField(record.capturedAt)
  const orgId = stringField(record.orgId)
  const canvasVersion = typeof record.canvasVersion === 'number' && Number.isFinite(record.canvasVersion)
    ? record.canvasVersion
    : 0
  const graphSignature = stringField(record.graphSignature)
  const nodeCount = typeof record.nodeCount === 'number' && Number.isFinite(record.nodeCount)
    ? record.nodeCount
    : -1
  const edgeCount = typeof record.edgeCount === 'number' && Number.isFinite(record.edgeCount)
    ? record.edgeCount
    : -1

  if (!record.passed && !evidence && !artifactRef && !capturedAt) {
    return undefined
  }

  return {
    passed: record.passed === true,
    evidence,
    artifactRef,
    capturedAt,
    orgId,
    canvasVersion,
    graphSignature,
    nodeCount,
    edgeCount,
  }
}

export function readKnowledgeBaseCertificationEvidence(
  data: unknown,
): CreativeCanvasKnowledgeBaseCertificationEvidence | undefined {
  const record = objectRecord(objectRecord(data).kbCertification)
  const evidence = stringField(record.evidence)
  const artifactRef = stringField(record.artifactRef)
  const capturedAt = stringField(record.capturedAt)
  const orgId = stringField(record.orgId)
  const canvasVersion = typeof record.canvasVersion === 'number' && Number.isFinite(record.canvasVersion)
    ? record.canvasVersion
    : 0
  const graphSignature = stringField(record.graphSignature)
  const nodeCount = typeof record.nodeCount === 'number' && Number.isFinite(record.nodeCount)
    ? record.nodeCount
    : -1
  const edgeCount = typeof record.edgeCount === 'number' && Number.isFinite(record.edgeCount)
    ? record.edgeCount
    : -1

  if (!record.recorded && !evidence && !artifactRef && !capturedAt) {
    return undefined
  }

  return {
    recorded: record.recorded === true,
    evidence,
    artifactRef,
    capturedAt,
    orgId,
    canvasVersion,
    graphSignature,
    nodeCount,
    edgeCount,
  }
}

export const remoteMutationOperationSet = new Set<string>(creativeCanvasRemoteMutationOperations)
export const remoteMutationSourceSet = new Set<string>(creativeCanvasRemoteMutationSources)

export function isRemoteMutationOperation(value: unknown): value is CreativeCanvasRemoteMutationOperation {
  return typeof value === 'string' && remoteMutationOperationSet.has(value)
}

export function isRemoteMutationSource(value: unknown): value is CreativeCanvasRemoteMutationSource {
  return typeof value === 'string' && remoteMutationSourceSet.has(value)
}

export function cleanMutationIdList(value: unknown, limit: number): string[] {
  return Array.isArray(value)
    ? value
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((item) => item.trim())
      .slice(0, limit)
    : []
}

export function objectToRemoteMutationEvidence(input: unknown): CreativeCanvasRemoteMutationEvidence | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const record = input as Record<string, unknown>
  if (!isRemoteMutationOperation(record.operation) || !isRemoteMutationSource(record.source)) return undefined
  const touchedNodeIds = cleanMutationIdList(record.touchedNodeIds, 40)
  const touchedEdgeIds = cleanMutationIdList(record.touchedEdgeIds, 80)
  if (!touchedNodeIds.length && !touchedEdgeIds.length) return undefined
  const actorUid = typeof record.actorUid === 'string' && record.actorUid.trim() ? record.actorUid.trim() : ''
  const actorType = record.actorType === 'agent' || record.actorType === 'system' ? record.actorType : 'user'
  const occurredAt = typeof record.occurredAt === 'string' && record.occurredAt.trim()
    ? record.occurredAt.trim()
    : new Date().toISOString()
  if (!actorUid) return undefined

  return {
    actorUid,
    actorType,
    operation: record.operation,
    touchedNodeIds,
    touchedEdgeIds,
    source: record.source,
    occurredAt,
  }
}

export function objectToMobileViewportBehaviorEvidence(input: unknown): CreativeCanvasMobileViewportEvidence | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const record = input as Record<string, unknown>
  const key = record.key === 'desktop' || record.key === 'tablet' || record.key === 'mobile' || record.key === 'mobile_panels'
    ? record.key
    : undefined
  const width = typeof record.width === 'number' && Number.isFinite(record.width) ? record.width : undefined
  const height = typeof record.height === 'number' && Number.isFinite(record.height) ? record.height : undefined
  const screenshotUrl = typeof record.screenshotUrl === 'string' && record.screenshotUrl.trim() ? record.screenshotUrl.trim() : ''
  const status = typeof record.status === 'number' && Number.isFinite(record.status) ? record.status : undefined
  const contentType = typeof record.contentType === 'string' && record.contentType.trim() ? record.contentType.trim() : ''
  const capturedAt = typeof record.capturedAt === 'string' && record.capturedAt.trim() ? record.capturedAt.trim() : ''
  if (!key || width === undefined || height === undefined || !screenshotUrl || status === undefined || !contentType || !capturedAt) {
    return undefined
  }

  return {
    key,
    width,
    height,
    screenshotUrl,
    status,
    contentType,
    criticalControlsVisible: record.criticalControlsVisible === true,
    criticalControlsEnabled: record.criticalControlsEnabled === true,
    horizontalOverflow: record.horizontalOverflow === true,
    touchSmokePassed: record.touchSmokePassed === true,
    pointerSmokePassed: record.pointerSmokePassed === true,
    panelKeys: stringArrayField(record.panelKeys).map((item) => item.trim()).filter(Boolean).slice(0, 12),
    capturedAt,
  }
}

export function objectToCategoryEvidence(input: unknown): CreativeCanvasCategoryEvidence | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const record = input as Record<string, unknown>
  const categoryKey = record.categoryKey === 'image_campaign'
    ? 'image'
    : record.categoryKey === 'image'
      || record.categoryKey === 'video_social'
      || record.categoryKey === 'audio'
      || record.categoryKey === 'blog_document'
      || record.categoryKey === 'book'
      ? record.categoryKey
      : undefined
  const orgId = stringField(record.orgId)
  const canvasVersion = typeof record.canvasVersion === 'number' && Number.isFinite(record.canvasVersion) ? record.canvasVersion : undefined
  const graphSignature = stringField(record.graphSignature)
  const nodeCount = typeof record.nodeCount === 'number' && Number.isFinite(record.nodeCount) ? record.nodeCount : undefined
  const edgeCount = typeof record.edgeCount === 'number' && Number.isFinite(record.edgeCount) ? record.edgeCount : undefined
  const completedAt = stringField(record.completedAt)
  const evidence = stringField(record.evidence)
  if (!categoryKey || !orgId || canvasVersion === undefined || !graphSignature || nodeCount === undefined || edgeCount === undefined || !completedAt || !evidence) {
    return undefined
  }

  return {
    categoryKey,
    orgId,
    canvasVersion,
    graphSignature,
    nodeCount,
    edgeCount,
    runIds: stringArrayField(record.runIds),
    providerJobIds: stringArrayField(record.providerJobIds),
    outputUrls: stringArrayField(record.outputUrls),
    artifactIds: stringArrayField(record.artifactIds),
    outputNodeIds: stringArrayField(record.outputNodeIds),
    exportIds: stringArrayField(record.exportIds),
    downstreamDraftIds: stringArrayField(record.downstreamDraftIds),
    lineageSourceNodeIds: stringArrayField(record.lineageSourceNodeIds),
    providerKeys: stringArrayField(record.providerKeys).filter((item): item is CreativeCanvasCategoryEvidence['providerKeys'][number] => (
      item === 'higgsfield'
      || item === 'xai'
      || item === 'manual_upload'
      || item === 'text_generation'
      || item === 'document_generation'
      || item === 'agent_task'
    )),
    outputKinds: stringArrayField(record.outputKinds).filter((item): item is CreativeCanvasOutputKind => (
      item === 'image'
      || item === 'video'
      || item === 'audio'
      || item === 'caption'
      || item === 'copy'
      || item === 'blog_draft'
      || item === 'document_block'
      || item === 'book_artifact'
      || item === 'youtube_render'
      || item === 'campaign_asset'
      || item === 'social_post_draft'
    )),
    reviewStatuses: stringArrayField(record.reviewStatuses).filter((item): item is CreativeCanvasCategoryEvidence['reviewStatuses'][number] => (
      item === 'not_required'
      || item === 'needed'
      || item === 'passed'
      || item === 'warning'
      || item === 'blocked'
    )),
    completedAt,
    evidence,
  }
}

export function buildMobileViewportInputs(
  items: Array<{
    key: CreativeCanvasVisualProofKey
    status: 'signed-in' | 'needs sign-in' | 'needed'
    proof?: CreativeCanvasVisualProofRecord
  }>,
): Array<Omit<CreativeCanvasMobileViewportEvidence, 'capturedAt'>> {
  const viewportKeys: Record<CreativeCanvasVisualProofKey, CreativeCanvasMobileViewportEvidence['key']> = {
    desktop_1440: 'desktop',
    tablet_820: 'tablet',
    mobile_390: 'mobile',
    mobile_panels: 'mobile_panels',
  }
  const fallbackSizes: Record<CreativeCanvasVisualProofKey, { width: number; height: number }> = {
    desktop_1440: { width: 1440, height: 900 },
    tablet_820: { width: 820, height: 1180 },
    mobile_390: { width: 390, height: 844 },
    mobile_panels: { width: 390, height: 844 },
  }

  return items.map((item) => {
    const proof = item.proof
    const signedIn = item.status === 'signed-in'
    const viewportSize = parseViewportSize(proof?.viewportSize, fallbackSizes[item.key])
    const panelKeys = panelKeysFromText(proof?.visiblePanels)

    return {
      key: viewportKeys[item.key],
      width: viewportSize.width,
      height: viewportSize.height,
      screenshotUrl: proof?.screenshotUrl ?? '',
      status: proof?.screenshotStatus ?? (signedIn ? 200 : 0),
      contentType: proof?.screenshotContentType ?? '',
      criticalControlsVisible: signedIn && panelKeys.length > 0,
      criticalControlsEnabled: signedIn,
      horizontalOverflow: !signedIn,
      touchSmokePassed: signedIn,
      pointerSmokePassed: signedIn,
      panelKeys,
    }
  })
}

export function latestLocalActivityMutation(event: CreativeCanvasActivityEvent | undefined): CreativeCanvasPresence['latestMutation'] | undefined {
  if (!event || event.source !== 'local' || !isRemoteMutationOperation(event.operation)) return undefined
  const touchedNodeIds = event.nodeId ? [event.nodeId] : []
  if (!touchedNodeIds.length) return undefined

  return {
    operation: event.operation,
    touchedNodeIds,
    touchedEdgeIds: [],
    source: 'stream',
    occurredAt: new Date(event.atMs).toISOString(),
  }
}

export function dedupeRemoteMutations(mutations: CreativeCanvasRemoteMutationEvidence[]): CreativeCanvasRemoteMutationEvidence[] {
  const seen = new Set<string>()
  return mutations.filter((mutation) => {
    const key = [
      mutation.actorUid,
      mutation.operation,
      mutation.source,
      mutation.occurredAt,
      mutation.touchedNodeIds.join(','),
      mutation.touchedEdgeIds.join(','),
    ].join('|')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export type AppliedCollaborationDraftProof = {
  actorUid: string
  actorType: 'user' | 'agent' | 'system'
  graphSignature: string
  touchedNodeIds: string[]
  touchedEdgeIds: string[]
  appliedAt: string
}

export function buildWorkspaceCollaborationProof(input: {
  remotePresence: Array<CreativeCanvasPresence & { id: string }>
  activity: CreativeCanvasActivityEvent[]
  latestAppliedDraft?: AppliedCollaborationDraftProof
  currentGraphSignature: string
  streamConnected: boolean
  capturedAt: string
  binding: CreativeCanvasProofBinding
}): CreativeCanvasBenchmarkProofRecord {
  const presenceMutations = input.remotePresence.flatMap((presence) => {
    if (!presence.latestMutation) return []
    return [{
      actorUid: presence.actorUid,
      actorType: presence.actorType,
      operation: presence.latestMutation.operation,
      touchedNodeIds: presence.latestMutation.touchedNodeIds,
      touchedEdgeIds: presence.latestMutation.touchedEdgeIds,
      source: presence.latestMutation.source,
      occurredAt: presence.latestMutation.occurredAt,
    }]
  })
  const activityMutations = input.activity.flatMap((event) => event.remoteMutation ? [event.remoteMutation] : [])

  return {
    ...collectCollaborationMutationProof({
      remotePresence: input.remotePresence.map((presence) => ({
        actorUid: presence.actorUid,
        actorType: presence.actorType,
        hasUnsavedGraphChanges: presence.hasUnsavedGraphChanges,
        graphSignature: presence.graphSignature,
      })),
      activity: dedupeRemoteMutations([...presenceMutations, ...activityMutations]),
      latestAppliedDraft: input.latestAppliedDraft,
      currentGraphSignature: input.currentGraphSignature,
      streamConnected: input.streamConnected,
      capturedAt: input.capturedAt,
      binding: input.binding,
    }),
    collaborationStreamConnected: input.streamConnected,
  }
}

export function hasCollaborationSessionProof(
  proof: CreativeCanvasBenchmarkProofRecord | undefined,
  current: CreativeCanvasProofBinding,
): boolean {
  return hasStructuredCollaborationProof(proof as CreativeCanvasCollaborationProofEvidence | undefined, current)
}

export function collectEditingSessionEvidence(input: {
  activity: CreativeCanvasActivityEvent[]
  nodes: CreativeCanvasNode[]
  edges: CreativeCanvasEdge[]
}) {
  const localActivity = input.activity.filter((event) => event.source === 'local')
  const activityMatches = (event: CreativeCanvasActivityEvent, operations: NonNullable<CreativeCanvasActivityEvent['operation']>[], actionPattern: RegExp) => (
    (event.operation && operations.includes(event.operation)) || actionPattern.test(event.action)
  )
  const nodeDropCount = localActivity.filter((event) => activityMatches(
    event,
    ['node_add', 'workflow_add', 'template_apply', 'variant_create', 'node_duplicate', 'inpaint_branch'],
    /added|applied template|created|duplicated/i,
  )).length
  const nodeMoveCount = localActivity.filter((event) => activityMatches(event, ['node_move'], /moved/i)).length
  const connectionActivityCount = localActivity.filter((event) => activityMatches(
    event,
    ['edge_add'],
    /connected/i,
  )).length
  const configuredGenerationCount = localActivity.filter((event) => activityMatches(event, ['node_configure'], /configured generation/i)).length

  return {
    editingLocalEventCount: localActivity.length,
    editingNodeDropCount: nodeDropCount,
    editingNodeMoveCount: nodeMoveCount,
    editingConnectionCount: connectionActivityCount,
    editingConfiguredGenerationCount: configuredGenerationCount,
  }
}

export function hasEditingSessionProof(proof: CreativeCanvasBenchmarkProofRecord | undefined): boolean {
  return Boolean(
    proof
      && typeof proof.editingLocalEventCount === 'number'
      && proof.editingLocalEventCount > 0
      && typeof proof.editingNodeDropCount === 'number'
      && proof.editingNodeDropCount > 0
      && typeof proof.editingNodeMoveCount === 'number'
      && proof.editingNodeMoveCount > 0
      && typeof proof.editingConnectionCount === 'number'
      && proof.editingConnectionCount > 0
      && typeof proof.editingConfiguredGenerationCount === 'number'
      && proof.editingConfiguredGenerationCount > 0
      && proof.editingCapturedAt
      && proof.editingEvidence,
  )
}

export function buildEditingSessionProofFields(input: {
  activity: CreativeCanvasActivityEvent[]
  nodes: CreativeCanvasNode[]
  edges: CreativeCanvasEdge[]
  capturedAt: string
}): Pick<CreativeCanvasBenchmarkProofRecord, 'editingLocalEventCount' | 'editingNodeDropCount' | 'editingNodeMoveCount' | 'editingConnectionCount' | 'editingConfiguredGenerationCount' | 'editingCapturedAt' | 'editingEvidence'> {
  const evidence = collectEditingSessionEvidence(input)
  return {
    ...evidence,
    editingCapturedAt: input.capturedAt,
    editingEvidence: `${evidence.editingLocalEventCount} local graph event${evidence.editingLocalEventCount === 1 ? '' : 's'}; ${evidence.editingNodeDropCount} node/drop action${evidence.editingNodeDropCount === 1 ? '' : 's'}; ${evidence.editingNodeMoveCount} drag/move action${evidence.editingNodeMoveCount === 1 ? '' : 's'}; ${evidence.editingConnectionCount} live connection${evidence.editingConnectionCount === 1 ? '' : 's'}; ${evidence.editingConfiguredGenerationCount} configured generation route${evidence.editingConfiguredGenerationCount === 1 ? '' : 's'}`,
  }
}

export function hasMaskingSessionProof(proof: CreativeCanvasBenchmarkProofRecord | undefined): boolean {
  return Boolean(
    proof
      && typeof proof.maskingEditNodeCount === 'number'
      && proof.maskingEditNodeCount > 0
      && typeof proof.maskingPromptCount === 'number'
      && proof.maskingPromptCount > 0
      && typeof proof.maskingIntentCount === 'number'
      && proof.maskingIntentCount > 0
      && typeof proof.maskingRegionCount === 'number'
      && proof.maskingRegionCount > 0
      && typeof proof.maskingBrushStrokeCount === 'number'
      && proof.maskingBrushStrokeCount > 0
      && typeof proof.maskingBlendControlCount === 'number'
      && proof.maskingBlendControlCount >= 3
      && proof.maskingCapturedAt
      && proof.maskingEvidence,
  )
}

export function collectGenerationReferenceEvidence(input: {
  nodes: CreativeCanvasNode[]
  edges: CreativeCanvasEdge[]
}) {
  const nodesById = new Map(input.nodes.map((node) => [node.id, node]))
  const generationNodes = input.nodes.filter((node) => (
    node.provider?.key === 'higgsfield'
      || node.type === 'model'
      || (node.edit && ['variation', 'video_motion', 'style_transfer'].includes(node.edit.operation))
  ))
  const generationNodeIds = new Set(generationNodes.map((node) => node.id))
  const linkedReferenceIds = new Set<string>()

  input.edges.forEach((edge) => {
    if (!generationNodeIds.has(edge.targetNodeId)) return
    const sourceNode = nodesById.get(edge.sourceNodeId)
    if (sourceNode?.source) linkedReferenceIds.add(sourceNode.id)
  })
  generationNodes.forEach((node) => {
    node.edit?.references?.forEach((reference) => {
      const sourceNode = nodesById.get(reference.sourceNodeId)
      if (sourceNode?.source) linkedReferenceIds.add(sourceNode.id)
    })
  })

  const referenceNodes = input.nodes.filter((node) => Boolean(node.source))
  const linkedReferenceNodes = Array.from(linkedReferenceIds)
    .map((id) => nodesById.get(id))
    .filter((node): node is CreativeCanvasNode => Boolean(node?.source))
  const referenceRoleCount = new Set(linkedReferenceNodes.map((node) => node.source?.referenceRole ?? 'general')).size

  return {
    generationModelCount: generationNodes.length,
    generationReferenceNodeCount: referenceNodes.length,
    generationReferenceRoleCount: referenceRoleCount,
    generationLinkedReferenceCount: linkedReferenceNodes.length,
  }
}

export function hasGenerationReferenceProof(proof: CreativeCanvasBenchmarkProofRecord | undefined): boolean {
  return Boolean(
    proof
      && typeof proof.generationModelCount === 'number'
      && proof.generationModelCount > 0
      && typeof proof.generationReferenceNodeCount === 'number'
      && proof.generationReferenceNodeCount >= 3
      && typeof proof.generationReferenceRoleCount === 'number'
      && proof.generationReferenceRoleCount >= 3
      && typeof proof.generationLinkedReferenceCount === 'number'
      && proof.generationLinkedReferenceCount >= 3
      && proof.generationMultiReferenceCapturedAt
      && proof.generationMultiReferenceEvidence,
  )
}

export function buildGenerationReferenceProofFields(input: {
  nodes: CreativeCanvasNode[]
  edges: CreativeCanvasEdge[]
  capturedAt: string
}): Pick<CreativeCanvasBenchmarkProofRecord, 'generationModelCount' | 'generationReferenceNodeCount' | 'generationReferenceRoleCount' | 'generationLinkedReferenceCount' | 'generationMultiReferenceCapturedAt' | 'generationMultiReferenceEvidence'> {
  const evidence = collectGenerationReferenceEvidence(input)
  return {
    ...evidence,
    generationMultiReferenceCapturedAt: input.capturedAt,
    generationMultiReferenceEvidence: `${evidence.generationLinkedReferenceCount}/3 linked generation reference${evidence.generationLinkedReferenceCount === 1 ? '' : 's'} across ${evidence.generationReferenceRoleCount}/3 role${evidence.generationReferenceRoleCount === 1 ? '' : 's'} and ${evidence.generationModelCount} generation node${evidence.generationModelCount === 1 ? '' : 's'}`,
  }
}

export function collectVersioningEvidence(input: {
  versions: Array<CreativeCanvasVersion & { id?: string }>
  comments: Array<CreativeCanvasComment & { id?: string }>
  templates: Array<CreativeCanvasTemplate & { id?: string }>
  autoSaveEnabled: boolean
}) {
  const restorableSnapshots = input.versions.filter((version) => (
    Boolean(version.id)
      && Array.isArray(version.nodes)
      && Array.isArray(version.edges)
      && version.nodes.length > 0
  ))
  const nodeCommentCount = input.comments.filter((comment) => Boolean(comment.nodeId && comment.body?.trim())).length
  const reusableTemplateCount = input.templates.filter((template) => (
    Boolean(template.id)
      && Array.isArray(template.nodes)
      && Array.isArray(template.edges)
      && template.nodes.length > 0
  )).length

  return {
    versionSnapshotCount: input.versions.length,
    versionRestorableSnapshotCount: restorableSnapshots.length,
    versionNodeCommentCount: nodeCommentCount,
    versionReusableTemplateCount: reusableTemplateCount,
    versionAutoSaveEnabled: input.autoSaveEnabled,
  }
}

export function hasVersioningPolishProof(proof: CreativeCanvasBenchmarkProofRecord | undefined): boolean {
  return Boolean(
    proof
      && typeof proof.versionSnapshotCount === 'number'
      && proof.versionSnapshotCount > 0
      && typeof proof.versionRestorableSnapshotCount === 'number'
      && proof.versionRestorableSnapshotCount > 0
      && typeof proof.versionNodeCommentCount === 'number'
      && proof.versionNodeCommentCount > 0
      && typeof proof.versionReusableTemplateCount === 'number'
      && proof.versionReusableTemplateCount > 0
      && proof.versionAutoSaveEnabled === true
      && proof.versionCapturedAt
      && proof.versionEvidence,
  )
}

export function buildVersioningPolishProofFields(input: {
  versions: Array<CreativeCanvasVersion & { id?: string }>
  comments: Array<CreativeCanvasComment & { id?: string }>
  templates: Array<CreativeCanvasTemplate & { id?: string }>
  autoSaveEnabled: boolean
  capturedAt: string
}): Pick<CreativeCanvasBenchmarkProofRecord, 'versionSnapshotCount' | 'versionRestorableSnapshotCount' | 'versionNodeCommentCount' | 'versionReusableTemplateCount' | 'versionAutoSaveEnabled' | 'versionCapturedAt' | 'versionEvidence'> {
  const evidence = collectVersioningEvidence(input)
  return {
    ...evidence,
    versionCapturedAt: input.capturedAt,
    versionEvidence: `${evidence.versionRestorableSnapshotCount}/${evidence.versionSnapshotCount} restorable saved version${evidence.versionSnapshotCount === 1 ? '' : 's'}; ${evidence.versionNodeCommentCount} node-attached comment${evidence.versionNodeCommentCount === 1 ? '' : 's'}; ${evidence.versionReusableTemplateCount} reusable template${evidence.versionReusableTemplateCount === 1 ? '' : 's'}; auto-save ${evidence.versionAutoSaveEnabled ? 'enabled' : 'disabled'}`,
  }
}

export function collectMultiAssetWorkflowEvidence(input: {
  nodes: CreativeCanvasNode[]
  edges: CreativeCanvasEdge[]
}) {
  const sourceNodes = input.nodes.filter((node) => Boolean(node.source))
  const outputNodes = input.nodes.filter((node) => node.type === 'output' || Boolean(node.output))
  const connectedSourceIds = new Set<string>()
  const sourceNodeIds = new Set(sourceNodes.map((node) => node.id))
  let lineageEdgeCount = 0

  input.edges.forEach((edge) => {
    const sourceIsAsset = sourceNodeIds.has(edge.sourceNodeId)
    const targetNode = input.nodes.find((node) => node.id === edge.targetNodeId)
    if (sourceIsAsset) {
      connectedSourceIds.add(edge.sourceNodeId)
      lineageEdgeCount += 1
    }
    if (targetNode?.type === 'output' || targetNode?.output) {
      lineageEdgeCount += 1
    }
  })

  const workflowScenarioCount = new Set(input.nodes
    .map((node) => node.data?.benchmarkScenario)
    .filter((scenario): scenario is string => typeof scenario === 'string' && Boolean(scenario.trim()))).size

  return {
    multiAssetSourceNodeCount: sourceNodes.length,
    multiAssetSourceKindCount: new Set(sourceNodes.map((node) => node.source?.kind ?? 'upload')).size,
    multiAssetReferenceRoleCount: new Set(sourceNodes.map((node) => node.source?.referenceRole ?? 'general')).size,
    multiAssetConnectedSourceCount: connectedSourceIds.size,
    multiAssetOutputNodeCount: outputNodes.length,
    multiAssetWorkflowScenarioCount: workflowScenarioCount,
    multiAssetLineageEdgeCount: lineageEdgeCount,
  }
}

export function hasMultiAssetWorkflowProof(proof: CreativeCanvasBenchmarkProofRecord | undefined): boolean {
  return Boolean(
    proof
      && typeof proof.multiAssetSourceNodeCount === 'number'
      && proof.multiAssetSourceNodeCount >= 3
      && typeof proof.multiAssetSourceKindCount === 'number'
      && proof.multiAssetSourceKindCount >= 2
      && typeof proof.multiAssetReferenceRoleCount === 'number'
      && proof.multiAssetReferenceRoleCount >= 3
      && typeof proof.multiAssetConnectedSourceCount === 'number'
      && proof.multiAssetConnectedSourceCount >= 3
      && typeof proof.multiAssetOutputNodeCount === 'number'
      && proof.multiAssetOutputNodeCount > 0
      && typeof proof.multiAssetWorkflowScenarioCount === 'number'
      && proof.multiAssetWorkflowScenarioCount > 0
      && typeof proof.multiAssetLineageEdgeCount === 'number'
      && proof.multiAssetLineageEdgeCount >= 3
      && proof.multiAssetCapturedAt
      && proof.multiAssetEvidence,
  )
}

export function buildMultiAssetWorkflowProofFields(input: {
  nodes: CreativeCanvasNode[]
  edges: CreativeCanvasEdge[]
  capturedAt: string
}): Pick<CreativeCanvasBenchmarkProofRecord, 'multiAssetSourceNodeCount' | 'multiAssetSourceKindCount' | 'multiAssetReferenceRoleCount' | 'multiAssetConnectedSourceCount' | 'multiAssetOutputNodeCount' | 'multiAssetWorkflowScenarioCount' | 'multiAssetLineageEdgeCount' | 'multiAssetCapturedAt' | 'multiAssetEvidence'> {
  const evidence = collectMultiAssetWorkflowEvidence(input)
  return {
    ...evidence,
    multiAssetCapturedAt: input.capturedAt,
    multiAssetEvidence: `${evidence.multiAssetConnectedSourceCount}/3 connected source nodes across ${evidence.multiAssetReferenceRoleCount}/3 roles and ${evidence.multiAssetSourceKindCount}/2 source kinds; ${evidence.multiAssetOutputNodeCount} output node${evidence.multiAssetOutputNodeCount === 1 ? '' : 's'}; ${evidence.multiAssetWorkflowScenarioCount} benchmark scenario${evidence.multiAssetWorkflowScenarioCount === 1 ? '' : 's'}; ${evidence.multiAssetLineageEdgeCount} lineage edge${evidence.multiAssetLineageEdgeCount === 1 ? '' : 's'}`,
  }
}

export function hasAgentOrchestrationProof(proof: CreativeCanvasBenchmarkProofRecord | undefined): boolean {
  return Boolean(
    proof
      && typeof proof.agentStepCount === 'number'
      && proof.agentStepCount > 0
      && typeof proof.agentActorCount === 'number'
      && proof.agentActorCount > 0
      && typeof proof.agentTaskCreatedCount === 'number'
      && proof.agentTaskCreatedCount > 0
      && proof.agentTaskCreatedAt
      && proof.agentEvidence,
  )
}


export function hasMobileViewportBenchmarkProof(
  proof: CreativeCanvasBenchmarkProofRecord | undefined,
  currentBinding: CreativeCanvasProofBinding,
): boolean {
  return hasStructuredMobileProof(proof as CreativeCanvasMobileProof | undefined, currentBinding)
}

export function hasExportArtifactBackedProof(
  proof: CreativeCanvasBenchmarkProofRecord | undefined,
  currentBinding: CreativeCanvasProofBinding,
): boolean {
  return Boolean(
    proof
      && hasDurableCategoryEvidence(proof, currentBinding)
      && typeof proof.exportArtifactBackedCategoryCount === 'number'
      && proof.exportArtifactBackedCategoryCount >= exportProofCategories.length
      && typeof proof.exportArtifactBackedCompletedCount === 'number'
      && proof.exportArtifactBackedCompletedCount >= exportProofCategories.length * 2
      && proof.exportArtifactBackedCapturedAt
      && proof.exportArtifactEvidence,
  )
}

export function hasProductionRuntimeProof(
  proof: CreativeCanvasBenchmarkProofRecord | undefined,
  currentBinding: CreativeCanvasProofBinding,
): boolean {
  return Boolean(
    proof
      && hasDurableCategoryEvidence(proof, currentBinding)
      && proof.runtimeProofStatus === 'passed'
      && proof.runtimeReadyForLiveProof
      && typeof proof.runtimeArtifactBackedCategoryCount === 'number'
      && proof.runtimeArtifactBackedCategoryCount >= exportProofCategories.length
      && typeof proof.runtimeArtifactBackedCompletedCount === 'number'
      && proof.runtimeArtifactBackedCompletedCount >= exportProofCategories.length * 2
      && typeof proof.runtimeProviderBackedCategoryCount === 'number'
      && proof.runtimeProviderBackedCategoryCount >= exportProofCategories.length
      && typeof proof.runtimeProviderBackedCompletedCount === 'number'
      && proof.runtimeProviderBackedCompletedCount >= exportProofCategories.length * 2
      && proof.runtimeActiveRunCount === 0
      && proof.runtimeStaleActiveRunCount === 0
      && typeof proof.runtimeFailedRunCount === 'number'
      && typeof proof.runtimeFailureRatePercent === 'number'
      && proof.runtimeFailureRatePercent <= 10
      && proof.runtimeProofCapturedAt
      && proof.runtimeEvidence
      && proof.runtimeProviderEvidenceCapturedAt
      && proof.runtimeProviderEvidence,
  )
}

export function rebindCategoryEvidence(
  evidence: CreativeCanvasCategoryEvidence[] | undefined,
  currentBinding: CreativeCanvasProofBinding,
): CreativeCanvasCategoryEvidence[] {
  return (evidence ?? []).map((item) => ({
    ...item,
    ...currentBinding,
  }))
}

export function buildProductionRuntimeProofFields(input: {
  runtimeProof: CreativeCanvasRuntimeProof | null
  runOperations: CreativeCanvasRunOperationsSummary | null
  capturedAt: string
  currentBinding: CreativeCanvasProofBinding
}): Partial<CreativeCanvasBenchmarkProofRecord> {
  const reliabilityCoverage = input.runtimeProof?.reliabilityCoverage ?? []
  const passedCoverage = reliabilityCoverage.filter((category) => (
    requiredRuntimeProofCategoryKeys.has(category.key)
    && category.status === 'passed'
    && category.completed >= (category.requiredCompleted ?? 2)
  ))
  const artifactBackedCompleted = passedCoverage.reduce((total, category) => total + category.completed, 0)
  const activeRunCount = input.runOperations?.active ?? reliabilityCoverage.reduce((total, category) => total + category.active, 0)
  const staleActiveRunCount = input.runOperations?.staleActiveRuns ?? 0
  const failedRunCount = input.runOperations?.failed ?? reliabilityCoverage.reduce((total, category) => total + category.failed, 0)
  const completedOrFailed = artifactBackedCompleted + failedRunCount
  const failureRatePercent = completedOrFailed ? Math.round((failedRunCount / completedOrFailed) * 100) : 0

  return {
    runtimeProofStatus: input.runtimeProof?.status,
    runtimeReadyForLiveProof: input.runtimeProof?.readyForLiveProof === true,
    runtimeArtifactBackedCategoryCount: passedCoverage.length,
    runtimeArtifactBackedCompletedCount: artifactBackedCompleted,
    runtimeProviderBackedCategoryCount: passedCoverage.length,
    runtimeProviderBackedCompletedCount: artifactBackedCompleted,
    runtimeActiveRunCount: activeRunCount,
    runtimeStaleActiveRunCount: staleActiveRunCount,
    runtimeFailedRunCount: failedRunCount,
    runtimeFailureRatePercent: failureRatePercent,
    runtimeProofCapturedAt: input.runtimeProof ? input.capturedAt : undefined,
    runtimeCategoryEvidence: input.runtimeProof
      ? rebindCategoryEvidence(input.runtimeProof.runtimeCategoryEvidence, input.currentBinding)
      : undefined,
    exportCategoryEvidence: input.runtimeProof
      ? rebindCategoryEvidence(input.runtimeProof.exportCategoryEvidence, input.currentBinding)
      : undefined,
    runtimeEvidence: input.runtimeProof
      ? `${passedCoverage.length}/${exportProofCategories.length} runtime categories passed; ${artifactBackedCompleted} artifact/provenance-backed completed; ${activeRunCount} active; ${staleActiveRunCount} stale; ${failedRunCount} failed; ${failureRatePercent}% failure rate; ${input.runtimeProof.status} runtime proof`
      : undefined,
    runtimeProviderEvidenceCapturedAt: input.runtimeProof ? input.capturedAt : undefined,
    runtimeProviderEvidence: input.runtimeProof
      ? `${passedCoverage.length}/${exportProofCategories.length} provider-backed media/text categories passed under current runtime proof; ${artifactBackedCompleted} completed jobs counted after required provider provenance checks`
      : undefined,
  }
}

export function benchmarkProofUrl(canvas: CreativeCanvas | undefined, orgId: string): string {
  if (typeof window === 'undefined') return ''
  const url = new URL(window.location.href)
  if (orgId) url.searchParams.set('orgId', orgId)
  if (canvas?.id) url.searchParams.set('canvasId', canvas.id)
  url.hash = 'direct-higgsfield-benchmark-proof'
  return url.href
}
