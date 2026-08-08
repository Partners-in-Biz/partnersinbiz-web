/**
 * Accessibility rules: WCAG AA contrast, heading hierarchy, tiny body text,
 * undersized functional text.
 */

import type { Finding, Rule, RuleContext } from '../types'
import { pathOf, snippet, textContent, walk, isHeading } from '../parser'
import {
  backgroundColor, colorOf, computed, fontSizePx, fontWeight, parseCssBlocks,
} from '../style-utils'
import { contrastRatioFromCss, isReadable } from '../contrast'
import { finding, round2 } from '../find'

const TEXT_TAGS = new Set([
  'p', 'li', 'span', 'a', 'td', 'th', 'label', 'div', 'small', 'strong', 'em',
  'button', 'blockquote', 'figcaption', 'dt', 'dd', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
])

export const lowContrastTextRule: Rule = {
  id: 'low-contrast-text',
  severity: 'P1',
  scope: 'any',
  description: 'Text below WCAG AA contrast (4.5:1 body, 3:1 large text).',
  check(ctx: RuleContext): Finding[] {
    const out: Finding[] = []
    walk(ctx.doc.root, (el) => {
      if (!TEXT_TAGS.has(el.tag)) return
      const text = textContent(el).trim()
      if (!text) return
      const fg = colorOf(el, 'color', ctx)
      const bg = backgroundColor(el, ctx)
      if (!fg || !bg) return
      const size = fontSizePx(el, ctx) ?? 16
      const weight = fontWeight(el, ctx) ?? 400
      if (!isReadable(fg, bg, { fontSizePx: size, fontWeight: weight })) {
        const ratio = contrastRatioFromCss(fg, bg)
        out.push(finding(
          'low-contrast-text', 'P1', 'any', pathOf(el), el.line,
          `Low contrast text ${fg} on ${bg}: ${ratio !== null ? round2(ratio) : '?'}:1 (need ${size >= 24 || (size >= 18.66 && weight >= 700) ? '3:1' : '4.5:1'}).`,
          snippet(text, 60),
          ratio !== null ? String(round2(ratio)) : undefined,
        ))
      }
    })
    for (const css of parseCssBlocks(ctx.doc.styleBlocks)) {
      const fg = css.declarations['color']
      const bg = css.declarations['background-color'] ?? css.declarations['background']
      if (!fg || !bg || bg.includes('gradient')) continue
      if (!isReadable(fg, bg)) {
        const ratio = contrastRatioFromCss(fg, bg)
        out.push(finding(
          'low-contrast-text', 'P1', 'any', `style@${css.line}`, css.line,
          `Low contrast text ${fg} on ${bg}: ${ratio !== null ? round2(ratio) : '?'}:1 (need 4.5:1).`,
          css.selector.slice(0, 70),
          ratio !== null ? String(round2(ratio)) : undefined,
        ))
      }
    }
    return out
  },
}

export const skippedHeadingLevelsRule: Rule = {
  id: 'skipped-heading-levels',
  severity: 'P1',
  scope: 'type',
  description: 'Heading levels that skip (h1 -> h3 without h2) break the document outline.',
  check(ctx: RuleContext): Finding[] {
    const out: Finding[] = []
    let lastLevel = 0
    walk(ctx.doc.root, (el) => {
      if (!isHeading(el)) return
      const level = parseInt(el.tag.slice(1), 10)
      if (lastLevel > 0 && level > lastLevel + 1) {
        out.push(finding(
          'skipped-heading-levels', 'P1', 'type', pathOf(el), el.line,
          `Skipped heading level: ${el.tag} after h${lastLevel}.`,
          snippet(textContent(el), 50),
        ))
      }
      lastLevel = level
    })
    return out
  },
}

const BODY_TEXT_TAGS = new Set(['p', 'li', 'td', 'th', 'dd', 'dt', 'label', 'small', 'blockquote', 'figcaption'])

export const tinyBodyTextRule: Rule = {
  id: 'tiny-body-text',
  severity: 'P2',
  scope: 'type',
  description: 'Body text below 12px is hard to read, especially on high-DPI screens.',
  check(ctx: RuleContext): Finding[] {
    const out: Finding[] = []
    walk(ctx.doc.root, (el) => {
      if (!BODY_TEXT_TAGS.has(el.tag)) return
      const text = textContent(el).trim()
      if (!text) return
      const size = fontSizePx(el, ctx)
      if (size !== null && size < 12) {
        out.push(finding(
          'tiny-body-text', 'P2', 'type', pathOf(el), el.line,
          `Tiny body text (${size}px, want >= 12px; 14-16px ideal).`,
          snippet(text, 50),
          String(size),
        ))
      }
    })
    for (const css of parseCssBlocks(ctx.doc.styleBlocks)) {
      const size = css.declarations['font-size']
      const n = size ? parseFloat(size) : NaN
      if (Number.isFinite(n) && n < 12 && /p|li|td|th|label|small|blockquote/.test(css.selector)) {
        out.push(finding(
          'tiny-body-text', 'P2', 'type', `style@${css.line}`, css.line,
          `Tiny body text (${n}px, want >= 12px).`,
          css.selector.slice(0, 70),
          String(n),
        ))
      }
    }
    return out
  },
}

export const undersizedFunctionalTextRule: Rule = {
  id: 'undersized-functional-text',
  severity: 'P2',
  scope: 'type',
  description: 'Functional text (links, labels, buttons, table cells) under 11px.',
  check(ctx: RuleContext): Finding[] {
    const out: Finding[] = []
    walk(ctx.doc.root, (el) => {
      const isControl = el.tag === 'button' || el.tag === 'a' || el.tag === 'label' || el.tag === 'td' || el.tag === 'th'
      if (!isControl) return
      const size = fontSizePx(el, ctx)
      if (size !== null && size < 11) {
        out.push(finding(
          'undersized-functional-text', 'P2', 'type', pathOf(el), el.line,
          `Undersized functional text (${size}px, want >= 11px).`,
          snippet(textContent(el), 50),
          String(size),
        ))
      }
    })
    return out
  },
}

/** Re-export for rules registry convenience. */
export { computed }
