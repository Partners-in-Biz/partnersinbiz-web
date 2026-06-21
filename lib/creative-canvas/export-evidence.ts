import type {
  CreativeCanvasCategoryEvidence,
  CreativeCanvasOutputKind,
  CreativeCanvasProofBinding,
  CreativeCanvasProofCategoryKey,
  CreativeCanvasProviderKey,
  CreativeCanvasReviewStatus,
  CreativeCanvasRun,
} from './types'

type RuntimeEvidenceRun = Partial<Omit<CreativeCanvasRun, 'input' | 'output' | 'provenance' | 'providerKey' | 'status'>> & {
  id?: string
  status?: string
  providerKey?: string
  input?: {
    outputKind?: string
  }
  output?: {
    outputNodeId?: string
    nodeId?: string
    artifactId?: string
    url?: string
    textPreview?: string
    rawProviderJobId?: string
  }
  provenance?: {
    providerJobId?: string
  }
  review?: {
    status?: string
  }
  reviewStatus?: string
}

export type CreativeCanvasCategoryExportEvidenceInput = {
  id?: string
  categoryKey?: string
  outputKind?: string
  providerKey?: string
  reviewStatus?: string
  outputNodeId?: string
  nodeId?: string
  exportId?: string
  downstreamDraftId?: string
  downstreamDraftIds?: string[]
  targetId?: string
  sourceNodeIds?: string[]
  lineageSourceNodeIds?: string[]
  status?: string
  completedAt?: unknown
  createdAt?: unknown
  target?: string
}

const outputKinds: CreativeCanvasOutputKind[] = [
  'image',
  'video',
  'audio',
  'caption',
  'copy',
  'blog_draft',
  'document_block',
  'book_artifact',
  'youtube_render',
  'campaign_asset',
  'social_post_draft',
]

const providerKeys: CreativeCanvasProviderKey[] = [
  'higgsfield',
  'xai',
  'manual_upload',
  'text_generation',
  'document_generation',
  'agent_task',
]

const reviewStatuses: CreativeCanvasReviewStatus[] = ['not_required', 'needed', 'passed', 'warning', 'blocked']

const proofCategories: Array<{
  key: CreativeCanvasProofCategoryKey
  label: string
  outputKinds: CreativeCanvasOutputKind[]
  requiresProviderJobId: boolean
}> = [
  { key: 'image', label: 'Image', outputKinds: ['image', 'campaign_asset'], requiresProviderJobId: true },
  { key: 'video_social', label: 'Video/social', outputKinds: ['video', 'social_post_draft', 'youtube_render'], requiresProviderJobId: true },
  { key: 'audio', label: 'Audio', outputKinds: ['audio'], requiresProviderJobId: true },
  { key: 'blog_document', label: 'Blog/document', outputKinds: ['blog_draft', 'document_block', 'copy', 'caption'], requiresProviderJobId: false },
  { key: 'book', label: 'Book', outputKinds: ['book_artifact'], requiresProviderJobId: true },
]

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length ? value.trim() : undefined
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.flatMap((value) => {
    const clean = cleanString(value)
    return clean ? [clean] : []
  })))
}

function outputKind(value: unknown): CreativeCanvasOutputKind | undefined {
  return outputKinds.includes(value as CreativeCanvasOutputKind) ? value as CreativeCanvasOutputKind : undefined
}

function providerKey(value: unknown): CreativeCanvasProviderKey | undefined {
  return providerKeys.includes(value as CreativeCanvasProviderKey) ? value as CreativeCanvasProviderKey : undefined
}

function reviewStatus(value: unknown): CreativeCanvasReviewStatus | undefined {
  return reviewStatuses.includes(value as CreativeCanvasReviewStatus) ? value as CreativeCanvasReviewStatus : undefined
}

function categoryKey(value: unknown): CreativeCanvasProofCategoryKey | undefined {
  if (value === 'image_campaign') return 'image'
  if (
    value === 'image'
    || value === 'video_social'
    || value === 'audio'
    || value === 'blog_document'
    || value === 'book'
  ) {
    return value
  }
  return undefined
}

function categoryForOutputKind(kind: CreativeCanvasOutputKind | undefined): CreativeCanvasProofCategoryKey | undefined {
  if (!kind) return undefined
  return proofCategories.find((category) => category.outputKinds.includes(kind))?.key
}

