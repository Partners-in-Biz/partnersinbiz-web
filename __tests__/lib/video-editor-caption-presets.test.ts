import { CAPTION_STYLE_PRESETS, CAPTION_ANIMATION_LABELS } from '@/lib/video-editor/caption-presets'
import { EDITOR_CAPTION_ANIMATION_PRESETS, EDITOR_CAPTION_STYLE_PRESETS } from '@/lib/video-editor/types'

describe('caption presets', () => {
  it('covers every style preset key exactly once', () => {
    expect(Object.keys(CAPTION_STYLE_PRESETS).sort()).toEqual([...EDITOR_CAPTION_STYLE_PRESETS].sort())
  })
  it('covers every animation preset with a label', () => {
    expect(Object.keys(CAPTION_ANIMATION_LABELS).sort()).toEqual([...EDITOR_CAPTION_ANIMATION_PRESETS].sort())
  })
  it('karaoke_bar has a highlight color for word-by-word rendering', () => {
    expect(CAPTION_STYLE_PRESETS.karaoke_bar.highlightColor).toBe('#ffd400')
  })
})
