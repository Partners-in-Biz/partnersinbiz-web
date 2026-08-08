/**
 * AI-slop rules (the "tell" catalog from the Impeccable slop gallery).
 * Every check is deterministic; thresholds are documented in each rule.
 */

import type { Finding, Rule, RuleContext } from '../types'
import { pathOf, snippet, textContent, walk, isHeading } from '../parser'
import {
  animation, backgroundImage, backdropFilter, borderWidths, boxShadow, collectGradients,
  computed, fontFamilies, fontSizePx, hasClass, isCardLike, isIconTile, isOverusedFont,
  isSerifFamily, isUppercaseStyled, letterSpacingEm, parseCssBlocks, singleSideAccentBorder,
  textShadow,
} from '../style-utils'
import { isPurpleish } from '../contrast'
import { colorsFromCss, finding } from '../find'

const GENERIC_FONT = /^(sans-serif|serif|monospace|cursive|fantasy|system-ui|inherit|initial|unset|default|-apple-system|ui-sans-serif|ui-serif|ui-monospace|ui-rounded|blinkmacsystemfont|segoe ui|helvetica neue|arial|calibri)$/i

const BUZZWORDS: Array<[RegExp, string]> = [
  [/\belevat(e|es|ing|ed)?\b/gi, 'elevate'],
  [/\bunleash(ed|ing|es)?\b/gi, 'unleash'],
  [/\bseamless(ly)?\b/gi, 'seamless'],
  [/\brevolutioniz(e|es|ing|ed)\b/gi, 'revolutionize'],
  [/\bsupercharg(e|es|ing|ed)\b/gi, 'supercharge'],
  [/\bturbocharg(e|es|ing|ed)\b/gi, 'turbocharge'],
  [/\bgame[- ]changer\b/gi, 'game-changer'],
  [/\bcutting[- ]edge\b/gi, 'cutting-edge'],
  [/\beffortless(ly)?\b/gi, 'effortless'],
  [/\bunlock(ed|ing|s)?\b/gi, 'unlock'],
  [/\bempower(ed|ing|s|ment)?\b/gi, 'empower'],
  [/\bnext[- ]level\b/gi, 'next-level'],
  [/\bworld[- ]class\b/gi, 'world-class'],
  [/\bbest[- ]in[- ]class\b/gi, 'best-in-class'],
  [/\binnovative\b/gi, 'innovative'],
  [/\bscalable\b/gi, 'scalable'],
  [/\bstreamlin(e|es|ing|ed)\b/gi, 'streamline'],
  [/\btransformative\b/gi, 'transformative'],
  [/\bunparalleled\b/gi, 'unparalleled'],
  [/\bpowerhouse\b/gi, 'powerhouse'],
  [/\bskyrocket(ed|ing|s)?\b/gi, 'skyrocket'],
  [/\btake (your|the) (business|brand|site|company|operations?) to the next level\b/gi, 'take-to-next-level'],
]

export const purpleGradientsRule: Rule = {
  id: 'purple-gradients',
  severity: 'P1',
  scope: 'layout',
  description: 'Purple/violet/magenta gradient surfaces — the default AI color palette.',
  check(ctx: RuleContext): Finding[] {
    const out: Finding[] = []
    for (const g of collectGradients(ctx)) {
      const purple = colorsFromCss(g.value).find((c) => isPurpleish(c))
      if (purple) {
        out.push(finding(
          'purple-gradients', 'P1', 'layout', g.ref, g.line,
          `Purple/blue AI-gradient detected (${purple}).`,
          g.snippet, purple.toLowerCase(),
        ))
      }
    }
    return out
  },
}