function binding(input?: Partial<CreativeCanvasProofBinding>): CreativeCanvasProofBinding {
  return {
    orgId: cleanString(input?.orgId) ?? '',
    canvasVersion: typeof input?.canvasVersion === 'number' && Number.isFinite(input.canvasVersion)
      ? Math.max(0, Math.round(input.canvasVersion))
      : 0,
    graphSignature: cleanString(input?.graphSignature) ?? '',
    nodeCount: typeof input?.nodeCount === 'number' && Number.isFinite(input.nodeCount)
      ? Math.max(0, Math.round(input.nodeCount))
      : 0,
    edgeCount: typeof input?.edgeCount === 'number' && Number.isFinite(input.edgeCount)
      ? Math.max(0, Math.round(input.edgeCount))
      : 0,
  }
}

function evidenceBase(input: {
  categoryKey: CreativeCanvasProofCategoryKey
  completedAt: string
  binding?: Partial<CreativeCanvasProofBinding>
}): Omit<CreativeCanvasCategoryEvidence, 'runIds' | 'providerJobIds' | 'outputUrls' | 'artifactIds' | 'outputNodeIds' | 'exportIds' | 'downstreamDraftIds' | 'lineageSourceNodeIds' | 'providerKeys' | 'outputKinds' | 'reviewStatuses' | 'evidence'> {
  return {
    ...binding(input.binding),
    categoryKey: input.categoryKey,
    completedAt: input.completedAt,
  }
}

function runOutputNodeId(run: RuntimeEvidenceRun): string | undefined {
  return cleanString(run.output?.outputNodeId)
    ?? cleanString(run.output?.nodeId)
    ?? cleanString(run.nodeId)
}

function hasRuntimeOutputEvidence(run: RuntimeEvidenceRun): boolean {
  return Boolean(cleanString(run.output?.url) || cleanString(run.output?.artifactId) || cleanString(run.output?.textPreview))
}

function providerJobId(run: RuntimeEvidenceRun): string | undefined {
  return cleanString(run.provenance?.providerJobId) ?? cleanString(run.output?.rawProviderJobId)
}

function buildRuntimeEvidence(input: {
  runs: RuntimeEvidenceRun[]
  completedAt: string
  binding?: Partial<CreativeCanvasProofBinding>
}): CreativeCanvasCategoryEvidence[] {
  return proofCategories.flatMap((category) => {
    const matchingRuns = input.runs.filter((run) => {
      const kind = outputKind(run.input?.outputKind)
      if (run.status !== 'completed' || categoryForOutputKind(kind) !== category.key) return false
      if (!cleanString(run.id) || !runOutputNodeId(run) || !hasRuntimeOutputEvidence(run)) return false
      return !category.requiresProviderJobId || Boolean(providerJobId(run))
    })

    if (matchingRuns.length < 2) return []

    const runIds = uniqueStrings(matchingRuns.map((run) => run.id))
    const providerJobIds = uniqueStrings(matchingRuns.map(providerJobId))
    const outputUrls = uniqueStrings(matchingRuns.map((run) => run.output?.url))
    const artifactIds = uniqueStrings(matchingRuns.map((run) => run.output?.artifactId ?? run.output?.textPreview))
    const outputNodeIds = uniqueStrings(matchingRuns.map(runOutputNodeId))
    const providerKeyValues = Array.from(new Set(matchingRuns.map((run) => providerKey(run.providerKey)).filter((item): item is CreativeCanvasProviderKey => Boolean(item))))
    const outputKindValues = Array.from(new Set(matchingRuns.map((run) => outputKind(run.input?.outputKind)).filter((item): item is CreativeCanvasOutputKind => Boolean(item))))
    const reviewStatusValues = Array.from(new Set(matchingRuns.map((run) => reviewStatus(run.reviewStatus ?? run.review?.status)).filter((item): item is CreativeCanvasReviewStatus => Boolean(item))))

    return [{
      ...evidenceBase({ categoryKey: category.key, completedAt: input.completedAt, binding: input.binding }),
      runIds,
      providerJobIds,
      outputUrls,
      artifactIds,
      outputNodeIds,
      exportIds: [],
      downstreamDraftIds: [],
      lineageSourceNodeIds: [],
      providerKeys: providerKeyValues,
      outputKinds: outputKindValues,
      reviewStatuses: reviewStatusValues,
      evidence: `${category.label}: ${runIds.length} completed runtime runs, ${outputNodeIds.length} output node${outputNodeIds.length === 1 ? '' : 's'}, ${providerJobIds.length} provider job id${providerJobIds.length === 1 ? '' : 's'}.`,
    }]
  })
}

