/**
 * DESIGN.md / design.json context loading for the Design Audit engine.
 *
 * Mirrors Impeccable's DESIGN.md awareness: when a per-client Design Context
 * exists, the engine enables design-system-drift rules (fonts, colors, radii,
 * font sizes outside the documented system). The parser accepts the Google
 * Stitch-ish markdown shape used by /impeccable document:
 *
 *   ## Colors
 *   - Primary: #0F172A
 *   - #64748B
 *
 *   ## Typography
 *   - Display: "Space Grotesk"
 *   - Inter
 *
 *   ## Radii
 *   - sm: 4px
 *   - 8px
 *
 *   ## Font Sizes
 *   - 12px, 14px, 16px, 20px
 *
 * and the machine-readable `.impeccable/design.json` sidecar.
 */

import type { DesignSystem } from './types'
import { normalizeColor } from './contrast'

const SECTION_HEADINGS: Array<{ re: RegExp; key: 'palette' | 'fonts' | 'radii' | 'fontSize' }> = [
  { re: /^#+\s*(colors?|palette)/i, key: 'palette' },
  // fontSize must be checked before fonts: "Font Sizes" also matches `fonts?`.
  { re: /^#+\s*(font\s*sizes?|type\s*scale|font\s*ramp)/i, key: 'fontSize' },
  { re: /^#+\s*(typography|fonts?|type\s*faces?)/i, key: 'fonts' },
  { re: /^#+\s*(radii?|radius|shape|border\s*radii?)/i, key: 'radii' },
]

export interface DesignJson {
  palette?: string[]
  fonts?: string[]
  radii?: Array<number | string>
  fontSize?: Array<number | string>
  design?: DesignJson
}

function normalizeHex(h: string): string | null {
  const rgb = normalizeColor(h)
  if (!rgb) return null
  return '#' + [rgb.r, rgb.g, rgb.b].map((v) => v.toString(16).padStart(2, '0')).join('')
}

function parsePx(value: string): number | null {
  const m = /^([\d.]+)\s*(px)?$/.exec(value.trim())
  if (!m) return null
  const n = parseFloat(m[1])
  return Number.isFinite(n) ? n : null
}

function extractListValues(text: string, key: 'palette' | 'fonts' | 'radii' | 'fontSize'): string[] {
  const values = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || /^#/.test(trimmed) || !/^[-*]/.test(trimmed)) continue
    const item = trimmed.replace(/^[-*]\s*/, '')
    if (key === 'palette') {
      const hexMatch = item.match(/#[0-9a-fA-F]{3,8}\b/g)
      if (hexMatch) for (const h of hexMatch) {
        const norm = normalizeHex(h)
        if (norm) values.add(norm)
      }
      continue
    }
    if (key === 'fonts') {
      const family = item.replace(/^[^:]*:\s*/, '').replace(/^["']|["']$/g, '').trim()
      if (family && !/^(sans-serif|serif|monospace|inherit)$/i.test(family)) values.add(family)
      continue
    }
    if (key === 'radii' || key === 'fontSize') {
      // Strip an optional label prefix ("sm: 4px") and allow comma lists ("14px, 16px").
      const numericPart = item.replace(/^[^:]*:\s*/, '')
      for (const token of numericPart.split(',')) {
        const px = parsePx(token)
        if (px !== null) values.add(String(px))
      }
      continue
    }
  }
  return [...values]
}

export function parseDesignMd(markdown: string, source = 'DESIGN.md'): DesignSystem {
  const design: DesignSystem = { palette: [], fonts: [], radii: [], fontSize: [], source }
  const sections = new Map<'palette' | 'fonts' | 'radii' | 'fontSize', string[]>()
  let current: 'palette' | 'fonts' | 'radii' | 'fontSize' | null = null
  for (const line of markdown.split(/\r?\n/)) {
    const heading = SECTION_HEADINGS.find((h) => h.re.test(line.trim()))
    if (heading) {
      current = heading.key
      if (!sections.has(current)) sections.set(current, [])
      continue
    }
    if (current) sections.get(current)!.push(line)
  }
  for (const [key, lines] of sections) {
    const values = extractListValues(lines.join('\n'), key)
    if (key === 'palette') design.palette = [...design.palette, ...values]
    else if (key === 'fonts') design.fonts = [...design.fonts, ...values]
    else if (key === 'radii') design.radii = [...design.radii, ...values.map((v) => parseFloat(v)).filter((n) => Number.isFinite(n))]
    else if (key === 'fontSize') design.fontSize = [...design.fontSize, ...values.map((v) => parseFloat(v)).filter((n) => Number.isFinite(n))]
  }
  return dedupeDesign(design)
}

export function parseDesignJson(jsonText: string, source = 'design.json'): DesignSystem {
  const parsed = JSON.parse(jsonText) as DesignJson
  const root = parsed.design ?? parsed
  const design: DesignSystem = { palette: [], fonts: [], radii: [], fontSize: [], source }
  if (Array.isArray(root.palette)) {
    for (const entry of root.palette) {
      const norm = normalizeHex(String(entry))
      if (norm) design.palette.push(norm)
    }
  }
  if (Array.isArray(root.fonts)) {
    for (const entry of root.fonts) {
      const family = String(entry).replace(/^["']|["']$/g, '').trim()
      if (family) design.fonts.push(family)
    }
  }
  for (const key of ['radii', 'fontSize'] as const) {
    const list = root[key]
    if (Array.isArray(list)) {
      for (const entry of list) {
        const n = typeof entry === 'number' ? entry : parsePx(String(entry))
        if (n !== null && Number.isFinite(n)) design[key].push(n)
      }
    }
  }
  return dedupeDesign(design)
}

export function dedupeDesign(design: DesignSystem): DesignSystem {
  return {
    palette: [...new Set(design.palette.map((c) => c.toLowerCase()))],
    fonts: [...new Set(design.fonts.map((f) => f.trim()))],
    radii: [...new Set(design.radii)].sort((a, b) => a - b),
    fontSize: [...new Set(design.fontSize)].sort((a, b) => a - b),
    source: design.source,
  }
}

export function designSystemIsEmpty(design: DesignSystem): boolean {
  return design.palette.length === 0 && design.fonts.length === 0 && design.radii.length === 0 && design.fontSize.length === 0
}

/** True when a color (css value) is in the documented palette (normalized compare). */
export function colorInPalette(design: DesignSystem, colorCss: string): boolean {
  const norm = normalizeHex(colorCss)
  if (!norm) return true // unresolvable -> do not false-positive
  return design.palette.some((p) => p.toLowerCase() === norm)
}

/** True when a font family is in the documented type stack. */
export function fontInStack(design: DesignSystem, family: string): boolean {
  const key = family.toLowerCase().trim()
  return design.fonts.some((f) => f.toLowerCase().trim() === key)
}

/** True when a radius (px) is in the documented radii scale (within 0.5px rounding tolerance). */
export function radiusInScale(design: DesignSystem, radiusPx: number): boolean {
  return design.radii.some((r) => Math.abs(r - radiusPx) <= 0.5)
}

/** True when a font size (px) is in the documented type scale (within 0.5px rounding tolerance). */
export function fontSizeInScale(design: DesignSystem, sizePx: number): boolean {
  return design.fontSize.some((s) => Math.abs(s - sizePx) <= 0.5)
}
