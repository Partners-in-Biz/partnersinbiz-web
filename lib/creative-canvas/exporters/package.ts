import type {
  CreativeCanvas,
  CreativeCanvasActor,
  CreativeCanvasExport,
  CreativeCanvasNode,
  CreativeCanvasOutputKind,
  CreativeCanvasProofCategoryKey,
} from '../types'
import { assertCanvasOutputCanExport, buildCreativeCanvasDraftExport, type CreativeCanvasDraftPayload } from './drafts'

const EXPORT_PROOF_CATEGORIES: Array<{
  key: CreativeCanvasProofCategoryKey
  label: string
  outputKinds: CreativeCanvasOutputKind[]
  targets: CreativeCanvasExport['target'][]
}> = [
  { key: 'image', label: 'Image/campaign', outputKinds: ['image', 'campaign_asset'], targets: ['campaign_asset'] },
  { key: 'video_social', label: 'Video/social', outputKinds: ['video', 'social_post_draft', 'youtube_render'], targets: ['social_draft', 'youtube_studio', 'campaign_asset'] },
  { key: 'audio', label: 'Audio', outputKinds: ['audio'], targets: ['campaign_asset', 'workspace_artifact'] },
  { key: 'blog_document', label: 'Blog/document', outputKinds: ['blog_draft', 'document_block', 'copy', 'caption'], targets: ['client_document', 'blog_post'] },
  { key: 'book', label: 'Book', outputKinds: ['book_artifact'], targets: ['book_studio'] },
]

export interface CreativeCanvasExportPackageAsset {
  nodeId: string
  title: string
  outputKind: CreativeCanvasOutputKind
  target: CreativeCanvasExport['target']
  url?: string
  thumbnailUrl?: string
  storagePath?: string
  artifactId?: string
  textPreview?: string
  review: NonNullable<CreativeCanvasNode['review']>
}

export interface CreativeCanvasExportPackageManifest {
  format: 'creative_canvas_export_package_manifest_v1'
  canvas: {
    id: string
    title: string
    activeVersion: number
    nodeCount: number
    edgeCount: number
  }
  graph: {
    nodes: Array<{
      id: string
      type: CreativeCanvasNode['type']
      title: string
      outputKind?: CreativeCanvasOutputKind
      target?: CreativeCanvasExport['target']
    }>
    edges: Array<{
      id: string
      sourceNodeId: string
      targetNodeId: string
      label?: string
    }>
  }
  review: {
    readyAssetCount: number
    blockedAssetCount: number
    needsReviewAssetCount: number
    syntheticMediaAssetCount: number
  }
  proof: {
    requiredOutputKinds: CreativeCanvasOutputKind[]
    packageTargets: CreativeCanvasExport['target'][]
    sourceNodeIds: string[]
    outputNodeIds: string[]
    coveredCategories: CreativeCanvasProofCategoryKey[]
    categoryCoverage: Array<{
      key: CreativeCanvasProofCategoryKey
      label: string
      passed: boolean
      assetNodeIds: string[]
      outputKinds: CreativeCanvasOutputKind[]
      targets: CreativeCanvasExport['target'][]
    }>
  }
  lineage: Array<{
    outputNodeId: string
    sourceNodeIds: string[]
    upstreamNodeIds: string[]
  }>
}

export interface CreativeCanvasExportPackagePayload {
  source: 'creative_canvas'
  status: 'internal_package'
  orgId: string
  sourceCanvasId: string
  title: string
  assetCount: number
  readyAssetCount: number
  targets: CreativeCanvasExport['target'][]
  assets: CreativeCanvasExportPackageAsset[]
  linked: CreativeCanvas['linked']
  clientVisible: false
  publishEnabled: false
  guardrails: string[]
  downstreamDrafts: CreativeCanvasDraftPayload[]
  manifest: CreativeCanvasExportPackageManifest
}

export interface CreativeCanvasExportPackageResult {
  exportRecord: CreativeCanvasExport & {
    nodeIds: string[]
    packageAssetCount: number
  }
  exportRecords: CreativeCanvasExport[]
  payload: CreativeCanvasExportPackagePayload
}

function targetFromOutputKind(kind: CreativeCanvasOutputKind): CreativeCanvasExport['target'] {
  switch (kind) {
    case 'social_post_draft':
    case 'caption':
      return 'social_draft'
    case 'blog_draft':
      return 'blog_post'
    case 'document_block':
    case 'copy':
      return 'client_document'
    case 'youtube_render':
      return 'youtube_studio'
    case 'book_artifact':
      return 'book_studio'
    case 'campaign_asset':
    case 'image':
    case 'video':
    case 'audio':
      return 'campaign_asset'
    default:
      return 'workspace_artifact'
  }
}

