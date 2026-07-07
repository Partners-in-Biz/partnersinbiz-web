import { applyLayoutPreset, LAYOUT_PRESETS } from '@/lib/video-editor/layout-presets'

const settings = { width: 1920, height: 1080, fps: 30 as const, aspect: '16:9' as const, background: '#000000' }

describe('layout presets', () => {
  it('exposes the locked presets', () => {
    expect(LAYOUT_PRESETS.map((preset) => preset.id)).toEqual([
      'pip_top_left', 'pip_top_right', 'pip_bottom_left', 'pip_bottom_right', 'side_by_side', 'top_bottom',
    ])
  })

  it('corner PiP scales the single clip to 0.3 and pins it with a 48px margin', () => {
    const patches = applyLayoutPreset('pip_bottom_right', settings, ['c1'])
    expect(patches).toEqual([{
      clipId: 'c1',
      transform: { x: (1920 - 1920 * 0.3) / 2 - 48, y: (1080 - 1080 * 0.3) / 2 - 48, scale: 0.3, rotation: 0, opacity: 1 },
    }])
  })

  it('side-by-side splits two clips at half scale', () => {
    const patches = applyLayoutPreset('side_by_side', settings, ['c1', 'c2'])
    expect(patches).toEqual([
      { clipId: 'c1', transform: { x: -480, y: 0, scale: 0.5, rotation: 0, opacity: 1 } },
      { clipId: 'c2', transform: { x: 480, y: 0, scale: 0.5, rotation: 0, opacity: 1 } },
    ])
  })

  it('top-bottom stacks two clips', () => {
    const patches = applyLayoutPreset('top_bottom', settings, ['c1', 'c2'])
    expect(patches).toEqual([
      { clipId: 'c1', transform: { x: 0, y: -270, scale: 0.5, rotation: 0, opacity: 1 } },
      { clipId: 'c2', transform: { x: 0, y: 270, scale: 0.5, rotation: 0, opacity: 1 } },
    ])
  })

  it('returns [] when the clip count does not match the preset', () => {
    expect(applyLayoutPreset('side_by_side', settings, ['c1'])).toEqual([])
    expect(applyLayoutPreset('pip_top_left', settings, ['c1', 'c2'])).toEqual([])
  })
})
