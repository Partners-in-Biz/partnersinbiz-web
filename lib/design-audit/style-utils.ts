/**
 * Static style resolution helpers for the Design Audit engine.
 *
 * Rules read "what does this element look like" from three sources, in order:
 *   1. computedStyles (browser mode, keyed by element path)
 *   2. inline style attribute
 *   3. well-known Tailwind/utility class conventions
 * All values are approximations with documented thresholds — the engine is a
 * deterministic lint, not a rendering engine.
 */

import type { ElementNode, RuleContext, StyleBlock } from './types'
import { pathOf } from './parser'

const FONT_SIZE_CLASS: Record<string, number> = {
  'text-xs': 12, 'text-sm': 14, 'text-base': 16, 'text-lg': 18, 'text-xl': 20,
  'text-2xl': 24, 'text-3xl': 30, 'text-4xl': 36, 'text-5xl': 48, 'text-6xl': 60,
  'text-7xl': 72, 'text-8xl': 96, 'text-9xl': 128,
}

const FONT_WEIGHT_CLASS: Record<string, number> = {
  'font-thin': 100, 'font-extralight': 200, 'font-light': 300, 'font-normal': 400,
  'font-medium': 500, 'font-semibold': 600, 'font-bold': 700, 'font-extrabold': 800,
  'font-black': 900,
}

const LEADING_CLASS: Record<string, number> = {
  'leading-none': 1, 'leading-tight': 1.25, 'leading-snug': 1.375,
  'leading-normal': 1.5, 'leading-relaxed': 1.625, 'leading-loose': 2,
}

const TRACKING_CLASS: Record<string, number> = {
  'tracking-tighter': -0.05, 'tracking-tight': -0.025, 'tracking-normal': 0,
  'tracking-wide': 0.025, 'tracking-wider': 0.05, 'tracking-widest': 0.1,
}

const PADDING_CLASS: Record<string, number> = {
  'p-0': 0, 'p-px': 1, 'p-0.5': 2, 'p-1': 4, 'p-1.5': 6, 'p-2': 8, 'p-2.5': 10,
  'p-3': 12, 'p-3.5': 14, 'p-4': 16, 'p-5': 20, 'p-6': 24, 'p-7': 28, 'p-8': 32,
  'p-9': 36, 'p-10': 40, 'p-11': 44, 'p-12': 48, 'p-14': 56, 'p-16': 64,
}

const RADIUS_CLASS: Record<string, number> = {
  'rounded-none': 0, 'rounded-sm': 2, 'rounded': 4, 'rounded-md': 6,
  'rounded-lg': 8, 'rounded-xl': 12, 'rounded-2xl': 16, 'rounded-3xl': 24,
  'rounded-full': 9999,
}

const OPACITY_CLASS: Record<string, number> = {
  'opacity-0': 0, 'opacity-5': 0.05, 'opacity-10': 0.1, 'opacity-20': 0.2,
  'opacity-25': 0.25, 'opacity-30': 0.3, 'opacity-40': 0.4, 'opacity-50': 0.5,
  'opacity-60': 0.6, 'opacity-70': 0.7, 'opacity-75': 0.75, 'opacity-80': 0.8,
  'opacity-90': 0.9, 'opacity-95': 0.95, 'opacity-100': 1,
}

const BORDER_WIDTH_CLASS: Record<string, number> = {
  border: 1, 'border-0': 0, 'border-2': 2, 'border-4': 4, 'border-8': 8,
}

const OVERUSED_FONTS = new Set([
  'inter', 'poppins', 'roboto', 'montserrat', 'lato', 'dm sans', 'plus jakarta sans',
  'outfit', 'sora', 'manrope', 'space grotesk', 'nunito sans', 'open sans',
  'raleway', 'rubik', 'figtree', 'kumbh sans',
])

export function computed(el: ElementNode, prop: string, ctx: RuleContext): string | undefined {
  const map = ctx.computedStyles?.[pathOf(el)]
  if (!map) return undefined
  return map[prop.toLowerCase()]
}

export function hasClass(el: ElementNode, predicate: (cls: string) => boolean): boolean {
  return el.classes.some(predicate)
}