function targetFromNode(node: CreativeCanvasNode): CreativeCanvasExport['target'] {
  const target = typeof node.data.exportTarget === 'string' ? node.data.exportTarget : undefined
  if (
    target === 'social_draft'
    || target === 'campaign_asset'
    || target === 'client_document'
    || target === 'blog_post'
    || target === 'research'
    || target === 'youtube_studio'
    || target === 'book_studio'
    || target === 'workspace_artifact'
  ) {
    return target
  }
  return node.output?.kind ? targetFromOutputKind(node.output.kind) : 'workspace_artifact'
}

function outputIsReady(node: CreativeCanvasNode): boolean {
  return node.review?.status === 'passed'
    && node.review.rightsStatus === 'cleared'
    && node.review.brandStatus === 'passed'
}

function outputNeedsReview(node: CreativeCanvasNode): boolean {
  return node.review?.status === 'needed'
    || node.review?.rightsStatus === 'needs_review'
    || node.review?.brandStatus === 'needs_review'
}

function outputIsBlocked(node: CreativeCanvasNode): boolean {
  return node.review?.status === 'blocked'
    || node.review?.rightsStatus === 'blocked'
    || node.review?.brandStatus === 'blocked'
}

function collectUpstreamNodeIds(canvas: CreativeCanvas, outputNodeId: string): string[] {
  const edges = canvas.edges ?? []
  const byTarget = edges.reduce<Record<string, string[]>>((acc, edge) => {
    acc[edge.targetNodeId] = [...(acc[edge.targetNodeId] ?? []), edge.sourceNodeId]
    return acc
  }, {})
  const seen = new Set<string>()
  const visit = (nodeId: string) => {
    for (const sourceNodeId of byTarget[nodeId] ?? []) {
      if (seen.has(sourceNodeId)) continue
      seen.add(sourceNodeId)
      visit(sourceNodeId)
    }
  }
  visit(outputNodeId)
  return Array.from(seen)
}

function buildCategoryCoverage(assets: CreativeCanvasExportPackageAsset[]) {
  return EXPORT_PROOF_CATEGORIES.map((category) => {
    const categoryAssets = assets.filter((asset) => (
      category.outputKinds.includes(asset.outputKind)
      && category.targets.includes(asset.target)
    ))
    return {
      key: category.key,
      label: category.label,
      passed: categoryAssets.length > 0,
      assetNodeIds: categoryAssets.map((asset) => asset.nodeId),
      outputKinds: Array.from(new Set(categoryAssets.map((asset) => asset.outputKind))),
      targets: Array.from(new Set(categoryAssets.map((asset) => asset.target))),
    }
  })
}

function categoryKeyForAsset(asset: CreativeCanvasExportPackageAsset): CreativeCanvasProofCategoryKey {
  return EXPORT_PROOF_CATEGORIES.find((category) => (
    category.outputKinds.includes(asset.outputKind)
    && category.targets.includes(asset.target)
  ))?.key ?? 'image'
}

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function linkedDownstreamDraftId(canvas: CreativeCanvas, target: CreativeCanvasExport['target']): string | undefined {
  switch (target) {
    case 'social_draft':
      return cleanString(canvas.linked?.socialPostId)
    case 'campaign_asset':
      return cleanString(canvas.linked?.campaignId)
    case 'client_document':
    case 'blog_post':
      return cleanString(canvas.linked?.clientDocumentId)
    case 'research':
      return cleanString(canvas.linked?.researchItemId)
    case 'youtube_studio':
      return cleanString(canvas.linked?.youtubeVideoProjectId)
    case 'book_studio':
      return cleanString(canvas.linked?.bookStudioProjectId)
    case 'workspace_artifact':
      return Array.isArray(canvas.linked?.workspaceArtifactIds)
        ? cleanString(canvas.linked.workspaceArtifactIds[0])
        : undefined
    default:
      return undefined
  }
}

function downstreamDraftIdForAsset(
  canvas: CreativeCanvas & { id: string },
  node: CreativeCanvasNode,
  target: CreativeCanvasExport['target'],
): string {
  return cleanString(node.data.downstreamDraftId)
    ?? cleanString(node.data.targetId)
    ?? linkedDownstreamDraftId(canvas, target)
    ?? `creative-canvas:${canvas.id}:${node.id}:${target}`
}