export const glassmorphismRule: Rule = {
  id: 'glassmorphism',
  severity: 'P2',
  scope: 'layout',
  description: 'backdrop-filter blur on translucent surfaces (frosted-glass hackathon look).',
  check(ctx: RuleContext): Finding[] {
    const out: Finding[] = []
    walk(ctx.doc.root, (el) => {
      const bf = backdropFilter(el, ctx)
      if (bf && /blur\(/.test(bf)) {
        out.push(finding(
          'glassmorphism', 'P2', 'layout', pathOf(el), el.line,
          'Glassmorphism blur used as decoration.',
          el.rawStyle.slice(0, 70) || el.classes.join(' '),
        ))
      }
    })
    for (const css of parseCssBlocks(ctx.doc.styleBlocks)) {
      const bf = css.declarations['backdrop-filter'] ?? css.declarations['-webkit-backdrop-filter']
      if (bf && /blur\(/.test(bf)) {
        out.push(finding(
          'glassmorphism', 'P2', 'layout', `style@${css.line}`, css.line,
          'Glassmorphism blur used as decoration.',
          css.selector.slice(0, 70),
        ))
      }
    }
    return out
  },
}

export const gradientTextRule: Rule = {
  id: 'gradient-text',
  severity: 'P1',
  scope: 'type',
  description: 'background-clip: text with transparent color — a canonical AI display headline.',
  check(ctx: RuleContext): Finding[] {
    const out: Finding[] = []
    walk(ctx.doc.root, (el) => {
      const clip = el.style['background-clip'] ?? el.style['-webkit-background-clip']
      const color = el.style['color'] ?? computed(el, 'color', ctx)
      const img = backgroundImage(el, ctx)
      if (clip === 'text' && (color === 'transparent' || (img && img.includes('gradient')))) {
        out.push(finding(
          'gradient-text', 'P1', 'type', pathOf(el), el.line,
          'Gradient text (background-clip: text + transparent color).',
          el.rawStyle.slice(0, 70) || el.tag,
        ))
      }
    })
    for (const css of parseCssBlocks(ctx.doc.styleBlocks)) {
      const clip = css.declarations['background-clip'] ?? css.declarations['-webkit-background-clip']
      const color = css.declarations['color']
      const img = css.declarations['background-image']
      if (clip === 'text' && (color === 'transparent' || (img && img.includes('gradient')))) {
        out.push(finding(
          'gradient-text', 'P1', 'type', `style@${css.line}`, css.line,
          'Gradient text (background-clip: text + transparent color).',
          css.selector.slice(0, 70),
        ))
      }
    }
    return out
  },
}

function largestBlur(shadows: string | null): number {
  if (!shadows || shadows === 'none') return 0
  let max = 0
  // box-shadow offsets may omit px units (0 0 40px), blur usually carries px.
  const re = /([\d.]+)(?:px)?\s+([\d.]+)(?:px)?\s+([\d.]+)px/g
  let m: RegExpExecArray | null
  while ((m = re.exec(shadows)) !== null) {
    const blur = parseFloat(m[3])
    if (blur > max) max = blur
  }
  return max
}

export const darkGlowRule: Rule = {
  id: 'dark-glow',
  severity: 'P2',
  scope: 'layout',
  description: 'Wide diffuse shadows / glows on dark surfaces (neon-glow aesthetic).',
  check(ctx: RuleContext): Finding[] {
    const out: Finding[] = []
    walk(ctx.doc.root, (el) => {
      const shadow = boxShadow(el, ctx)
      const ts = textShadow(el, ctx)
      const blur = largestBlur(shadow)
      const tsBlur = largestBlur(ts)
      const filter = el.style['filter'] ?? computed(el, 'filter', ctx)
      const dropBlur = filter ? largestBlur(filter) : 0
      if (blur >= 15 || tsBlur >= 8 || dropBlur >= 15) {
        out.push(finding(
          'dark-glow', 'P2', 'layout', pathOf(el), el.line,
          `Wide glow shadow (blur ${Math.max(blur, tsBlur, dropBlur)}px).`,
          el.rawStyle.slice(0, 70) || el.tag,
        ))
      }
    })
    for (const css of parseCssBlocks(ctx.doc.styleBlocks)) {
      const decls = css.declarations
      const blur = Math.max(
        largestBlur(decls['box-shadow']),
        largestBlur(decls['text-shadow']),
        largestBlur(decls['filter']),
      )
      if (blur >= 15) {
        out.push(finding(
          'dark-glow', 'P2', 'layout', `style@${css.line}`, css.line,
          `Wide glow shadow (blur ${blur}px).`,
          css.selector.slice(0, 70),
        ))
      }
    }
    return out
  },
}

const BOUNCE_RE = /cubic-bezier\(\s*-?[\d.]+\s*,\s*-?[\d.]+\s*,\s*-?[\d.]+\s*,\s*-?[\d.]+\s*\)/g

function isBounceBezier(bezier: string): boolean {
  const nums = bezier.slice(bezier.indexOf('(') + 1, bezier.lastIndexOf(')')).split(',').map((s) => parseFloat(s.trim()))
  if (nums.length !== 4 || nums.some((n) => !Number.isFinite(n))) return false
  const [x1, y1, x2, y2] = nums
  // Overshoot / bounce: any control point outside [0,1].
  return x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1 || y1 < 0 || y1 > 1 || y2 < 0 || y2 > 1
}

export const bounceEasingRule: Rule = {
  id: 'bounce-easing',
  severity: 'P2',
  scope: 'layout',
  description: 'Overshooting / bounce timing functions — "animate everything" motion without meaning.',
  check(ctx: RuleContext): Finding[] {
    const out: Finding[] = []
    walk(ctx.doc.root, (el) => {
      const anim = animation(el, ctx)
      if (!anim) return
      const beziers = anim.match(BOUNCE_RE) ?? []
      const bounces = beziers.filter(isBounceBezier)
      if (bounces.length) {
        out.push(finding(
          'bounce-easing', 'P2', 'layout', pathOf(el), el.line,
          `Bounce easing (${bounces[0]}).`,
          anim.slice(0, 70),
        ))
      }
    })
    for (const css of parseCssBlocks(ctx.doc.styleBlocks)) {
      const decls = css.declarations
      const animText = [
        decls['animation'], decls['animation-timing-function'], decls['transition-timing-function'],
      ].filter(Boolean).join(' ')
      const beziers = animText.match(BOUNCE_RE) ?? []
      if (beziers.some(isBounceBezier)) {
        out.push(finding(
          'bounce-easing', 'P2', 'layout', `style@${css.line}`, css.line,
          `Bounce easing (${beziers.find(isBounceBezier)}).`,
          css.selector.slice(0, 70),
        ))
      }
    }
    return out
  },
}

export const sideTabBordersRule: Rule = {
  id: 'side-tab-borders',
  severity: 'P1',
  scope: 'layout',
  description: 'Thick colored border on exactly one side of a card — the single most recognizable AI-UI tell.',
  check(ctx: RuleContext): Finding[] {
    const out: Finding[] = []
    walk(ctx.doc.root, (el) => {
      const accent = singleSideAccentBorder(el, ctx)
      if (accent) {
        out.push(finding(
          'side-tab-borders', 'P1', 'layout', pathOf(el), el.line,
          `Side-tab accent border (${accent.side} ${accent.width}px).`,
          el.rawStyle.slice(0, 70) || el.classes.join(' '),
        ))
      }
    })
    for (const css of parseCssBlocks(ctx.doc.styleBlocks)) {
      const sides = ['top', 'right', 'bottom', 'left'] as const
      const colors = ['top', 'right', 'bottom', 'left'].map((s) => css.declarations[`border-${s}-color`] ?? css.declarations[`border-${s}`])
      const widths = sides.map((s) => {
        const w = css.declarations[`border-${s}-width`]
        const m = w ? /^(\d+)px/.exec(w) : null
        return m ? parseFloat(m[1]) : 0
      })
      const colored = sides.filter((s, i) => widths[i] >= 3 && colors[i] && !/^(transparent|currentcolor|inherit)$/i.test(colors[i]!))
      if (colored.length === 1) {
        out.push(finding(
          'side-tab-borders', 'P1', 'layout', `style@${css.line}`, css.line,
          `Side-tab accent border (${colored[0]} ${widths[sides.indexOf(colored[0])]}px).`,
          css.selector.slice(0, 70),
        ))
      }
    }
    return out
  },
}

export const borderAccentRoundedRule: Rule = {
  id: 'border-accent-rounded',
  severity: 'P2',
  scope: 'layout',
  description: 'Thick accent border clashing with rounded corners on a card.',
  check(ctx: RuleContext): Finding[] {
    const out: Finding[] = []
    walk(ctx.doc.root, (el) => {
      const widths = borderWidths(el, ctx)
      const maxWidth = Math.max(widths.top ?? 0, widths.right ?? 0, widths.bottom ?? 0, widths.left ?? 0)
      const radius = el.style['border-radius'] ?? computed(el, 'border-radius', ctx)
      const radiusPx = radius ? parseFloat(radius) : null
      const accent = singleSideAccentBorder(el, ctx)
      if (maxWidth >= 3 && radiusPx !== null && radiusPx >= 8 && !accent) {
        out.push(finding(
          'border-accent-rounded', 'P2', 'layout', pathOf(el), el.line,
          `Thick accent border (${maxWidth}px) on a rounded card (${radiusPx}px).`,
          el.rawStyle.slice(0, 70) || el.classes.join(' '),
        ))
      }
    })
    return out
  },
}

export const nestedCardsRule: Rule = {
  id: 'nested-cards',
  severity: 'P2',
  scope: 'layout',
  description: 'Cards inside cards inside cards (Cardocalypse) — nested surfaces with padding+shadow.',
  check(ctx: RuleContext): Finding[] {
    const out: Finding[] = []
    const cardDepth = new Map<string, number>()
    walk(ctx.doc.root, (el) => {
      if (!isCardLike(el, ctx)) return
      let depth = 0
      let parent = el.parent
      while (parent && parent.tag !== '#root') {
        if (isCardLike(parent, ctx)) depth++
        parent = parent.parent
      }
      cardDepth.set(pathOf(el), depth)
    })
    const deep = [...cardDepth.entries()].filter(([, d]) => d >= 2)
    if (deep.length) {
      const sorted = deep.sort((a, b) => b[1] - a[1])
      const [ref, depth] = sorted[0]
      out.push(finding(
        'nested-cards', 'P2', 'layout', ref, 0,
        `Card nested ${depth} levels deep (card-in-card).`,
        `depth ${depth} card(s) deep`,
      ))
    }
    return out
  },
}

export const iconTileStacksRule: Rule = {
  id: 'icon-tile-stacks',
  severity: 'P2',
  scope: 'layout',
  description: 'Rounded icon tile stacked above a heading — the universal AI feature-card template.',
  check(ctx: RuleContext): Finding[] {
    const out: Finding[] = []
    walk(ctx.doc.root, (el) => {
      if (!['div', 'section', 'ul', 'ol', 'main'].includes(el.tag)) return
      const tiles = el.children.filter((child) => {
        if (!isIconTile(child, ctx)) return false
        return textContent(child).trim().length === 0 && child.children.some((c) => c.tag === 'svg' || c.tag === 'img' || c.tag === 'i')
      })
      if (tiles.length >= 3) {
        out.push(finding(
          'icon-tile-stacks', 'P2', 'layout', pathOf(el), el.line,
          `Icon-tile stack: ${tiles.length} rounded icon containers above headings.`,
          el.classes.join(' ') || el.tag,
          String(tiles.length),
        ))
      }
    })
    return out
  },
}

export const kickerEyebrowRule: Rule = {
  id: 'kicker-eyebrow',
  severity: 'P2',
  scope: 'type',
  description: 'Tracked uppercase label above a heading — borrowed editorial authority.',
  check(ctx: RuleContext): Finding[] {
    const out: Finding[] = []
    walk(ctx.doc.root, (el) => {
      if (!isHeading(el) || !el.parent) return
      const siblings = el.parent.children
      const idx = siblings.indexOf(el)
      if (idx <= 0) return
      const label = siblings[idx - 1]
      if (label.tag === '#root' || isHeading(label)) return
      const text = textContent(label).trim()
      if (!text || text.length > 80) return
      const fs = fontSizePx(label, ctx)
      const uppercase = isUppercaseStyled(label, ctx)
      const tracking = letterSpacingEm(label, ctx)
      const looksLikeKicker = (uppercase || (tracking !== null && tracking >= 0.03)) && (fs === null || fs < 16)
      if (looksLikeKicker && /^[a-z0-9][^.!?]{2,}$/i.test(text)) {
        out.push(finding(
          'kicker-eyebrow', 'P2', 'type', pathOf(label), label.line,
          `Kicker/eyebrow label above ${el.tag}: "${snippet(text, 50)}".`,
          text,
        ))
      }
    })
    return out
  },
}

export const italicSerifHeroRule: Rule = {
  id: 'italic-serif-hero',
  severity: 'P1',
  scope: 'type',
  description: 'Italic serif display headline — the default AI hero voice.',
  check(ctx: RuleContext): Finding[] {
    const out: Finding[] = []
    walk(ctx.doc.root, (el) => {
      if (!isHeading(el) || (el.tag !== 'h1' && el.tag !== 'h2')) return
      const italic = el.style['font-style'] === 'italic' || hasClass(el, (c) => c === 'italic')
      if (!italic) return
      const families = fontFamilies(el, ctx)
      const serif = families.some((f) => isSerifFamily(f))
      if (serif) {
        out.push(finding(
          'italic-serif-hero', 'P1', 'type', pathOf(el), el.line,
          'Italic serif display headline.',
          families.filter((f) => isSerifFamily(f)).join(', '),
          families.filter((f) => isSerifFamily(f))[0],
        ))
      }
    })
    for (const css of parseCssBlocks(ctx.doc.styleBlocks)) {
      const font = css.declarations['font-family'] ?? ''
      if (font.includes('serif') && css.declarations['font-style'] === 'italic' && /h1|h2/.test(css.selector)) {
        out.push(finding(
          'italic-serif-hero', 'P1', 'type', `style@${css.line}`, css.line,
          'Italic serif display headline.',
          css.selector.slice(0, 70),
        ))
      }
    }
    return out
  },
}

export const overusedFontsRule: Rule = {
  id: 'overused-fonts',
  severity: 'P2',
  scope: 'type',
  description: 'Font faces in the overused AI set (Inter, Poppins, Roboto, Montserrat, DM Sans…).',
  check(ctx: RuleContext): Finding[] {
    const out: Finding[] = []
    const seen = new Set<string>()
    walk(ctx.doc.root, (el) => {
      for (const family of fontFamilies(el, ctx)) {
        if (GENERIC_FONT.test(family)) continue
        if (ctx.designSystem && ctx.designSystem.fonts.some((f) => f.toLowerCase() === family.toLowerCase())) continue
        if (!isOverusedFont(family)) continue
        const key = family.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        out.push(finding(
          'overused-fonts', 'P2', 'type', pathOf(el), el.line,
          `Overused AI font "${family}".`,
          family,
          family,
        ))
      }
    })
    for (const css of parseCssBlocks(ctx.doc.styleBlocks)) {
      const font = css.declarations['font-family'] ?? ''
      for (const family of font.split(',').map((f) => f.trim().replace(/^["']|["']$/g, ''))) {
        if (GENERIC_FONT.test(family)) continue
        if (ctx.designSystem && ctx.designSystem.fonts.some((f) => f.toLowerCase() === family.toLowerCase())) continue
        if (!isOverusedFont(family)) continue
        const key = family.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        out.push(finding(
          'overused-fonts', 'P2', 'type', `style@${css.line}`, css.line,
          `Overused AI font "${family}".`,
          family,
          family,
        ))
      }
    }
    return out
  },
}

export const flatTypeHierarchyRule: Rule = {
  id: 'flat-type-hierarchy',
  severity: 'P2',
  scope: 'type',
  description: 'Heading sizes too close together — no clear visual hierarchy (target ratio >= 1.25).',
  check(ctx: RuleContext): Finding[] {
    const out: Finding[] = []
    const sized: Array<{ ref: string; line: number; size: number; tag: string }> = []
    walk(ctx.doc.root, (el) => {
      if (!isHeading(el)) return
      const size = fontSizePx(el, ctx)
      if (size === null) return
      sized.push({ ref: pathOf(el), line: el.line, size, tag: el.tag })
    })
    const distinct = [...new Set(sized.map((s) => s.size))].sort((a, b) => b - a)
    if (distinct.length < 2) return out
    for (let i = 0; i < distinct.length - 1; i++) {
      const bigger = distinct[i]
      const smaller = distinct[i + 1]
      const ratio = bigger / smaller
      if (ratio < 1.25) {
        const hit = sized.find((s) => s.size === smaller)
        if (hit) {
          out.push(finding(
            'flat-type-hierarchy', 'P2', 'type', hit.ref, hit.line,
            `Flat type hierarchy: ${bigger}px → ${smaller}px (ratio ${ratio.toFixed(2)}, want >= 1.25).`,
            hit.tag,
            String(smaller),
          ))
        }
      }
    }
    return out
  },
}

export const emDashOveruseRule: Rule = {
  id: 'em-dash-overuse',
  severity: 'P3',
  scope: 'type',
  description: 'Em-dash density above the editorial norm — a classic AI-writing tell.',
  check(ctx: RuleContext): Finding[] {
    const out: Finding[] = []
    let total = 0
    let firstRef = ''
    let firstLine = 0
    let firstSnippet = ''
    walk(ctx.doc.root, (el) => {
      if (!el.text) return
      const count = (el.text.match(/—/g) ?? []).length
      if (count) {
        total += count
        if (!firstRef) {
          firstRef = pathOf(el)
          firstLine = el.line
          firstSnippet = snippet(el.text, 70)
        }
      }
    })
    const allText = textContent(ctx.doc.root)
    const density = total / Math.max(1, allText.length / 1000)
    if (total >= 5 && density >= 2) {
      out.push(finding(
        'em-dash-overuse', 'P3', 'type', firstRef, firstLine,
        `Em-dash overuse: ${total} em-dashes (~${density.toFixed(1)}/1000 chars).`,
        firstSnippet,
        String(total),
      ))
    }
    return out
  },
}

export const buzzwordsRule: Rule = {
  id: 'buzzwords',
  severity: 'P3',
  scope: 'type',
  description: 'Empty marketing buzzwords ("elevate", "unleash", "seamless"…) in copy.',
  check(ctx: RuleContext): Finding[] {
    const out: Finding[] = []
    const allText = textContent(ctx.doc.root)
    const found = new Set<string>()
    for (const [re, label] of BUZZWORDS) {
      const match = re.exec(allText)
      if (match && !found.has(label)) {
        found.add(label)
        const at = match.index
        const ctxText = allText.slice(Math.max(0, at - 20), at + 40)
        out.push(finding(
          'buzzwords', 'P3', 'type', 'document', 0,
          `Buzzword "${label}".`,
          snippet(ctxText, 60),
          label,
        ))
      }
    }
    return out
  },
}
