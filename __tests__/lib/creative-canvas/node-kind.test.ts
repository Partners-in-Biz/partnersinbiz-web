import { resolveGeneratorKind } from '@/lib/creative-canvas/node-kind'
import type { CreativeCanvasNode } from '@/lib/creative-canvas/types'

function node(partial: Partial<CreativeCanvasNode>): CreativeCanvasNode {
  return { id: 'n', orgId: 'o', type: 'model', title: 't', position: { x: 0, y: 0 }, data: {}, ...partial }
}

describe('resolveGeneratorKind', () => {
  it('classifies by the resolved model kind (image)', () => {
    expect(resolveGeneratorKind(node({ provider: { key: 'higgsfield', model: 'text2image_soul_v2' } }))).toBe('image')
  })

  it('classifies a video model as video even with a descriptive provider mode', () => {
    // The UGC-ad template shape: video model + non-literal mode + motion edit.
    const n = node({
      provider: { key: 'higgsfield', model: 'seedance_2_0', mode: 'vertical_social' },
      edit: { operation: 'video_motion', outputKind: 'social_post_draft', references: [] },
    })
    expect(resolveGeneratorKind(n)).toBe('video')
  })

  it('lets an explicit modelId override the stored provider model', () => {
    const n = node({ provider: { key: 'higgsfield', model: 'text2image_soul_v2' } })
    // User picks a video model in the panel → node should be treated as video.
    expect(resolveGeneratorKind(n, 'cinematic_studio_video_3_5')).toBe('video')
    // …and picking an image model on a video-moded node → image.
    const v = node({ provider: { key: 'higgsfield', model: 'seedance_2_0', mode: 'video' } })
    expect(resolveGeneratorKind(v, 'text2image_soul_v2')).toBe('image')
  })

  it('classifies audio via model kind, provider mode, or presentation hint', () => {
    expect(resolveGeneratorKind(node({ provider: { key: 'higgsfield', model: 'mirelo_text_to_audio' } }))).toBe('audio')
    expect(resolveGeneratorKind(node({ data: { presentationType: 'voiceover' } }))).toBe('audio')
  })

  it('falls back to metadata when no model resolves', () => {
    expect(resolveGeneratorKind(node({ data: { outputKind: 'video' } }))).toBe('video')
    expect(resolveGeneratorKind(node({ provider: { key: 'higgsfield', mode: 'video' } }))).toBe('video')
    expect(resolveGeneratorKind(node({}))).toBe('image')
  })
})
