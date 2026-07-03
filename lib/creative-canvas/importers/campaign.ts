// lib/creative-canvas/importers/campaign.ts
//
// Pure mapper: content-engine campaign (+ its asset roll-up) → an editable
// Creative Canvas graph. Draft-only, read-only over campaign data — the
// campaign is never mutated; we only derive nodes/edges from it.
//
// Mapping rules:
//   - brand logo + blog hero images → `source` nodes (kind 'upload', role 'general')
//   - blog posts (seo_content + joined draft) → text nodes (backend type `prompt`,
//     data.presentationType 'text', data.text = title + excerpt/body snippet ≤2000 chars)
//   - social posts → text nodes grouped by week (when schedule dates exist)
//     or by platform, so a 12-week campaign stays readable
//   - video posts (social_posts with media[0].type === 'video') → `source` nodes
//     (kind 'upload', role 'motion')
//   - edges only where real linkage exists: blog hero image → blog node
//   - column layout by content type (360px columns, 220px rows, no overlaps)
//   - TOTAL node cap of 40 — priority: images, blogs, videos, social groups;
//     when capped, meta.capped is true and meta.note explains what was dropped

import type { CreativeCanvasEdge, CreativeCanvasNode } from '@/lib/creative-canvas/types'
import type { CampaignAssets } from '@/lib/types/campaign'

export const CAMPAIGN_IMPORT_MAX_NODES = 40
export const CAMPAIGN_IMPORT_COLUMN_WIDTH = 360
export const CAMPAIGN_IMPORT_ROW_HEIGHT = 220
const MAX_TEXT_LENGTH = 2000

/** Thrown when a campaign has nothing that can be placed on a canvas. */
export class CampaignImportEmptyError extends Error {
  constructor(message = 'Campaign has no importable content') {
    super(message)
    this.name = 'CampaignImportEmptyError'
  }
}

/** Loose shape of a content-engine campaign doc (lib/types/campaign.ts Campaign). */
export interface CampaignImportSource {
  id: string
  orgId: string
  name?: string
  brandIdentity?: { logoUrl?: string } | null
  [key: string]: unknown
}

export interface CampaignImportGraph {
  nodes: CreativeCanvasNode[]
  edges: CreativeCanvasEdge[]
  meta: {
    nodeCount: number
    edgeCount: number
    capped: boolean
    droppedNodeCount: number
    note?: string
    counts: {
      imageSources: number
      blogs: number
      socialGroups: number
      videos: number
    }
  }
}

type ColumnKey = 'image' | 'blog' | 'social' | 'video'

const COLUMN_X: Record<ColumnKey, number> = {
  image: 0,
  blog: CAMPAIGN_IMPORT_COLUMN_WIDTH,
  social: CAMPAIGN_IMPORT_COLUMN_WIDTH * 2,
  video: CAMPAIGN_IMPORT_COLUMN_WIDTH * 3,
}

