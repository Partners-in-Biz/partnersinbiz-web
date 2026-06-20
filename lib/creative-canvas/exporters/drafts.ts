import type {
  CreativeCanvas,
  CreativeCanvasActor,
  CreativeCanvasExport,
  CreativeCanvasNode,
} from '../types'

export interface CreativeCanvasDraftPayload {
  source: 'creative_canvas'
  status: 'internal_draft'
  target: CreativeCanvasExport['target']
  orgId: string
  sourceCanvasId: string
  sourceNodeId: string
  title: string
  textPreview?: string
  artifactId?: string
  url?: string
  thumbnailUrl?: string
  outputKind?: string
  syntheticMedia: boolean
  clientVisible: false
  publishEnabled: false
  linked: CreativeCanvas['linked']
  moduleHint: string
}

export interface CreativeCanvasDraftExportResult {
  exportRecord: CreativeCanvasExport
  payload: CreativeCanvasDraftPayload
}

const TARGET_HINTS: Record<CreativeCanvasExport['target'], string> = {
  social_draft: 'Create an internal social draft; do not schedule or publish.',
  campaign_asset: 'Attach as an internal campaign asset candidate; do not launch ads or spend.',
  client_document: 'Create an internal document/blog block candidate; do not share with clients.',
  research: 'Attach as internal research evidence or creative rationale; do not publish.',
  youtube_studio: 'Create an internal YouTube Studio asset candidate; do not publish.',
  book_studio: 'Create an internal Book Studio artifact candidate; do not publish to stores.',
  workspace_artifact: 'Create or link an internal workspace artifact; do not mutate Drive ACLs.',
}

export function assertCanvasOutputCanExport(
  node: CreativeCanvasNode,
  target: CreativeCanvasExport['target'],
  orgId: string,
): void {
  if (!TARGET_HINTS[target]) throw new Error(`Unsupported creative canvas export target: ${target}`)
  if (node.orgId !== orgId) throw new Error('Creative canvas output does not belong to organisation')
  if (node.type !== 'output') throw new Error('Creative canvas node is not an output node')
  if (!node.output) throw new Error('Creative canvas node has no output payload')
  if (node.review?.status === 'blocked' || node.review?.rightsStatus === 'blocked' || node.review?.brandStatus === 'blocked') {
    throw new Error('Creative canvas output is blocked by review state')
  }
}

function titleForTarget(canvas: CreativeCanvas, node: CreativeCanvasNode, target: CreativeCanvasExport['target']): string {
  const prefix = target.replace(/_/g, ' ')
  return `${prefix}: ${node.title || canvas.title}`.replace(/^\w/, (char) => char.toUpperCase())
}

export function buildCreativeCanvasDraftExport(input: {
  canvas: CreativeCanvas & { id: string }
  node: CreativeCanvasNode
  target: CreativeCanvasExport['target']
  actor: CreativeCanvasActor
}): CreativeCanvasDraftExportResult {
  assertCanvasOutputCanExport(input.node, input.target, input.canvas.orgId)

  const exportRecord: CreativeCanvasExport = {
    orgId: input.canvas.orgId,
    canvasId: input.canvas.id,
    nodeId: input.node.id,
    target: input.target,
    status: 'drafted',
    createdBy: input.actor.uid,
    createdByType: input.actor.type,
  }

  return {
    exportRecord,
    payload: {
      source: 'creative_canvas',
      status: 'internal_draft',
      target: input.target,
      orgId: input.canvas.orgId,
      sourceCanvasId: input.canvas.id,
      sourceNodeId: input.node.id,
      title: titleForTarget(input.canvas, input.node, input.target),
      textPreview: input.node.output?.textPreview,
      artifactId: input.node.output?.artifactId,
      url: input.node.output?.url,
      thumbnailUrl: input.node.output?.thumbnailUrl,
      outputKind: input.node.output?.kind,
      syntheticMedia: input.node.review?.syntheticMediaDisclosure === true,
      clientVisible: false,
      publishEnabled: false,
      linked: input.canvas.linked ?? {},
      moduleHint: TARGET_HINTS[input.target],
    },
  }
}