/** px value from a CSS length, or null when unparsable. rem -> 16px base, pt -> px. */
export function parseLengthPx(value: string | undefined): number | null {
  if (!value) return null
  const v = value.trim().toLowerCase()
  const num = parseFloat(v)
  if (!Number.isFinite(num)) return null
  if (v.endsWith('rem')) return num * 16
  if (v.endsWith('em')) return num * 16
  if (v.endsWith('pt')) return (num * 4) / 3
  if (v.endsWith('px') || /^\d+(\.\d+)?$/.test(v)) return num
  return null
}

export function fontSizePx(el: ElementNode, ctx: RuleContext): number | null {
  const c = computed(el, 'font-size', ctx)
  if (c) {
    const px = parseLengthPx(c)
    if (px !== null) return px
  }
  if (el.style['font-size']) {
    const px = parseLengthPx(el.style['font-size'])
    if (px !== null) return px
  }
  for (const cls of el.classes) {
    const m = /^text-\[(\d+(?:\.\d+)?)px\]$/.exec(cls)
    if (m) return parseFloat(m[1])
    if (FONT_SIZE_CLASS[cls]) return FONT_SIZE_CLASS[cls]
  }
  return null
}

export function fontWeight(el: ElementNode, ctx: RuleContext): number | null {
  const c = computed(el, 'font-weight', ctx)
  if (c) {
    const n = parseInt(c, 10)
    if (Number.isFinite(n)) return n
    if (c === 'bold') return 700
    if (c === 'normal') return 400
  }
  if (el.style['font-weight']) {
    const n = parseInt(el.style['font-weight'], 10)
    if (Number.isFinite(n)) return n
  }
  for (const cls of el.classes) {
    if (FONT_WEIGHT_CLASS[cls]) return FONT_WEIGHT_CLASS[cls]
  }
  return el.tag === 'strong' || el.tag === 'b' ? 700 : null
}

export function lineHeightRatio(el: ElementNode, ctx: RuleContext): number | null {
  const c = computed(el, 'line-height', ctx)
  if (c) {
    const v = c.trim()
    const unitless = parseFloat(v)
    if (Number.isFinite(unitless)) return unitless
    const px = parseLengthPx(v)
    const fs = fontSizePx(el, ctx)
    if (px !== null && fs) return px / fs
  }
  if (el.style['line-height']) {
    const v = el.style['line-height'].trim()
    const unitless = parseFloat(v)
    if (Number.isFinite(unitless)) return unitless
    const px = parseLengthPx(v)
    const fs = fontSizePx(el, ctx)
    if (px !== null && fs) return px / fs
  }
  for (const cls of el.classes) {
    if (LEADING_CLASS[cls]) return LEADING_CLASS[cls]
  }
  return null
}

export function letterSpacingEm(el: ElementNode, ctx: RuleContext): number | null {
  const c = computed(el, 'letter-spacing', ctx)
  if (c) {
    const em = parseLetterSpacing(c)
    if (em !== null) return em
  }
  if (el.style['letter-spacing']) {
    const em = parseLetterSpacing(el.style['letter-spacing'])
    if (em !== null) return em
  }
  for (const cls of el.classes) {
    if (TRACKING_CLASS[cls]) return TRACKING_CLASS[cls]
  }
  return null
}

function parseLetterSpacing(v: string): number | null {
  const t = v.trim().toLowerCase()
  if (t.endsWith('em')) return parseFloat(t)
  if (t.endsWith('px')) {
    const px = parseFloat(t)
    return Number.isFinite(px) ? px / 16 : null
  }
  const n = parseFloat(t)
  return Number.isFinite(n) ? n / 16 : null
}

export function textAlign(el: ElementNode, ctx: RuleContext): string | null {
  const c = computed(el, 'text-align', ctx)
  if (c) return c.trim().toLowerCase()
  if (el.style['text-align']) return el.style['text-align'].trim().toLowerCase()
  if (hasClass(el, (cls) => cls === 'text-justify')) return 'justify'
  if (hasClass(el, (cls) => cls === 'text-center')) return 'center'
  if (hasClass(el, (cls) => cls === 'text-right')) return 'right'
  return null
}

export function colorOf(el: ElementNode, prop: string, ctx: RuleContext): string | null {
  const c = computed(el, prop, ctx)
  if (c) return c.trim()
  const inline = el.style[prop]
  if (inline) return inline.trim()
  if (prop === 'color') {
    // Tailwind text color classes, e.g. text-gray-500, text-white.
    const cls = el.classes.find((x) => /^text-(white|black|gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}$/.test(x) || /^text-(white|black)$/.test(x))
    if (cls) {
      const name = cls.slice(5)
      if (name === 'white') return '#ffffff'
      if (name === 'black') return '#000000'
      return null // Tailwind palette hex not statically resolvable
    }
  }
  return null
}

