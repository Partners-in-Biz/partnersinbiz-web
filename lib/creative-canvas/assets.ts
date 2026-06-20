import type {
  CreativeCanvasAssetSummary,
  CreativeCanvasNode,
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
        readyForExport: false,
      }
      if (hasAssetPayload(asset)) assets.push(asset)
    }

    if (node.output) {
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
      readyForExport: run.status === 'completed',
    }
    if (hasAssetPayload(asset)) assets.push(asset)
  }

  return assets
}
