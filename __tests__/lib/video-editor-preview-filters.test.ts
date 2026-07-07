import { effectsToCssFilter } from '@/lib/video-editor/preview-filters'

describe('effectsToCssFilter', () => {
  it('maps color_adjust and blur to CSS filter functions', () => {
    expect(effectsToCssFilter([
      { kind: 'color_adjust', params: { brightness: 0.2, contrast: 1.1, saturation: 0.9, temperature: 6500, hue: 30 } },
      { kind: 'blur', params: { sigma: 4 } },
    ])).toBe('brightness(1.2) contrast(1.1) saturate(0.9) hue-rotate(30deg) blur(4px)')
  })

  it('skips non-CSS-approximable effects and returns empty for none', () => {
    expect(effectsToCssFilter([{ kind: 'chroma_key', params: { color: '#00ff00', similarity: 0.25, blend: 0.1 } }])).toBe('')
    expect(effectsToCssFilter([{ kind: 'grain', params: { strength: 20 } }])).toBe('')
    expect(effectsToCssFilter(undefined)).toBe('')
  })

  it('skips no-op params', () => {
    expect(effectsToCssFilter([
      { kind: 'color_adjust', params: { brightness: 0, contrast: 1, saturation: 1, temperature: 6500, hue: 0 } },
    ])).toBe('')
  })
})
