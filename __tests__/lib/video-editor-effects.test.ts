// __tests__/lib/video-editor-effects.test.ts
import {
  EDITOR_EFFECT_KINDS,
  EDITOR_EFFECT_DEFS,
  defaultEffectInstance,
  sanitizeEffectInstance,
} from '@/lib/video-editor/effects'

describe('editor effect registry', () => {
  it('exposes every locked effect kind with a def', () => {
    expect([...EDITOR_EFFECT_KINDS].sort()).toEqual([
      'blur', 'chroma_key', 'color_adjust', 'glow', 'grain', 'lut', 'mask',
      'noise_reduction', 'sharpen', 'stabilize', 'vignette', 'voice_isolation',
    ])
    for (const kind of EDITOR_EFFECT_KINDS) {
      expect(EDITOR_EFFECT_DEFS[kind].label).toBeTruthy()
      expect(['video', 'audio']).toContain(EDITOR_EFFECT_DEFS[kind].target)
    }
    expect(EDITOR_EFFECT_DEFS.noise_reduction.target).toBe('audio')
    expect(EDITOR_EFFECT_DEFS.voice_isolation.target).toBe('audio')
  })

  it('builds a default instance with every param at its default', () => {
    expect(defaultEffectInstance('color_adjust')).toEqual({
      kind: 'color_adjust',
      params: { brightness: 0, contrast: 1, saturation: 1, temperature: 6500, hue: 0 },
    })
    expect(defaultEffectInstance('chroma_key')).toEqual({
      kind: 'chroma_key',
      params: { color: '#00ff00', similarity: 0.25, blend: 0.1 },
    })
  })

  it('sanitizes: clamps numbers, validates colors/selects, drops unknown kinds and params', () => {
    expect(sanitizeEffectInstance({ kind: 'sparkle_magic', params: {} })).toBeNull()
    expect(sanitizeEffectInstance({ kind: 'blur', params: { sigma: 9999, junk: 'x' } }))
      .toEqual({ kind: 'blur', params: { sigma: 50 } })
    expect(sanitizeEffectInstance({ kind: 'chroma_key', params: { color: 'javascript:evil', similarity: 0.5 } }))
      .toEqual({ kind: 'chroma_key', params: { color: '#00ff00', similarity: 0.5, blend: 0.1 } })
    expect(sanitizeEffectInstance({ kind: 'mask', params: { shape: 'triangle', invert: true } }))
      .toEqual({ kind: 'mask', params: { shape: 'rectangle', x: 0.1, y: 0.1, width: 0.8, height: 0.8, feather: 40, invert: true } })
    // lut keeps only https urls
    expect(sanitizeEffectInstance({ kind: 'lut', params: { lutUrl: 'ftp://x/a.cube', intensity: 2 } }))
      .toEqual({ kind: 'lut', params: { lutUrl: '', intensity: 1 } })
    expect(sanitizeEffectInstance({ kind: 'lut', params: { lutUrl: 'https://firebasestorage.googleapis.com/x.cube', intensity: 0.5 } }))
      .toEqual({ kind: 'lut', params: { lutUrl: 'https://firebasestorage.googleapis.com/x.cube', intensity: 0.5 } })
  })
})