export function backgroundColor(el: ElementNode, ctx: RuleContext): string | null {
  const c = computed(el, 'background-color', ctx)
  if (c) return c.trim()
  if (el.style['background-color']) return el.style['background-color'].trim()
  const bg = el.style['background']
  if (bg && !bg.includes('gradient')) {
    const tokens = bg.split(/\s+/)
    const colorToken = tokens.find((t) => t.startsWith('#') || /^rgba?\(/.test(t) || /^[a-z]+$/i.test(t))
    if (colorToken) return colorToken
  }
  if (hasClass(el, (cls) => /^bg-(white|black)$/.test(cls))) {
    return el.classes.find((cls) => /^bg-(white|black)$/.test(cls))!.slice(3) === 'white' ? '#ffffff' : '#000000'
  }
  // Tailwind bg-<color>-<shade>: resolvable as "has a background" for card/tile
  // detection even though the exact hex is not statically known.
  const tileBg = el.classes.find((cls) => /^bg-(red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|gray|grey|slate|zinc|neutral|stone)-\d{2,3}$/.test(cls))
  if (tileBg) return tileBg
  return null
}

export function backgroundImage(el: ElementNode, ctx: RuleContext): string | null {
  const c = computed(el, 'background-image', ctx)
  if (c) return c.trim()
  if (el.style['background-image']) return el.style['background-image'].trim()
  const bg = el.style['background']
  if (bg && bg.includes('gradient')) return bg
  return null
}

export function backdropFilter(el: ElementNode, ctx: RuleContext): string | null {
  const c = computed(el, 'backdrop-filter', ctx)
  if (c) return c.trim()
  if (el.style['backdrop-filter']) return el.style['backdrop-filter'].trim()
  if (hasClass(el, (cls) => /^backdrop-blur/.test(cls))) return 'blur()'
  return null
}

export interface BoxSides {
  top?: number
  right?: number
  bottom?: number
  left?: number
}

function sidesFromShorthand(v: string): BoxSides | null {
  const parts = v.trim().split(/\s+/).map((p) => parseLengthPx(p))
  if (parts.some((p) => p === null)) return null
  const nums = parts as number[]
  if (nums.length === 1) return { top: nums[0], right: nums[0], bottom: nums[0], left: nums[0] }
  if (nums.length === 2) return { top: nums[0], right: nums[1], bottom: nums[0], left: nums[1] }
  if (nums.length === 3) return { top: nums[0], right: nums[1], bottom: nums[2], left: nums[1] }
  if (nums.length === 4) return { top: nums[0], right: nums[1], bottom: nums[2], left: nums[3] }
  return null
}

export function padding(el: ElementNode, ctx: RuleContext): BoxSides {
  const out: BoxSides = {}
  const c = computed(el, 'padding', ctx)
  if (c) {
    const sides = sidesFromShorthand(c)
    if (sides) Object.assign(out, sides)
  }
  if (el.style['padding']) {
    const sides = sidesFromShorthand(el.style['padding'])
    if (sides) Object.assign(out, sides)
  }
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const key = `padding-${side}`
    const cSide = computed(el, key, ctx)
    if (cSide) {
      const px = parseLengthPx(cSide)
      if (px !== null) out[side] = px
    }
    if (el.style[key]) {
      const px = parseLengthPx(el.style[key])
      if (px !== null) out[side] = px
    }
  }
  for (const cls of el.classes) {
    const sideMatch = /^(p[trblxy])-(.+)$/.exec(cls)
    if (sideMatch) {
      const dir = sideMatch[1]
      const scale = PADDING_CLASS[`p-${sideMatch[2]}`]
      if (scale === undefined) continue
      if (dir === 'p') { out.top = scale; out.right = scale; out.bottom = scale; out.left = scale }
      else if (dir === 'px') { out.left = scale; out.right = scale }
      else if (dir === 'py') { out.top = scale; out.bottom = scale }
      else if (dir === 'pt') out.top = scale
      else if (dir === 'pr') out.right = scale
      else if (dir === 'pb') out.bottom = scale
      else if (dir === 'pl') out.left = scale
    }
  }
  return out
}

