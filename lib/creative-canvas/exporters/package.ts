import type {
  CreativeCanvas,
  CreativeCanvasActor,
  CreativeCanvasExport,
  CreativeCanvasNode,
  CreativeCanvasOutputKind,
} from '../types'
import { assertCanvasOutputCanExport } from './drafts'

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
}

export interface CreativeCanvasExportPackageResult {
  exportRecord: CreativeCanvasExport & {
    nodeIds: string[]
    packageAssetCount: number
  }
  payload: CreativeCanvasExportPackagePayload
}

function targetFromOutputKind(kind: CreativeCanvasOutputKind): CreativeCanvasExport['target'] {
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
      return 'workspace_artifact'
  }
}

function targetFromNode(node: CreativeCanvasNode): CreativeCanvasExport['target'] {
  const target = typeof node.data.exportTarget === 'string' ? node.data.exportTarget : undefined
  if (
    target === 'social_draft'
    || target === 'campaign_asset'
    || target === 'client_document'
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
  const exportRecord: CreativeCanvasExportPackageResult['exportRecord'] = {
    orgId: input.canvas.orgId,
    canvasId: input.canvas.id,
    nodeId: nodeIds[0],
    nodeIds,
    packageAssetCount: assets.length,
    target: targets.length === 1 ? targets[0] : 'workspace_artifact',
    status: 'drafted',
    createdBy: input.actor.uid,
    createdByType: input.actor.type,
  }

  return {
    exportRecord,
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
      guardrails: [
        'Internal package only.',
        'Do not publish, schedule, spend, or expose to clients until downstream review gates pass.',
        'Preserve Creative Canvas provenance on every downstream draft.',
      ],
    },
  }
}
