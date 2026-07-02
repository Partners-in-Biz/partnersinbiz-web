import {
  buildCanvasGraphFromCampaign,
  CampaignImportEmptyError,
  CAMPAIGN_IMPORT_MAX_NODES,
  CAMPAIGN_IMPORT_COLUMN_WIDTH,
  CAMPAIGN_IMPORT_ROW_HEIGHT,
} from '@/lib/creative-canvas/importers/campaign'
import type { CampaignAssets } from '@/lib/types/campaign'

const campaign = {
  id: 'campaign-1',
  orgId: 'org-1',
  name: 'Spring Launch',
  brandIdentity: { logoUrl: 'https://cdn.example.com/logo.png' },
}

function emptyAssets(overrides: Partial<CampaignAssets> = {}): CampaignAssets {
  return {
    campaignId: 'campaign-1',
    social: [],
    blogs: [],
    videos: [],
    meta: {
      totals: { social: 0, blogs: 0, videos: 0 },
      byStatus: { draft: 0, pending_approval: 0, approved: 0, published: 0 },
    },
    ...overrides,
  }
}

describe('buildCanvasGraphFromCampaign', () => {
  it('maps blogs, hero images, social posts, and videos into typed nodes', () => {
    const assets = emptyAssets({
      blogs: [
        {
          id: 'blog-1',
          title: 'How to grow',
          excerpt: 'Growth tips for small teams.',
          heroImageUrl: 'https://cdn.example.com/hero-1.png',
          draftPostId: 'draft-1',
        },
        {
          id: 'blog-2',
          title: 'Second post',
          draft: { wordCount: 900, generatedBy: 'agent', body: 'Long body text here.' },
        },
      ],
      social: [
        { id: 'post-1', content: 'Week one post', platforms: ['linkedin'], scheduledAt: '2026-06-01T09:00:00Z' },
        { id: 'post-2', content: 'Also week one', platforms: ['x'], scheduledAt: '2026-06-03T09:00:00Z' },
        { id: 'post-3', content: 'Week two post', platforms: ['linkedin'], scheduledAt: '2026-06-09T09:00:00Z' },
      ],
      videos: [
        {
          id: 'vid-1',
          content: 'Launch teaser',
          media: [{ type: 'video', url: 'https://cdn.example.com/vid-1.mp4', thumbnailUrl: 'https://cdn.example.com/vid-1.jpg' }],
        },
      ],
    })

    const graph = buildCanvasGraphFromCampaign(campaign, assets)

    // Brand logo + one hero image → source nodes with the upload source shape.
    const logo = graph.nodes.find((n) => n.id === 'campaign-import-brand-logo')
    expect(logo).toMatchObject({
      orgId: 'org-1',
      type: 'source',
      source: {
        kind: 'upload',
        referenceRole: 'general',
        url: 'https://cdn.example.com/logo.png',
        thumbnailUrl: 'https://cdn.example.com/logo.png',
        altText: expect.stringContaining('Spring Launch'),
      },
    })
    const hero = graph.nodes.find((n) => n.id === 'campaign-import-hero-blog-1')
    expect(hero).toMatchObject({
      type: 'source',
      source: { kind: 'upload', referenceRole: 'general', url: 'https://cdn.example.com/hero-1.png' },
    })

    // Blogs → text nodes (backend type prompt) with campaignRefs and ≤2000-char text.
    const blog1 = graph.nodes.find((n) => n.id === 'campaign-import-blog-blog-1')
    expect(blog1).toMatchObject({
      type: 'prompt',
      title: 'How to grow',
      data: {
        presentationType: 'text',
        text: 'How to grow\n\nGrowth tips for small teams.',
        campaignRefs: {
          campaignId: 'campaign-1',
          assetType: 'seo_content',
          seoContentId: 'blog-1',
          draftPostId: 'draft-1',
        },
      },
    })
    const blog2 = graph.nodes.find((n) => n.id === 'campaign-import-blog-blog-2')
    expect((blog2?.data.text as string)).toContain('Long body text here.')

    // Social posts grouped by week.
    const week1 = graph.nodes.find((n) => n.id === 'campaign-import-social-week-1')
    expect(week1).toMatchObject({
      type: 'prompt',
      title: 'Social week 1 (2 posts)',
      data: {
        presentationType: 'text',
        campaignRefs: {
          campaignId: 'campaign-1',
          socialPostIds: ['post-1', 'post-2'],
          groupedBy: 'week',
        },
      },
    })
    expect(week1?.data.text).toContain('[linkedin] Week one post')
    expect(graph.nodes.find((n) => n.id === 'campaign-import-social-week-2')).toBeDefined()

    // Videos → source nodes with motion role.
    const video = graph.nodes.find((n) => n.id === 'campaign-import-video-vid-1')
    expect(video).toMatchObject({
      type: 'source',
      source: {
        kind: 'upload',
        referenceRole: 'motion',
        url: 'https://cdn.example.com/vid-1.mp4',
        thumbnailUrl: 'https://cdn.example.com/vid-1.jpg',
      },
    })

    // Edge only for the real hero-image → blog linkage.
    expect(graph.edges).toEqual([
      expect.objectContaining({
        id: 'campaign-import-edge-hero-blog-1',
        sourceNodeId: 'campaign-import-hero-blog-1',
        targetNodeId: 'campaign-import-blog-blog-1',
        label: 'hero image',
      }),
    ])

    expect(graph.meta).toMatchObject({
      nodeCount: graph.nodes.length,
      edgeCount: 1,
      capped: false,
      droppedNodeCount: 0,
      counts: { imageSources: 2, blogs: 2, socialGroups: 2, videos: 1 },
    })
    // Every node carries the required base fields.
    for (const node of graph.nodes) {
      expect(node.id).toBeTruthy()
      expect(node.orgId).toBe('org-1')
      expect(node.title).toBeTruthy()
      expect(node.position).toEqual({ x: expect.any(Number), y: expect.any(Number) })
      expect(node.data).toBeDefined()
    }
  })

  it('groups social posts by platform when no schedule dates exist', () => {
    const assets = emptyAssets({
      social: [
        { id: 'post-1', content: 'A', platforms: ['linkedin'] },
        { id: 'post-2', content: 'B', platforms: ['linkedin'] },
        { id: 'post-3', content: 'C', platform: 'x' },
      ],
    })

    const graph = buildCanvasGraphFromCampaign(campaign, assets)
    const linkedin = graph.nodes.find((n) => n.id === 'campaign-import-social-platform-linkedin')
    expect(linkedin?.title).toBe('Social — linkedin (2 posts)')
    expect(linkedin?.data.campaignRefs).toMatchObject({ groupedBy: 'platform' })
    expect(graph.nodes.find((n) => n.id === 'campaign-import-social-platform-x')).toBeDefined()
  })

  it('truncates long blog text to 2000 characters', () => {
    const assets = emptyAssets({
      blogs: [{ id: 'blog-1', title: 'Long', excerpt: 'x'.repeat(5000) }],
    })
    const graph = buildCanvasGraphFromCampaign(campaign, assets)
    const blog = graph.nodes.find((n) => n.id === 'campaign-import-blog-blog-1')
    expect((blog?.data.text as string).length).toBeLessThanOrEqual(2000)
  })

  it('caps the graph at 40 nodes, keeps social groups last, and notes it in meta', () => {
    const assets = emptyAssets({
      blogs: Array.from({ length: 30 }, (_, i) => ({ id: `blog-${i}`, title: `Blog ${i}` })),
      videos: Array.from({ length: 8 }, (_, i) => ({
        id: `vid-${i}`,
        media: [{ type: 'video', url: `https://cdn.example.com/vid-${i}.mp4` }],
      })),
      // 12 weekly groups → only some survive the cap.
      social: Array.from({ length: 12 }, (_, i) => ({
        id: `post-${i}`,
        content: `Week ${i + 1} post`,
        scheduledAt: new Date(Date.UTC(2026, 5, 1 + i * 7)).toISOString(),
      })),
    })

    const graph = buildCanvasGraphFromCampaign(campaign, assets)

    expect(graph.nodes).toHaveLength(CAMPAIGN_IMPORT_MAX_NODES)
    expect(graph.meta.capped).toBe(true)
    // 1 logo + 30 blogs + 8 videos + 12 social groups = 51 candidates → 11 dropped.
    expect(graph.meta.droppedNodeCount).toBe(11)
    expect(graph.meta.note).toContain('40')
    // Higher-priority content survives intact.
    expect(graph.meta.counts.blogs).toBe(30)
    expect(graph.meta.counts.videos).toBe(8)
    expect(graph.meta.counts.socialGroups).toBe(1)
    // No dangling edges after the cap.
    const ids = new Set(graph.nodes.map((n) => n.id))
    for (const edge of graph.edges) {
      expect(ids.has(edge.sourceNodeId)).toBe(true)
      expect(ids.has(edge.targetNodeId)).toBe(true)
    }
  })

  it('lays nodes out in per-type columns with no overlaps', () => {
    const assets = emptyAssets({
      blogs: [
        { id: 'blog-1', title: 'One', heroImageUrl: 'https://cdn.example.com/h1.png' },
        { id: 'blog-2', title: 'Two', heroImageUrl: 'https://cdn.example.com/h2.png' },
      ],
      social: [{ id: 'post-1', content: 'A', platforms: ['x'] }],
      videos: [{ id: 'vid-1', media: [{ type: 'video', url: 'https://cdn.example.com/v.mp4' }] }],
    })

    const graph = buildCanvasGraphFromCampaign(campaign, assets)

    // Unique positions across the whole graph.
    const positions = graph.nodes.map((n) => `${n.position.x}:${n.position.y}`)
    expect(new Set(positions).size).toBe(graph.nodes.length)

    // Fixed x per content type, stacked y at 220 intervals.
    const imageNodes = graph.nodes.filter((n) => n.id.startsWith('campaign-import-hero-') || n.id === 'campaign-import-brand-logo')
    expect(imageNodes.map((n) => n.position)).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: CAMPAIGN_IMPORT_ROW_HEIGHT },
      { x: 0, y: CAMPAIGN_IMPORT_ROW_HEIGHT * 2 },
    ])
    const blogNodes = graph.nodes.filter((n) => n.id.startsWith('campaign-import-blog-'))
    expect(blogNodes.every((n) => n.position.x === CAMPAIGN_IMPORT_COLUMN_WIDTH)).toBe(true)
    const socialNodes = graph.nodes.filter((n) => n.id.startsWith('campaign-import-social-'))
    expect(socialNodes.every((n) => n.position.x === CAMPAIGN_IMPORT_COLUMN_WIDTH * 2)).toBe(true)
    const videoNodes = graph.nodes.filter((n) => n.id.startsWith('campaign-import-video-'))
    expect(videoNodes.every((n) => n.position.x === CAMPAIGN_IMPORT_COLUMN_WIDTH * 3)).toBe(true)
  })

  it('skips assets with invalid or missing URLs instead of failing', () => {
    const assets = emptyAssets({
      blogs: [{ id: 'blog-1', title: 'One', heroImageUrl: 'not-a-url' }],
      videos: [
        { id: 'vid-1', media: [{ type: 'video' }] },
        { id: 'vid-2', media: [{ type: 'video', url: 'ftp://bad.example.com/v.mp4' }] },
      ],
    })

    const graph = buildCanvasGraphFromCampaign({ ...campaign, brandIdentity: undefined }, assets)

    expect(graph.nodes.map((n) => n.id)).toEqual(['campaign-import-blog-blog-1'])
    expect(graph.edges).toHaveLength(0)
  })

  it('throws CampaignImportEmptyError when the campaign has no importable content', () => {
    expect(() => buildCanvasGraphFromCampaign({ id: 'campaign-1', orgId: 'org-1' }, emptyAssets()))
      .toThrow(CampaignImportEmptyError)
  })
})
