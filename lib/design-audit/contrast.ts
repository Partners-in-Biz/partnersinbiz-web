/**
 * WCAG 2.x relative-luminance / contrast math for the Design Audit engine.
 * Deterministic, dependency-free.
 */

export interface Rgb {
  r: number
  g: number
  b: number
}

const NAMED_COLORS: Record<string, [number, number, number]> = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  red: [255, 0, 0],
  green: [0, 128, 0],
  lime: [0, 255, 0],
  blue: [0, 0, 255],
  yellow: [255, 255, 0],
  cyan: [0, 255, 255],
  aqua: [0, 255, 255],
  magenta: [255, 0, 255],
  fuchsia: [255, 0, 255],
  silver: [192, 192, 192],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  maroon: [128, 0, 0],
  olive: [128, 128, 0],
  purple: [128, 0, 128],
  teal: [0, 128, 128],
  navy: [0, 0, 128],
  orange: [255, 165, 0],
  pink: [255, 192, 203],
  brown: [165, 42, 42],
  transparent: [255, 255, 255],
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)))
}

/** Parse a CSS color to an opaque sRGB triple, or null when unresolvable. */
export function normalizeColor(input: string): Rgb | null {
  if (!input) return null
  const value = input.trim().toLowerCase()
  if (value === 'inherit' || value === 'initial' || value === 'unset' || value === 'currentcolor') return null
  const named = NAMED_COLORS[value]
  if (named) return { r: named[0], g: named[1], b: named[2] }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(value)
  if (hex) {
    let h = hex[1]
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('')
    const r = parseInt(h.slice(0, 2), 16)
    const g = parseInt(h.slice(2, 4), 16)
    const b = parseInt(h.slice(4, 6), 16)
    if ([r, g, b].some((v) => !Number.isFinite(v))) return null
    return { r, g, b }
  }
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(value)
  if (rgb) {
    return {
      r: clampByte(parseFloat(rgb[1])),
      g: clampByte(parseFloat(rgb[2])),
      b: clampByte(parseFloat(rgb[3])),
    }
  }
  const pct = /^rgba?\(\s*([\d.]+)%[,\s]+([\d.]+)%[,\s]+([\d.]+)%/.exec(value)
  if (pct) {
    return {
      r: clampByte((parseFloat(pct[1]) / 100) * 255),
      g: clampByte((parseFloat(pct[2]) / 100) * 255),
      b: clampByte((parseFloat(pct[3]) / 100) * 255),
    }
  }
  const hsl = /^hsla?\(\s*([\d.]+)[,\s]+([\d.]+)%[,\s]+([\d.]+)%/.exec(value)
  if (hsl) {
    const [r, g, b] = hslToRgb(parseFloat(hsl[1]) % 360, parseFloat(hsl[2]) / 100, parseFloat(hsl[3]) / 100)
    return { r, g, b }
  }
  return null
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ]
}

function channelToLinear(c: number): number {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}

export function relativeLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * channelToLinear(r) + 0.7152 * channelToLinear(g) + 0.0722 * channelToLinear(b)
}

/** WCAG contrast ratio 1..21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const l1 = relativeLuminance(a)
  const l2 = relativeLuminance(b)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

export function contrastRatioFromCss(fgCss: string, bgCss: string): number | null {
  const fg = normalizeColor(fgCss)
  const bg = normalizeColor(bgCss)
  if (!fg || !bg) return null
  return contrastRatio(fg, bg)
}

export interface ReadableOptions {
  /** CSS font size, used for the large-text exception. */
  fontSizePx?: number
  /** CSS font weight, used for the large-text exception. */
  fontWeight?: number
}

/** WCAG AA: 4.5:1 normal text, 3:1 large text (>=24px, or >=18.66px bold). */
export function isReadable(fgCss: string, bgCss: string, opts: ReadableOptions = {}): boolean {
  const ratio = contrastRatioFromCss(fgCss, bgCss)
  if (ratio === null) return true // unknown -> do not false-positive
  const size = opts.fontSizePx ?? 16
  const weight = opts.fontWeight ?? 400
  const large = size >= 24 || (size >= 18.66 && weight >= 700)
  return ratio >= (large ? 3 : 4.5)
}

/** Approximate hue (degrees, 0-360) of an sRGB triple, for purple-gradient detection. */
export function hueOf({ r, g, b }: Rgb): number {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const delta = max - min
  if (delta === 0) return 0
  let h = 0
  if (max === rn) h = 60 * (((gn - bn) / delta) % 6)
  else if (max === gn) h = 60 * ((bn - rn) / delta + 2)
  else h = 60 * ((rn - gn) / delta + 4)
  return h < 0 ? h + 360 : h
}

const PURPLE_HUE_MIN = 255
const PURPLE_HUE_MAX = 335
const PURPLE_NAMED = new Set([
  'purple', 'violet', 'magenta', 'fuchsia', 'indigo', 'lavender',
  'orchid', 'plum', 'mediumpurple', 'blueviolet', 'darkviolet', 'darkmagenta',
])

/** True when a CSS color reads as purple/violet/magenta (the AI-gradient family). */
export function isPurpleish(colorCss: string): boolean {
  const value = colorCss.trim().toLowerCase()
  if (PURPLE_NAMED.has(value)) return true
  const rgb = normalizeColor(value)
  if (!rgb) return false
  const h = hueOf(rgb)
  return h >= PURPLE_HUE_MIN && h <= PURPLE_HUE_MAX
}
