import { buildCreativeCanvasCategoryEvidence } from '@/lib/creative-canvas/export-evidence'

describe('buildCreativeCanvasCategoryEvidence', () => {
  it('builds durable evidence for all five strict proof categories', () => {
    const completedAt = '2026-06-21T14:00:00.000Z'
    const evidence = buildCreativeCanvasCategoryEvidence({
      completedAt,
      binding: {
        orgId: 'org-1',
        canvasVersion: 3,
        graphSignature: 'graph-signature-123',
        nodeCount: 12,
        edgeCount: 10,
      },
      runs: [
        run('image-1', 'image', 'higgsfield-job-image-1', 'output-image', 'https://cdn.example.com/image-1.png'),
        run('image-2', 'campaign_asset', 'higgsfield-job-image-2', 'output-image', 'https://cdn.example.com/image-2.png'),
        run('video-1', 'video', 'higgsfield-job-video-1', 'output-video', 'https://cdn.example.com/video-1.mp4'),
        run('video-2', 'social_post_draft', 'higgsfield-job-video-2', 'output-video', 'https://cdn.example.com/video-2.mp4'),
        run('audio-1', 'audio', 'higgsfield-job-audio-1', 'output-audio', 'https://cdn.example.com/audio-1.mp3'),
        run('audio-2', 'audio', 'higgsfield-job-audio-2', 'output-audio', 'https://cdn.example.com/audio-2.mp3'),
        run('blog-1', 'blog_draft', undefined, 'output-blog', undefined, 'Blog draft'),
        run('blog-2', 'document_block', undefined, 'output-blog', undefined, 'Document block'),
        run('book-1', 'book_artifact', 'higgsfield-job-book-1', 'output-book', 'https://cdn.example.com/book-1.pdf'),
        run('book-2', 'book_artifact', 'higgsfield-job-book-2', 'output-book', 'https://cdn.example.com/book-2.pdf'),
      ],
      exports: [
        draftExport('export-image', 'image_campaign', 'output-image', 'draft-image', ['source-product']),
        draftExport('export-video', 'video_social', 'output-video', 'draft-video', ['source-video']),
        draftExport('export-audio', 'audio', 'output-audio', 'draft-audio', ['source-audio']),
        draftExport('export-blog', 'blog_document', 'output-blog', 'draft-blog', ['source-research']),
        draftExport('export-book', 'book', 'output-book', 'draft-book', ['source-book']),
      ],
    })

    expect(evidence.runtimeCategoryEvidence).toHaveLength(5)
    expect(evidence.exportCategoryEvidence).toHaveLength(5)
    expect(evidence.runtimeCategoryEvidence.map((item) => item.categoryKey)).toEqual([
      'image',
      'video_social',
      'audio',
      'blog_document',
      'book',
    ])
    expect(evidence.runtimeCategoryEvidence.find((item) => item.categoryKey === 'audio')?.providerJobIds).toHaveLength(2)
    expect(evidence.runtimeCategoryEvidence.find((item) => item.categoryKey === 'blog_document')?.providerJobIds).toEqual([])
    expect(evidence.exportCategoryEvidence.find((item) => item.categoryKey === 'book')?.downstreamDraftIds).toEqual(['draft-book'])
    expect(evidence.exportCategoryEvidence.find((item) => item.categoryKey === 'image')?.exportIds).toEqual(['export-image'])
  })

  it('omits runtime categories without two completed artifact-backed runs', () => {
    const evidence = buildCreativeCanvasCategoryEvidence({
      completedAt: '2026-06-21T14:00:00.000Z',
      runs: [
        run('image-1', 'image', 'higgsfield-job-image-1', 'output-image', 'https://cdn.example.com/image-1.png'),
        run('image-2', 'campaign_asset', undefined, 'output-image', 'https://cdn.example.com/image-2.png'),
        run('blog-1', 'blog_draft', undefined, 'output-blog', undefined, 'Blog draft'),
        run('blog-2', 'document_block', undefined, 'output-blog', undefined, 'Document block'),
      ],
      exports: [],
    })

    expect(evidence.runtimeCategoryEvidence.map((item) => item.categoryKey)).toEqual(['blog_document'])
    expect(evidence.exportCategoryEvidence).toEqual([])
  })
})

function run(
  id: string,
  outputKind: string,
  providerJobId: string | undefined,
  outputNodeId: string,
  url?: string,
  textPreview?: string,
) {
  return {
    id,
    status: 'completed',
    input: { outputKind },
    providerKey: 'higgsfield',
    provenance: providerJobId ? { providerJobId } : {},
    output: { nodeId: outputNodeId, outputNodeId, url, textPreview, rawProviderJobId: providerJobId },
  }
}

function draftExport(
  id: string,
  categoryKey: string,
  outputNodeId: string,
  downstreamDraftId: string,
  sourceNodeIds: string[],
) {
  return {
    id,
    categoryKey,
    outputNodeId,
    downstreamDraftId,
    sourceNodeIds,
    target: categoryKey,
    status: 'drafted',
    createdAt: '2026-06-21T14:00:00.000Z',
  }
}
