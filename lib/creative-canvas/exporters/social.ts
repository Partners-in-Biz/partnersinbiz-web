import type { SocialPlatformType } from '@/lib/social/types'
import type { CreativeCanvasNode } from '../types'

export interface SocialDraftMedia {
  mediaId?: string
  url?: string
  type: 'image' | 'video' | 'gif'
  thumbnailUrl?: string
  sourceCanvasId: string
  sourceNodeId: string
  syntheticMedia: boolean
}

export interface SocialDraftPayload {
  orgId: string
  status: 'draft'
  platforms: SocialPlatformType[]
  platform: string
  content: {
    text: string
    platformOverrides: Record<string, unknown>
  }
  media: SocialDraftMedia[]
  hashtags: string[]
  labels: string[]
  tags: string[]
  source: 'creative_canvas'
  sourceCanvasId: string
  sourceNodeId: string
  contextRefs: Array<{ type: 'creative_canvas'; id: string; label: string }>
}

export interface BuildSocialDraftInput {
  orgId: string
  canvasId: string
  node: CreativeCanvasNode
  platforms: SocialPlatformType[]
  caption?: string
  hashtags?: string[]
  labels?: string[]
  tags?: string[]
}

function outputMediaType(node: CreativeCanvasNode): 'image' | 'video' | 'gif' {
  if (node.output?.kind === 'video') return 'video'
  if (node.output?.kind === 'image') return 'image'
  return 'image'
}

function captionFromNode(node: CreativeCanvasNode, fallback?: string): string {
  const direct = fallback?.trim()
  if (direct) return direct
  const dataCaption = typeof node.data.caption === 'string' ? node.data.caption.trim() : ''
  if (dataCaption) return dataCaption
  const preview = node.output?.textPreview?.trim()
  if (preview) return preview
  return node.title
}

export function assertCanvasOutputCanExportToSocial(node: CreativeCanvasNode): void {
  if (node.type !== 'output') throw new Error('Creative canvas node is not an output node')
  if (!node.output) throw new Error('Creative canvas node has no output payload')
  if (node.review?.status === 'blocked' || node.review?.rightsStatus === 'blocked' || node.review?.brandStatus === 'blocked') {
    throw new Error('Creative canvas output is blocked by review state')
  }
  if (!['image', 'video', 'caption', 'copy', 'campaign_asset', 'social_post_draft'].includes(node.output.kind)) {
    throw new Error(`Creative canvas output kind ${node.output.kind} cannot export to social`)
  }
}

export function buildSocialDraftFromCanvasOutput(input: BuildSocialDraftInput): SocialDraftPayload {
  if (input.node.orgId !== input.orgId) throw new Error('Creative canvas output does not belong to organisation')
  if (input.platforms.length === 0) throw new Error('At least one social platform is required')
  assertCanvasOutputCanExportToSocial(input.node)

  const media = input.node.output?.url
    ? [{
        mediaId: input.node.output.artifactId,
        url: input.node.output.url,
        type: outputMediaType(input.node),
        thumbnailUrl: input.node.output.thumbnailUrl,
        sourceCanvasId: input.canvasId,
        sourceNodeId: input.node.id,
        syntheticMedia: input.node.review?.syntheticMediaDisclosure === true,
      }]
    : []

  return {
    orgId: input.orgId,
    status: 'draft',
    platforms: input.platforms,
    platform: input.platforms[0] === 'twitter' ? 'x' : input.platforms[0],
    content: {
      text: captionFromNode(input.node, input.caption),
      platformOverrides: {},
    },
    media,
    hashtags: input.hashtags ?? [],
    labels: input.labels ?? ['creative-canvas'],
    tags: input.tags ?? ['creative-canvas'],
    source: 'creative_canvas',
    sourceCanvasId: input.canvasId,
    sourceNodeId: input.node.id,
    contextRefs: [{
      type: 'creative_canvas',
      id: input.canvasId,
      label: 'Creative Canvas',
    }],
  }
}