interface CandidateNode {
  column: ColumnKey
  node: CreativeCanvasNode
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/** Only http(s) URLs survive the graph sanitizer — everything else is dropped here. */
function cleanHttpUrl(value: unknown): string | undefined {
  const raw = cleanString(value)
  if (!raw) return undefined
  try {
    const parsed = new URL(raw)
    if (!['http:', 'https:'].includes(parsed.protocol)) return undefined
    if (parsed.username || parsed.password) return undefined
    return parsed.href
  } catch {
    return undefined
  }
}

function truncate(value: string, max = MAX_TEXT_LENGTH): string {
  const clean = value.trim()
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean
}

/** Handles Firestore Timestamps ({toDate}), serialized ({_seconds}/{seconds}), Dates, ISO strings. */
function toDate(value: unknown): Date | undefined {
  if (!value) return undefined
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value
  if (typeof value === 'object') {
    const record = value as { toDate?: () => Date; _seconds?: number; seconds?: number }
    if (typeof record.toDate === 'function') {
      try {
        const date = record.toDate()
        return date instanceof Date && !Number.isNaN(date.getTime()) ? date : undefined
      } catch {
        return undefined
      }
    }
    const seconds = typeof record._seconds === 'number' ? record._seconds : record.seconds
    if (typeof seconds === 'number' && Number.isFinite(seconds)) return new Date(seconds * 1000)
    return undefined
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? undefined : date
  }
  return undefined
}

function postPlatform(post: Record<string, unknown>): string {
  const platforms = Array.isArray(post.platforms) ? post.platforms.map(cleanString).filter(Boolean) : []
  return (platforms[0] as string | undefined) ?? cleanString(post.platform) ?? 'unassigned'
}

function postDate(post: Record<string, unknown>): Date | undefined {
  return toDate(post.scheduledFor) ?? toDate(post.scheduledAt)
}

function blogSnippet(blog: Record<string, unknown>): string {
  const draft = asRecord(blog.draft)
  return cleanString(blog.excerpt)
    ?? cleanString(draft.metaDescription)
    ?? cleanString(blog.metaDescription)
    ?? cleanString(draft.body)
    ?? cleanString(blog.description)
    ?? ''
}

export function buildCanvasGraphFromCampaign(
  campaign: CampaignImportSource,
  assets: CampaignAssets,
): CampaignImportGraph {
  const orgId = cleanString(campaign.orgId)
  if (!orgId) throw new Error('campaign.orgId is required')
  const campaignId = cleanString(campaign.id) ?? assets.campaignId
  const blogs = Array.isArray(assets.blogs) ? assets.blogs.map(asRecord) : []
  const socialPosts = Array.isArray(assets.social) ? assets.social.map(asRecord) : []
  const videos = Array.isArray(assets.videos) ? assets.videos.map(asRecord) : []

  const imageCandidates: CandidateNode[] = []
  const blogCandidates: CandidateNode[] = []
  const socialCandidates: CandidateNode[] = []
  const videoCandidates: CandidateNode[] = []
  // blogId → hero source node id, so edges can be re-linked after the cap.
  const heroSourceByBlogId = new Map<string, string>()

  // --- Brand logo → source node -------------------------------------------
  const logoUrl = cleanHttpUrl(asRecord(campaign.brandIdentity).logoUrl)
  if (logoUrl) {
    imageCandidates.push({
      column: 'image',
      node: {
        id: 'campaign-import-brand-logo',
        orgId,
        type: 'source',
        title: 'Brand logo',
        position: { x: 0, y: 0 },
        data: {
          presentationType: 'image',
          campaignRefs: { campaignId, assetType: 'brand_identity' },
        },
        source: {
          kind: 'upload',
          referenceRole: 'general',
          url: logoUrl,
          thumbnailUrl: logoUrl,
          altText: `${cleanString(campaign.name) ?? 'Campaign'} brand logo`,
        },
      },
    })
  }

  // --- Blog hero images → source nodes (dedup by URL) ----------------------
  const seenImageUrls = new Set<string>(logoUrl ? [logoUrl] : [])
  for (const blog of blogs) {
    const blogId = cleanString(blog.id)
    const heroUrl = cleanHttpUrl(blog.heroImageUrl)
    if (!blogId || !heroUrl || seenImageUrls.has(heroUrl)) continue
    seenImageUrls.add(heroUrl)
    const sourceId = `campaign-import-hero-${blogId}`
    heroSourceByBlogId.set(blogId, sourceId)
    imageCandidates.push({
      column: 'image',
      node: {
        id: sourceId,
        orgId,
        type: 'source',
        title: `Hero: ${cleanString(blog.title) ?? blogId}`,
        position: { x: 0, y: 0 },
        data: {
          presentationType: 'image',
          campaignRefs: { campaignId, assetType: 'seo_content', seoContentId: blogId },
        },
        source: {
          kind: 'upload',
          referenceRole: 'general',
          url: heroUrl,
          thumbnailUrl: heroUrl,
          altText: `Hero image for ${cleanString(blog.title) ?? 'blog post'}`,
        },
      },
    })
  }

  // --- Blog posts → text nodes ---------------------------------------------
  for (const blog of blogs) {
    const blogId = cleanString(blog.id)
    if (!blogId) continue
    const title = cleanString(blog.title) ?? 'Untitled blog post'
    const snippet = blogSnippet(blog)
    const campaignRefs: Record<string, unknown> = {
      campaignId,
      assetType: 'seo_content',
      seoContentId: blogId,
    }
    const draftPostId = cleanString(blog.draftPostId)
    if (draftPostId) campaignRefs.draftPostId = draftPostId
    blogCandidates.push({
      column: 'blog',
      node: {
        id: `campaign-import-blog-${blogId}`,
        orgId,
        type: 'prompt',
        title,
        position: { x: 0, y: 0 },
        data: {
          presentationType: 'text',
          text: truncate(snippet ? `${title}\n\n${snippet}` : title),
          campaignRefs,
        },
      },
    })
  }

  // --- Social posts → grouped text nodes -----------------------------------
  const datedPosts = socialPosts.filter((post) => postDate(post))
  const groupByWeek = datedPosts.length > 0
  const groups = new Map<string, { label: string; sortKey: number; posts: Record<string, unknown>[] }>()
  if (groupByWeek) {
    const earliest = datedPosts
      .map((post) => postDate(post) as Date)
      .reduce((min, date) => (date < min ? date : min))
    for (const post of socialPosts) {
      const date = postDate(post)
      const week = date
        ? Math.floor((date.getTime() - earliest.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1
        : 0
      const key = week > 0 ? `week-${week}` : 'unscheduled'
      const label = week > 0 ? `Social week ${week}` : 'Social (unscheduled)'
      const entry = groups.get(key) ?? { label, sortKey: week > 0 ? week : Number.MAX_SAFE_INTEGER, posts: [] }
      entry.posts.push(post)
      groups.set(key, entry)
    }
  } else {
    for (const post of socialPosts) {
      const platform = postPlatform(post)
      const key = `platform-${platform}`
      const entry = groups.get(key) ?? { label: `Social — ${platform}`, sortKey: groups.size, posts: [] }
      entry.posts.push(post)
      groups.set(key, entry)
    }
  }
  const sortedGroups = [...groups.entries()].sort((a, b) => a[1].sortKey - b[1].sortKey)
  for (const [key, group] of sortedGroups) {
    const postIds = group.posts.map((post) => cleanString(post.id)).filter((id): id is string => Boolean(id))
    const lines = group.posts.map((post) => {
      const content = cleanString(post.content) ?? cleanString(post.text) ?? '(no copy)'
      return `[${postPlatform(post)}] ${content}`
    })
    socialCandidates.push({
      column: 'social',
      node: {
        id: `campaign-import-social-${key}`,
        orgId,
        type: 'prompt',
        title: `${group.label} (${group.posts.length} post${group.posts.length === 1 ? '' : 's'})`,
        position: { x: 0, y: 0 },
        data: {
          presentationType: 'text',
          text: truncate(lines.join('\n\n')),
          campaignRefs: {
            campaignId,
            assetType: 'social_post',
            socialPostIds: postIds,
            groupedBy: groupByWeek ? 'week' : 'platform',
          },
        },
      },
    })
  }

  // --- Videos → source nodes ------------------------------------------------
  videos.forEach((post, index) => {
    const postId = cleanString(post.id)
    const media = Array.isArray(post.media) ? asRecord(post.media[0]) : {}
    const url = cleanHttpUrl(media.url)
    if (!postId || !url) return
    const thumbnailUrl = cleanHttpUrl(media.thumbnailUrl) ?? cleanHttpUrl(media.thumbnail)
    const caption = cleanString(post.content)
    videoCandidates.push({
      column: 'video',
      node: {
        id: `campaign-import-video-${postId}`,
        orgId,
        type: 'source',
        title: caption ? truncate(caption, 60) : `Campaign video ${index + 1}`,
        position: { x: 0, y: 0 },
        data: {
          presentationType: 'video',
          campaignRefs: { campaignId, assetType: 'social_post', socialPostId: postId },
        },
        source: {
          kind: 'upload',
          referenceRole: 'motion',
          url,
          ...(thumbnailUrl ? { thumbnailUrl } : {}),
          altText: caption ? truncate(caption, 200) : `Campaign video ${index + 1}`,
        },
      },
    })
  })

  // --- Cap + layout ----------------------------------------------------------
  const ordered: CandidateNode[] = [
    ...imageCandidates,
    ...blogCandidates,
    ...videoCandidates,
    ...socialCandidates,
  ]
  if (!ordered.length) throw new CampaignImportEmptyError()

  const capped = ordered.length > CAMPAIGN_IMPORT_MAX_NODES
  const kept = ordered.slice(0, CAMPAIGN_IMPORT_MAX_NODES)
  const droppedNodeCount = ordered.length - kept.length

  // Column layout: fixed x per content type, stacked y — no overlaps possible.
  const rowByColumn: Record<ColumnKey, number> = { image: 0, blog: 0, social: 0, video: 0 }
  const nodes = kept.map(({ column, node }) => {
    const row = rowByColumn[column]
    rowByColumn[column] += 1
    return {
      ...node,
      position: { x: COLUMN_X[column], y: row * CAMPAIGN_IMPORT_ROW_HEIGHT },
    }
  })

  // Edges only where real linkage exists: blog hero image → blog node.
  const keptIds = new Set(nodes.map((node) => node.id))
  const edges: CreativeCanvasEdge[] = []
  for (const [blogId, sourceId] of heroSourceByBlogId) {
    const targetId = `campaign-import-blog-${blogId}`
    if (!keptIds.has(sourceId) || !keptIds.has(targetId)) continue
    edges.push({
      id: `campaign-import-edge-hero-${blogId}`,
      orgId,
      sourceNodeId: sourceId,
      targetNodeId: targetId,
      label: 'hero image',
    })
  }

  const counts = {
    imageSources: nodes.filter((node) => node.id.startsWith('campaign-import-hero-') || node.id === 'campaign-import-brand-logo').length,
    blogs: nodes.filter((node) => node.id.startsWith('campaign-import-blog-')).length,
    socialGroups: nodes.filter((node) => node.id.startsWith('campaign-import-social-')).length,
    videos: nodes.filter((node) => node.id.startsWith('campaign-import-video-')).length,
  }

  return {
    nodes,
    edges,
    meta: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      capped,
      droppedNodeCount,
      ...(capped
        ? { note: `Node cap of ${CAMPAIGN_IMPORT_MAX_NODES} reached — ${droppedNodeCount} lower-priority node${droppedNodeCount === 1 ? '' : 's'} (social groups last) were not imported.` }
        : {}),
      counts,
    },
  }
}
