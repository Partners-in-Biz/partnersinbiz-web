import {
  contrastRatio, contrastRatioFromCss, isReadable, normalizeColor, isPurpleish, hueOf,
} from '@/lib/design-audit/contrast'

describe('design-audit contrast math', () => {
  it('parses hex colors', () => {
    expect(normalizeColor('#fff')).toEqual({ r: 255, g: 255, b: 255 })
    expect(normalizeColor('#0f172a')).toEqual({ r: 15, g: 23, b: 42 })
    expect(normalizeColor('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30 })
    expect(normalizeColor('rgba(10, 20, 30, 0.5)')).toEqual({ r: 10, g: 20, b: 30 })
  })

  it('computes the canonical white/black ratio', () => {
    expect(contrastRatio({ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 })).toBeCloseTo(21, 1)
    expect(contrastRatioFromCss('#ffffff', '#000000')).toBeCloseTo(21, 1)
    expect(contrastRatioFromCss('#ffffff', '#ffffff')).toBeCloseTo(1, 2)
  })

  it('implements the WCAG AA thresholds', () => {
    // Light gray on white fails (1.6:1-ish is the catalog example).
    expect(isReadable('#f5f5f5', '#ffffff')).toBe(false)
    // Black on white passes.
    expect(isReadable('#000000', '#ffffff')).toBe(true)
    // Gray #767676 on white passes AA (4.54:1).
    expect(isReadable('#767676', '#ffffff')).toBe(true)
    // Large text only needs 3:1.
    expect(isReadable('#949494', '#ffffff', { fontSizePx: 24 })).toBe(true)
    expect(isReadable('#949494', '#ffffff', { fontSizePx: 16 })).toBe(false)
  })

  it('detects purple hues for the gradient rule', () => {
    expect(isPurpleish('#7c3aed')).toBe(true) // violet-600
    expect(isPurpleish('#2563eb')).toBe(false) // blue-600
    expect(isPurpleish('purple')).toBe(true)
    expect(isPurpleish('#ffffff')).toBe(false)
    expect(hueOf({ r: 124, g: 58, b: 237 })).toBeGreaterThan(255)
    expect(hueOf({ r: 124, g: 58, b: 237 })).toBeLessThan(335)
  })
})