export function buildCreativeCanvasExportPackage(input: {
  canvas: CreativeCanvas & { id: string }
  actor: CreativeCanvasActor
  nodeIds?: string[]
  title?: string
}): CreativeCanvasExportPackageResult {
  const selectedIds = new Set((input.nodeIds ?? []).filter(Boolean))
  const candidates = input.canvas.nodes.filter((node) => {
    if (node.type !== 'output') return false
    if (!node.output) return false
    if (selectedIds.size && !selectedIds.has(node.id)) return false
    return true
  })

  const assets = candidates.map((node): CreativeCanvasExportPackageAsset => {
    const target = targetFromNode(node)
    assertCanvasOutputCanExport(node, target, input.canvas.orgId)
    if (!node.review) throw new Error(`Creative canvas output ${node.id} is missing review state`)
    if (!node.output) throw new Error(`Creative canvas output ${node.id} is missing output payload`)
    return {
      nodeId: node.id,
      title: node.title,
      outputKind: node.output.kind,
      target,
      url: node.output.url,
      thumbnailUrl: node.output.thumbnailUrl,
      storagePath: node.output.storagePath,
      artifactId: node.output.artifactId,
      textPreview: node.output.textPreview,
      review: node.review,
    }
  })

  if (!assets.length) throw new Error('No exportable Creative Canvas output assets selected')

  const nodeIds = assets.map((asset) => asset.nodeId)
  const targets = Array.from(new Set(assets.map((asset) => asset.target)))
  const canvasEdges = input.canvas.edges ?? []
  const categoryCoverage = buildCategoryCoverage(assets)
  const coveredCategories = categoryCoverage.filter((category) => category.passed).map((category) => category.key)
  const lineage = assets.map((asset) => {
    const upstreamNodeIds = collectUpstreamNodeIds(input.canvas, asset.nodeId)
    const upstreamSourceIds = upstreamNodeIds.filter((nodeId) => input.canvas.nodes.find((node) => node.id === nodeId)?.type === 'source')
    return {
      outputNodeId: asset.nodeId,
      sourceNodeIds: upstreamSourceIds,
      upstreamNodeIds,
    }
  })
  const lineageByOutputNodeId = new Map(lineage.map((item) => [item.outputNodeId, item.sourceNodeIds]))
  const draftResults = assets.map((asset) => {
    const node = input.canvas.nodes.find((candidate) => candidate.id === asset.nodeId)
    if (!node) throw new Error(`Creative canvas output ${asset.nodeId} is missing from graph`)
    const draft = buildCreativeCanvasDraftExport({
      canvas: input.canvas,
      node,
      target: asset.target,
      actor: input.actor,
      lineageSourceNodeIds: lineageByOutputNodeId.get(asset.nodeId) ?? [],
      downstreamDraftId: downstreamDraftIdForAsset(input.canvas, node, asset.target),
    })
    return {
      ...draft,
      exportRecord: {
        ...draft.exportRecord,
        categoryKey: categoryKeyForAsset(asset),
      },
    }
  })
  const downstreamDrafts = draftResults.map((result) => result.payload)
  const exportRecords = draftResults.map((result) => result.exportRecord)
  const manifest: CreativeCanvasExportPackageManifest = {
    format: 'creative_canvas_export_package_manifest_v1',
    canvas: {
      id: input.canvas.id,
      title: input.canvas.title,
      activeVersion: input.canvas.activeVersion ?? 1,
      nodeCount: input.canvas.nodes.length,
      edgeCount: canvasEdges.length,
    },
    graph: {
      nodes: input.canvas.nodes.map((node) => ({
        id: node.id,
        type: node.type,
        title: node.title,
        outputKind: node.output?.kind,
        target: node.type === 'output' ? targetFromNode(node) : undefined,
      })),
      edges: canvasEdges.map((edge) => ({
        id: edge.id,
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId,
        label: edge.label,
      })),
    },
    review: {
      readyAssetCount: candidates.filter(outputIsReady).length,
      blockedAssetCount: candidates.filter(outputIsBlocked).length,
      needsReviewAssetCount: candidates.filter(outputNeedsReview).length,
      syntheticMediaAssetCount: candidates.filter((node) => node.review?.syntheticMediaDisclosure === true).length,
    },
    proof: {
      requiredOutputKinds: Array.from(new Set(assets.map((asset) => asset.outputKind))),
      packageTargets: targets,
      sourceNodeIds: input.canvas.nodes.filter((node) => node.type === 'source').map((node) => node.id),
      outputNodeIds: nodeIds,
      coveredCategories,
      categoryCoverage,
    },
    lineage,
  }
  const exportRecord: CreativeCanvasExportPackageResult['exportRecord'] = {
    orgId: input.canvas.orgId,
    canvasId: input.canvas.id,
    nodeId: nodeIds[0],
    nodeIds,
    packageAssetCount: assets.length,
    target: targets.length === 1 ? targets[0] : 'workspace_artifact',
    status: 'drafted',
    createdAt: new Date().toISOString(),
    createdBy: input.actor.uid,
    createdByType: input.actor.type,
  }

  return {
    exportRecord,
    exportRecords,
    payload: {
      source: 'creative_canvas',
      status: 'internal_package',
      orgId: input.canvas.orgId,
      sourceCanvasId: input.canvas.id,
      title: input.title?.trim() || `Creative package: ${input.canvas.title}`,
      assetCount: assets.length,
      readyAssetCount: candidates.filter(outputIsReady).length,
      targets,
      assets,
      linked: input.canvas.linked ?? {},
      clientVisible: false,
      publishEnabled: false,
      downstreamDrafts,
      manifest,
      guardrails: [
        'Internal package only.',
        'Do not publish, schedule, spend, or expose to clients until downstream review gates pass.',
        'Preserve Creative Canvas provenance on every downstream draft.',
      ],
    },
  }
}
