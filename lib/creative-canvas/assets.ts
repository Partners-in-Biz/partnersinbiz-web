import type {
  CreativeCanvasAssetSummary,
  CreativeCanvasExport,
  CreativeCanvasNode,
  CreativeCanvasOutputKind,
  CreativeCanvasRun,
} from './types'

function hasAssetPayload(asset: Pick<CreativeCanvasAssetSummary, 'url' | 'thumbnailUrl' | 'storagePath' | 'artifactId' | 'textPreview'>): boolean {
  return Boolean(asset.url || asset.thumbnailUrl || asset.storagePath || asset.artifactId || asset.textPreview)
}

function outputReadyForExport(node: CreativeCanvasNode): boolean {
  return node.review?.status === 'passed'
    && node.review.rightsStatus === 'cleared'
    && node.review.brandStatus === 'passed'
}

function outputDraftExportBlocker(node: CreativeCanvasNode): string | undefined {
  if (node.type !== 'output') return 'Only output nodes can be draft-exported'
  if (!node.output) return 'Output node has no asset payload'
  if (node.review?.status === 'blocked') return 'Review is blocked'
  if (node.review?.rightsStatus === 'blocked') return 'Rights are blocked'
  if (node.review?.brandStatus === 'blocked') return 'Brand review is blocked'
  return undefined
}

function exportTargetFromOutputKind(kind?: CreativeCanvasOutputKind): CreativeCanvasExport['target'] | undefined {
  switch (kind) {
    case 'social_post_draft':
    case 'caption':
      return 'social_draft'
    case 'blog_draft':
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
      return undefined
  }
}

function exportTargetFromNode(node: CreativeCanvasNode): CreativeCanvasExport['target'] | undefined {
  const dataTarget = typeof node.data.exportTarget === 'string' ? node.data.exportTarget : undefined
  if (
    dataTarget === 'social_draft'
    || dataTarget === 'campaign_asset'
    || dataTarget === 'client_document'
    || dataTarget === 'research'
    || dataTarget === 'youtube_studio'
    || dataTarget === 'book_studio'
    || dataTarget === 'workspace_artifact'
  ) {
    return dataTarget
  }
  return exportTargetFromOutputKind(node.output?.kind)
}

export function buildCreativeCanvasAssetGallery(input: {
  nodes: CreativeCanvasNode[]
  runs?: Array<CreativeCanvasRun & { id: string }>
}): CreativeCanvasAssetSummary[] {
  const assets: CreativeCanvasAssetSummary[] = []

  for (const node of input.nodes) {
    if (node.source) {
      const asset: CreativeCanvasAssetSummary = {
        id: `source:${node.id}`,
        origin: 'source_node',
        title: node.title,
        nodeId: node.id,
        sourceKind: node.source.kind,
        referenceRole: node.source.referenceRole,
        url: node.source.url ?? node.source.previewUrl,
        thumbnailUrl: node.source.thumbnailUrl,
        storagePath: node.source.storagePath,
        artifactId: node.source.refId,
        textPreview: node.source.altText,
        canDraftExport: false,
        exportBlockedReason: 'Use source assets as references before exporting an output',
        readyForExport: false,
      }
      if (hasAssetPayload(asset)) assets.push(asset)
    }

    if (node.output) {
      const blockedReason = outputDraftExportBlocker(node)
      const asset: CreativeCanvasAssetSummary = {
        id: `output:${node.id}`,
        origin: 'output_node',
        title: node.title,
        nodeId: node.id,
        outputKind: node.output.kind,
        url: node.output.url,
        thumbnailUrl: node.output.thumbnailUrl,
        storagePath: node.output.storagePath,
        artifactId: node.output.artifactId,
        textPreview: node.output.textPreview,
        reviewStatus: node.review?.status,
        rightsStatus: node.review?.rightsStatus,
        brandStatus: node.review?.brandStatus,
        suggestedExportTarget: exportTargetFromNode(node),
        canDraftExport: !blockedReason,
        exportBlockedReason: blockedReason,
        readyForExport: outputReadyForExport(node),
      }
      if (hasAssetPayload(asset)) assets.push(asset)
    }
  }

  for (const run of input.runs ?? []) {
    if (!run.output) continue
    const asset: CreativeCanvasAssetSummary = {
      id: `run:${run.id}`,
      origin: 'run_output',
      title: `${run.providerKey} run output`,
      nodeId: run.output.outputNodeId ?? run.nodeId,
      runId: run.id,
      providerKey: run.providerKey,
      outputKind: run.input.outputKind,
      url: run.output.url,
      thumbnailUrl: run.output.thumbnailUrl,
      artifactId: run.output.artifactId,
      textPreview: run.output.textPreview,
      suggestedExportTarget: exportTargetFromOutputKind(run.input.outputKind),
      canDraftExport: false,
      exportBlockedReason: 'Ingest the run output into an output node before draft export',
      readyForExport: run.status === 'completed',
    }
    if (hasAssetPayload(asset)) assets.push(asset)
  }

  return assets
}