export function minPadding(el: ElementNode, ctx: RuleContext): number | null {
  const p = padding(el, ctx)
  const values = [p.top, p.right, p.bottom, p.left].filter((v): v is number => v !== undefined)
  return values.length ? Math.min(...values) : null
}

export function borderRadiusPx(el: ElementNode, ctx: RuleContext): number | null {
  const c = computed(el, 'border-radius', ctx)
  if (c) {
    const px = parseLengthPx(c)
    if (px !== null) return px
  }
  if (el.style['border-radius']) {
    const px = parseLengthPx(el.style['border-radius'])
    if (px !== null) return px
  }
  for (const cls of el.classes) {
    if (RADIUS_CLASS[cls]) return RADIUS_CLASS[cls]
    const m = /^rounded-\[(\d+(?:\.\d+)?)px\]$/.exec(cls)
    if (m) return parseFloat(m[1])
  }
  return null
}

export function borderWidths(el: ElementNode, ctx: RuleContext): BoxSides {
  const out: BoxSides = {}
  const c = computed(el, 'border-width', ctx)
  if (c) {
    const sides = sidesFromShorthand(c)
    if (sides) Object.assign(out, sides)
  }
  if (el.style['border-width']) {
    const sides = sidesFromShorthand(el.style['border-width'])
    if (sides) Object.assign(out, sides)
  }
  if (el.style['border']) {
    const m = /^(\d+(?:\.\d+)?)px/.exec(el.style['border'])
    if (m) {
      const w = parseFloat(m[1])
      out.top = w; out.right = w; out.bottom = w; out.left = w
    }
  }
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const cSide = computed(el, `border-${side}-width`, ctx)
    if (cSide) {
      const px = parseLengthPx(cSide)
      if (px !== null) out[side] = px
    }
    if (el.style[`border-${side}-width`]) {
      const px = parseLengthPx(el.style[`border-${side}-width`])
      if (px !== null) out[side] = px
    }
  }
  for (const cls of el.classes) {
    if (BORDER_WIDTH_CLASS[cls]) {
      const w = BORDER_WIDTH_CLASS[cls]
      out.top = w; out.right = w; out.bottom = w; out.left = w
    }
    const side = /^border-([trbl])-(\d+)$/.exec(cls)
    if (side) {
      const w = parseInt(side[2], 10)
      if (side[1] === 't') out.top = w
      else if (side[1] === 'r') out.right = w
      else if (side[1] === 'b') out.bottom = w
      else if (side[1] === 'l') out.left = w
    }
  }
  return out
}

const NEUTRAL_COLOR_CLASS = /^(gray|grey|slate|zinc|neutral|stone|black|white)/

/** True when an element has a colored (non-neutral) border on exactly one side. */
export function singleSideAccentBorder(el: ElementNode, ctx: RuleContext): { side: string; width: number } | null {
  const widths = borderWidths(el, ctx)
  const coloredSides: string[] = []
  const sides: Array<[string, number | undefined]> = [
    ['top', widths.top], ['right', widths.right], ['bottom', widths.bottom], ['left', widths.left],
  ]
  for (const [side, w] of sides) {
    if (!w || w < 3) continue
    const cColor = computed(el, `border-${side}-color`, ctx)
    const color = cColor ?? el.style[`border-${side}-color`]
    if (color && !/^(transparent|currentcolor|inherit|initial|unset)$/.test(color.trim().toLowerCase())) {
      const isNeutral = hasClass(el, (cls) => /^border-/.test(cls) && NEUTRAL_COLOR_CLASS.test(cls.slice(7)))
      if (!isNeutral) coloredSides.push(side)
    } else if (!color) {
      // Colored via a Tailwind border color class (skip width-only classes like border-l-4).
      const cls = el.classes.find((x) => /^border-/.test(x) && !NEUTRAL_COLOR_CLASS.test(x.slice(7)) && !/^border-[trbl]-\d+$/.test(x))
      if (cls && /^border-[trbl]-/.test(cls) === false && /-(red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}$/.test(cls)) {
        coloredSides.push(side)
      }
    }
  }
  if (coloredSides.length === 1) {
    return { side: coloredSides[0], width: widths[coloredSides[0] as 'top' | 'right' | 'bottom' | 'left'] ?? 0 }
  }
  return null
}