function exportCategory(record: CreativeCanvasCategoryExportEvidenceInput): CreativeCanvasProofCategoryKey | undefined {
  return categoryKey(record.categoryKey)
    ?? categoryForOutputKind(outputKind(record.outputKind))
}

function exportCompletedAt(record: CreativeCanvasCategoryExportEvidenceInput, fallback: string): string {
  return cleanString(record.completedAt) ?? cleanString(record.createdAt) ?? fallback
}

function buildExportEvidence(input: {
  exports: CreativeCanvasCategoryExportEvidenceInput[]
  completedAt: string
  binding?: Partial<CreativeCanvasProofBinding>
}): CreativeCanvasCategoryEvidence[] {
  return proofCategories.flatMap((category) => {
    const matchingExports = input.exports.filter((record) => {
      if (record.status && !['drafted', 'completed'].includes(record.status)) return false
      return exportCategory(record) === category.key
    })
    const exportIds = uniqueStrings(matchingExports.map((record) => record.exportId ?? record.id))
    const downstreamDraftIds = uniqueStrings(matchingExports.flatMap((record) => [
      record.downstreamDraftId,
      record.targetId,
      ...(record.downstreamDraftIds ?? []),
    ]))
    const outputNodeIds = uniqueStrings(matchingExports.map((record) => record.outputNodeId ?? record.nodeId))
    const lineageSourceNodeIds = uniqueStrings(matchingExports.flatMap((record) => [
      ...(record.sourceNodeIds ?? []),
      ...(record.lineageSourceNodeIds ?? []),
    ]))

    if (!exportIds.length || !downstreamDraftIds.length || !outputNodeIds.length || !lineageSourceNodeIds.length) {
      return []
    }

    const providerKeyValues = Array.from(new Set(matchingExports.map((record) => providerKey(record.providerKey)).filter((item): item is CreativeCanvasProviderKey => Boolean(item))))
    const outputKindValues = Array.from(new Set(matchingExports.map((record) => outputKind(record.outputKind)).filter((item): item is CreativeCanvasOutputKind => Boolean(item))))
    const reviewStatusValues = Array.from(new Set(matchingExports.map((record) => reviewStatus(record.reviewStatus)).filter((item): item is CreativeCanvasReviewStatus => Boolean(item))))
    const completedAt = exportCompletedAt(matchingExports[0], input.completedAt)

    return [{
      ...evidenceBase({ categoryKey: category.key, completedAt, binding: input.binding }),
      runIds: [],
      providerJobIds: [],
      outputUrls: [],
      artifactIds: [],
      outputNodeIds,
      exportIds,
      downstreamDraftIds,
      lineageSourceNodeIds,
      providerKeys: providerKeyValues,
      outputKinds: outputKindValues,
      reviewStatuses: reviewStatusValues,
      evidence: `${category.label}: export ${exportIds.join(', ')} created downstream draft${downstreamDraftIds.length === 1 ? '' : 's'} ${downstreamDraftIds.join(', ')} from ${lineageSourceNodeIds.length} lineage source node${lineageSourceNodeIds.length === 1 ? '' : 's'}.`,
    }]
  })
}

export function buildCreativeCanvasCategoryEvidence(input: {
  runs?: RuntimeEvidenceRun[]
  exports?: CreativeCanvasCategoryExportEvidenceInput[]
  completedAt?: string
  binding?: Partial<CreativeCanvasProofBinding>
}): {
  runtimeCategoryEvidence: CreativeCanvasCategoryEvidence[]
  exportCategoryEvidence: CreativeCanvasCategoryEvidence[]
} {
  const completedAt = cleanString(input.completedAt) ?? new Date().toISOString()
  return {
    runtimeCategoryEvidence: buildRuntimeEvidence({
      runs: input.runs ?? [],
      completedAt,
      binding: input.binding,
    }),
    exportCategoryEvidence: buildExportEvidence({
      exports: input.exports ?? [],
      completedAt,
      binding: input.binding,
    }),
  }
}