export function boxShadow(el: ElementNode, ctx: RuleContext): string | null {
  const c = computed(el, 'box-shadow', ctx)
  if (c) return c.trim()
  if (el.style['box-shadow']) return el.style['box-shadow'].trim()
  return null
}

export function textShadow(el: ElementNode, ctx: RuleContext): string | null {
  const c = computed(el, 'text-shadow', ctx)
  if (c) return c.trim()
  if (el.style['text-shadow']) return el.style['text-shadow'].trim()
  return null
}

export function opacity(el: ElementNode, ctx: RuleContext): number | null {
  const c = computed(el, 'opacity', ctx)
  if (c) {
    const n = parseFloat(c)
    if (Number.isFinite(n)) return n
  }
  if (el.style['opacity']) {
    const n = parseFloat(el.style['opacity'])
    if (Number.isFinite(n)) return n
  }
  for (const cls of el.classes) {
    if (OPACITY_CLASS[cls] !== undefined) return OPACITY_CLASS[cls]
  }
  return null
}

export function visibility(el: ElementNode, ctx: RuleContext): string | null {
  const c = computed(el, 'visibility', ctx)
  if (c) return c.trim().toLowerCase()
  if (el.style['visibility']) return el.style['visibility'].trim().toLowerCase()
  if (hasClass(el, (cls) => cls === 'invisible')) return 'hidden'
  return null
}

export function display(el: ElementNode, ctx: RuleContext): string | null {
  const c = computed(el, 'display', ctx)
  if (c) return c.trim().toLowerCase()
  if (el.style['display']) return el.style['display'].trim().toLowerCase()
  if (hasClass(el, (cls) => cls === 'hidden')) return 'none'
  if (hasClass(el, (cls) => cls === 'block')) return 'block'
  if (hasClass(el, (cls) => cls === 'flex')) return 'flex'
  if (hasClass(el, (cls) => cls === 'grid')) return 'grid'
  return null
}

export function transform(el: ElementNode, ctx: RuleContext): string | null {
  const c = computed(el, 'transform', ctx)
  if (c) return c.trim().toLowerCase()
  if (el.style['transform']) return el.style['transform'].trim().toLowerCase()
  return null
}

export function animation(el: ElementNode, ctx: RuleContext): string | null {
  const c = computed(el, 'animation', ctx)
  if (c) return c.trim()
  const a = computed(el, 'animation-timing-function', ctx)
  const t = computed(el, 'transition-timing-function', ctx)
  if (a || t) return `${a ?? ''} ${t ?? ''}`.trim()
  if (el.style['animation']) return el.style['animation'].trim()
  if (el.style['animation-timing-function']) return el.style['animation-timing-function'].trim()
  if (el.style['transition-timing-function']) return el.style['transition-timing-function'].trim()
  return null
}

export function fontFamilies(el: ElementNode, ctx: RuleContext): string[] {
  const c = computed(el, 'font-family', ctx)
  if (c) return splitFontFamilies(c)
  if (el.style['font-family']) return splitFontFamilies(el.style['font-family'])
  for (const cls of el.classes) {
    if (cls === 'font-sans') return ['sans-serif']
    if (cls === 'font-serif') return ['serif']
    if (cls === 'font-mono') return ['monospace']
    if (cls.startsWith('font-') && cls.length > 5) {
      const family = cls.slice(5).replace(/-/g, ' ')
      if (!FONT_WEIGHT_CLASS[cls] && !['thin', 'extralight', 'light', 'normal', 'medium', 'semibold', 'bold', 'extrabold', 'black'].includes(family)) {
        return [family]
      }
    }
  }
  return []
}

export function splitFontFamilies(value: string): string[] {
  const out: string[] = []
  for (const part of value.split(',')) {
    const clean = part.trim().replace(/^["']|["']$/g, '')
    if (clean) out.push(clean)
  }
  return out
}

export function isOverusedFont(family: string): boolean {
  const key = family.toLowerCase().trim()
  return OVERUSED_FONTS.has(key) || key.includes('inter') || key.includes('poppins') || key.includes('roboto')
}

export function isSerifFamily(family: string): boolean {
  const key = family.toLowerCase().trim()
  if (key === 'serif' || key === 'georgia' || key === 'times new roman' || key === 'times') return true
  return /playfair|merriweather|lora|pt serif|cormorant|garamond|baskerville|spectral|source serif|charter|literata|freight/.test(key)
}

export function isCardLike(el: ElementNode, ctx: RuleContext): boolean {
  if (hasClass(el, (cls) => /card|panel|tile|box/.test(cls))) return true
  if (backgroundColor(el, ctx)) return true
  const widths = borderWidths(el, ctx)
  if (widths.top || widths.right || widths.bottom || widths.left) return true
  if (boxShadow(el, ctx) && boxShadow(el, ctx) !== 'none') return true
  return false
}

/** True when the element looks like a small rounded icon container. */
export function isIconTile(el: ElementNode, ctx: RuleContext): boolean {
  if (!hasClass(el, (cls) => /^rounded|rounded-/.test(cls))) {
    const radius = borderRadiusPx(el, ctx)
    if (radius === null) return false
  }
  if (!backgroundColor(el, ctx)) return false
  const size = parseSizeFromClasses(el.classes)
  return size !== null && size >= 24 && size <= 72
}

export function parseSizeFromClasses(classes: string[]): number | null {
  for (const cls of classes) {
    const m = /^(?:w|h|size)-(\d+)$/.exec(cls)
    if (m) {
      const n = parseInt(m[1], 10)
      return n * 4
    }
    const bracket = /^(?:w|h|size)-\[(\d+(?:\.\d+)?)px\]$/.exec(cls)
    if (bracket) return parseFloat(bracket[1])
  }
  return null
}

export function isUppercaseStyled(el: ElementNode, ctx: RuleContext): boolean {
  const c = computed(el, 'text-transform', ctx)
  if (c) return c.trim().toLowerCase() === 'uppercase'
  if (el.style['text-transform']) return el.style['text-transform'].trim().toLowerCase() === 'uppercase'
  return hasClass(el, (cls) => /^uppercase$/.test(cls))
}

export interface CssRule {
  selector: string
  declarations: Record<string, string>
  line: number
}

/** Parse <style> blocks into selector -> declaration maps (top-level '}' split). */
export function parseCssBlocks(blocks: StyleBlock[]): CssRule[] {
  const out: CssRule[] = []
  for (const block of blocks) {
    let depth = 0
    let current: string[] = []
    let start = block.line
    for (let i = 0; i < block.css.length; i++) {
      const ch = block.css[i]
      if (ch === '{') {
        current.push(ch)
        depth++
      } else if (ch === '}') {
        depth = Math.max(0, depth - 1)
        if (depth === 0) {
          const ruleText = current.join('').trim()
          current = []
          const brace = ruleText.indexOf('{')
          if (brace !== -1) {
            const selector = ruleText.slice(0, brace).trim()
            const body = ruleText.slice(brace + 1)
            const declarations: Record<string, string> = {}
            for (const decl of body.split(';')) {
              const idx = decl.indexOf(':')
              if (idx === -1) continue
              const prop = decl.slice(0, idx).trim().toLowerCase()
              const value = decl.slice(idx + 1).trim()
              if (prop && value) declarations[prop] = value
            }
            out.push({ selector, declarations, line: start })
          }
        }
      } else if (ch === '\n') {
        current.push(ch)
        start++
      } else {
        current.push(ch)
      }
    }
  }
  return out
}

/** Extract every gradient declaration (inline or <style>) with colors intact. */
export function collectGradients(ctx: RuleContext): Array<{ ref: string; line: number; value: string; snippet: string }> {
  const out: Array<{ ref: string; line: number; value: string; snippet: string }> = []
  const { doc } = ctx
  walkElements(doc.root, (el) => {
    const img = backgroundImage(el, ctx)
    if (img && img.includes('gradient')) {
      out.push({ ref: pathOf(el), line: el.line, value: img, snippet: el.rawStyle.slice(0, 70) || el.tag })
    }
  })
  for (const css of parseCssBlocks(doc.styleBlocks)) {
    const img = css.declarations['background-image'] ?? css.declarations['background']
    if (img && img.includes('gradient')) {
      out.push({ ref: `style@${css.line}`, line: css.line, value: img, snippet: css.selector.slice(0, 70) })
    }
  }
  return out
}

export function walkElements(node: ElementNode, cb: (el: ElementNode) => void): void {
  cb(node)
  for (const child of node.children) walkElements(child, cb)
}
