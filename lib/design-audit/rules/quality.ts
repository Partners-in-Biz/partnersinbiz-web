/**
 * Quality-basics rules: broken media, invisible content, cramped padding,
 * line-length, tight leading, wide tracking, justified text, script errors.
 */

import type { ElementNode, Finding, Rule, RuleContext } from '../types'
import { pathOf, snippet, textContent, walk } from '../parser'
import {
  display, isCardLike, letterSpacingEm, lineHeightRatio,
  minPadding, opacity, parseCssBlocks, textAlign, transform, visibility,
} from '../style-utils'
import { finding } from '../find'

const TEXT_BODY_TAGS = new Set(['p', 'li', 'blockquote', 'figcaption', 'dd', 'dt', 'label', 'small'])

function hasVisibleText(el: Parameters<typeof textContent>[0]): boolean {
  const text = textContent(el).trim()
  return text.length > 0
}

export const crampedPaddingRule: Rule = {
  id: 'cramped-padding',
  severity: 'P2',
  scope: 'layout',
  description: 'Text too close to the edge of its bordered/colored container (< 8px padding).',
  check(ctx: RuleContext): Finding[] {
    const out: Finding[] = []
    walk(ctx.doc.root, (el) => {
      if (!isCardLike(el, ctx)) return
      if (!hasVisibleText(el)) return
      const pad = minPadding(el, ctx)
      if (pad !== null && pad < 8) {
        out.push(finding(
          'cramped-padding', 'P2', 'layout', pathOf(el), el.line,
          `Cramped padding: ${pad}px inside a bordered/colored container (want >= 8px).`,
          el.rawStyle.slice(0, 70) || el.classes.join(' ') || el.tag,
          String(pad),
        ))
      }
    })
    return out
  },
}

export const longLineLengthRule: Rule = {
  id: 'long-line-length',
  severity: 'P2',
  scope: 'layout',
  description: 'Body lines that exceed a comfortable reading measure (~90 chars).',
  check(ctx: RuleContext): Finding[] {
    const out: Finding[] = []
    walk(ctx.doc.root, (el) => {
      if (!['p', 'li', 'blockquote', 'td', 'th'].includes(el.tag)) return
      const text = textContent(el).trim()
      if (text.length <= 120) return
      if (text.includes('\n') || /<br\s*\/?>/i.test(el.rawStyle)) return
      // Source-length proxy: a single-line paragraph > 120 chars is almost
      // certainly rendered wider than ~90 chars/line at normal measure.
      out.push(finding(
        'long-line-length', 'P2', 'layout', pathOf(el), el.line,
        `Long line: ${text.length} chars without a break (target ~90/line).`,
        snippet(text, 70),
        String(text.length),
      ))
    })
    return out
  },
}

export const tightLineHeightRule: Rule = {
  id: 'tight-line-height',
  severity: 'P2',
  scope: 'type',
  description: 'Line height below 1.3x on multi-line body text.',
  check(ctx: RuleContext): Finding[] {
    const out: Finding[] = []
    walk(ctx.doc.root, (el) => {
      if (!TEXT_BODY_TAGS.has(el.tag) && el.tag !== 'div') return
      const text = textContent(el).trim()
      if (text.split(/\s+/).length < 3) return
      const lh = lineHeightRatio(el, ctx)
      if (lh !== null && lh < 1.3) {
        out.push(finding(
          'tight-line-height', 'P2', 'type', pathOf(el), el.line,
          `Tight line height (${lh.toFixed(2)}x, want >= 1.3).`,
          snippet(text, 60),
          String(lh),
        ))
      }
    })
    for (const css of parseCssBlocks(ctx.doc.styleBlocks)) {
      const lh = css.declarations['line-height']
      const n = lh ? parseFloat(lh) : NaN
      if (Number.isFinite(n) && n < 1.3 && /p|li|blockquote/.test(css.selector)) {
        out.push(finding(
          'tight-line-height', 'P2', 'type', `style@${css.line}`, css.line,
          `Tight line height (${n.toFixed(2)}x, want >= 1.3).`,
          css.selector.slice(0, 70),
          String(n),
        ))
      }
    }
    return out
  },
}

export const wideLetterSpacingRule: Rule = {
  id: 'wide-letter-spacing',
  severity: 'P3',
  scope: 'type',
  description: 'Letter spacing above 0.05em on body text (wide tracking breaks reading).',
  check(ctx: RuleContext): Finding[] {
    const out: Finding[] = []
    walk(ctx.doc.root, (el) => {
      if (!TEXT_BODY_TAGS.has(el.tag) && el.tag !== 'div') return
      const text = textContent(el).trim()
      if (text.split(/\s+/).length < 3) return
      const tracking = letterSpacingEm(el, ctx)
      if (tracking !== null && tracking > 0.05) {
        out.push(finding(
          'wide-letter-spacing', 'P3', 'type', pathOf(el), el.line,
          `Wide letter spacing (${tracking.toFixed(3)}em) on body text.`,
          snippet(text, 60),
          String(tracking),
        ))
      }
    })
    for (const css of parseCssBlocks(ctx.doc.styleBlocks)) {
      const ls = css.declarations['letter-spacing']
      const em = ls && ls.endsWith('em') ? parseFloat(ls) : NaN
      if (Number.isFinite(em) && em > 0.05 && !/uppercase/i.test(css.declarations['text-transform'] ?? '')) {
        out.push(finding(
          'wide-letter-spacing', 'P3', 'type', `style@${css.line}`, css.line,
          `Wide letter spacing (${em.toFixed(3)}em) on body text.`,
          css.selector.slice(0, 70),
          String(em),
        ))
      }
    }
    return out
  },
}

export const justifiedTextRule: Rule = {
  id: 'justified-text',
  severity: 'P3',
  scope: 'type',
  description: 'Justified body text creates rivers of whitespace on screens.',
  check(ctx: RuleContext): Finding[] {
    const out: Finding[] = []
    walk(ctx.doc.root, (el) => {
      if (!['p', 'li', 'blockquote', 'td', 'th', 'div'].includes(el.tag)) return
      if (textAlign(el, ctx) === 'justify') {
        out.push(finding(
          'justified-text', 'P3', 'type', pathOf(el), el.line,
          'Justified text (use left alignment or hyphens: auto).',
          el.rawStyle.slice(0, 70) || el.classes.join(' '),
        ))
      }
    })
    for (const css of parseCssBlocks(ctx.doc.styleBlocks)) {
      if (css.declarations['text-align'] === 'justify') {
        out.push(finding(
          'justified-text', 'P3', 'type', `style@${css.line}`, css.line,
          'Justified text (use left alignment or hyphens: auto).',
          css.selector.slice(0, 70),
        ))
      }
    }
    return out
  },
}

const BROKEN_SRC = /^(#|about:blank|\s*)$/i

export const missingDocumentLangRule: Rule = {
  id: 'missing-document-lang',
  severity: 'P2',
  scope: 'layout',
  description: 'html element without a lang attribute — assistive tech cannot pick a pronunciation/dictionary.',
  check(ctx: RuleContext): Finding[] {
    const htmlEl = ctx.doc.root.children.find((el) => el.tag === 'html')
    if (!htmlEl) return []
    const lang = htmlEl.attrs['lang']
    if (!lang || lang.trim() === '') {
      return [finding(
        'missing-document-lang', 'P2', 'layout', 'html:nth-of-type(1)', htmlEl.line,
        'html element is missing a lang attribute.',
        '<html>',
      )]
    }
    return []
  },
}

export const brokenImagesRule: Rule = {
  id: 'broken-images',
  severity: 'P0',
  scope: 'layout',
  description: 'img with a missing/empty src — the page ships a broken image.',
  check(ctx: RuleContext): Finding[] {
    const out: Finding[] = []
    walk(ctx.doc.root, (el) => {
      if (el.tag !== 'img') return
      const src = el.attrs['src'] ?? ''
      if (BROKEN_SRC.test(src.trim())) {
        out.push(finding(
          'broken-images', 'P0', 'layout', pathOf(el), el.line,
          'Image with missing or empty src.',
          snippet(el.rawStyle || `<img${el.attrs['alt'] ? ` alt="${el.attrs['alt']}"` : ''}>`, 60),
          src.trim() || '(missing)',
        ))
      }
    })
    return out
  },
}

export const missingAltRule: Rule = {
  id: 'missing-alt',
  severity: 'P1',
  scope: 'layout',
  description: 'img without an alt attribute — screen readers announce the filename.',
  check(ctx: RuleContext): Finding[] {
    const out: Finding[] = []
    walk(ctx.doc.root, (el) => {
      if (el.tag !== 'img') return
      if (!('alt' in el.attrs)) {
        out.push(finding(
          'missing-alt', 'P1', 'layout', pathOf(el), el.line,
          'Image missing alt attribute.',
          snippet(el.rawStyle || el.tag, 60),
        ))
      }
    })
    return out
  },
}

const UNLABELED_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'image', 'reset'])

/**
 * Collect the set of control ids referenced by `<label for="...">` /
 * `<label htmlFor="...">` (the repo's pib-label convention). The parser
 * lowercases attribute names, so JSX `htmlFor` arrives as `htmlfor`.
 */
function labeledByForIds(doc: RuleContext['doc']): Set<string> {
  const ids = new Set<string>()
  walk(doc.root, (el) => {
    if (el.tag !== 'label') return
    const ref = el.attrs['for'] ?? el.attrs['htmlfor']
    if (ref && ref.trim()) ids.add(ref.trim())
  })
  return ids
}

/**
 * pib-label convention: a control nested directly inside a `<label>` element
 * is implicitly associated (valid HTML) — `<label><span>Label</span>
 * <input/></label>`. The pib-label class + wrapping label is a repo-wide
 * pattern, so the detector must treat it as labeled.
 */
function hasLabelAncestor(el: ElementNode): boolean {
  let cur: ElementNode | null = el.parent
  while (cur && cur.tag !== '#root') {
    if (cur.tag === 'label') return true
    cur = cur.parent
  }
  return false
}

/**
 * JSX-expression convention: `htmlFor={cond ? idA : idB}` and `id={idA}` do
 * not string-match, but both reference the same identifier. Extract the
 * identifier tokens from a JSX expression value so the pairing still counts.
 */
function jsxExpressionTokens(value: string): Set<string> {
  const tokens = new Set<string>()
  for (const match of value.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)) {
    tokens.add(match[0])
  }
  return tokens
}

export const unlabeledControlsRule: Rule = {
  id: 'unlabeled-controls',
  severity: 'P1',
  scope: 'layout',
  description: 'Form controls without a programmatic label (label, aria-label, aria-labelledby, title).',
  check(ctx: RuleContext): Finding[] {
    const out: Finding[] = []
    const labelForIds = labeledByForIds(ctx.doc)
    walk(ctx.doc.root, (el) => {
      const tag = el.tag
      const isInput = tag === 'input' || tag === 'select' || tag === 'textarea'
      const isButton = tag === 'button'
      if (!isInput && !isButton) return
      if (el.attrs['aria-label'] || el.attrs['aria-labelledby'] || el.attrs['title'] || el.attrs['name']) return
      if (isInput) {
        const type = (el.attrs['type'] ?? 'text').toLowerCase()
        if (UNLABELED_INPUT_TYPES.has(type)) return
      }
      if (isButton) {
        if (hasVisibleText(el) || (el.attrs['aria-label'] ?? '').trim()) return
      }
      // Repo convention: `<label htmlFor="x" class="pib-label">` pairs with the
      // control's `id`. This is a programmatic label association.
      const id = el.attrs['id']
      if (id && labelForIds.has(id)) return
      // JSX-expression convention: id={x} is labeled when any label references
      // the same identifier in its htmlFor expression (e.g. htmlFor={cond ? x : y}).
      if (id) {
        const idTokens = jsxExpressionTokens(id)
        if (idTokens.size) {
          for (const ref of labelForIds) {
            const refTokens = jsxExpressionTokens(ref)
            for (const token of idTokens) {
              if (refTokens.has(token)) return
            }
          }
        }
      }
      // Repo convention: control nested inside a wrapping `<label>` element is
      // implicitly labeled (valid HTML association).
      if (hasLabelAncestor(el)) return
      out.push(finding(
        'unlabeled-controls', 'P1', 'layout', pathOf(el), el.line,
        `Unlabeled ${tag} (no label/aria-label/aria-labelledby/title).`,
        el.rawStyle.slice(0, 70) || tag,
      ))
    })
    return out
  },
}

export const scriptErrorsRule: Rule = {
  id: 'script-errors',
  severity: 'P0',
  scope: 'layout',
  description: 'Runtime script errors captured from the browser console (browser mode).',
  check(ctx: RuleContext): Finding[] {
    const out: Finding[] = []
    for (const err of ctx.runtimeErrors) {
      out.push(finding(
        'script-errors', 'P0', 'layout', 'runtime', 0,
        'Runtime script error.',
        snippet(err, 80),
      ))
    }
    return out
  },
}

const REVEAL_CLASS = /animate|transition|group-hover|hover:|peer|data-|scroll-mt|reveal|motion-safe/i

export const contentInvisibleAtRestRule: Rule = {
  id: 'content-invisible-at-rest',
  severity: 'P0',
  scope: 'layout',
  description: 'Content invisible at rest (opacity/visibility/transform) without an intentional reveal.',
  check(ctx: RuleContext): Finding[] {
    const out: Finding[] = []
    walk(ctx.doc.root, (el) => {
      if (!hasVisibleText(el) && !['a', 'button', 'input', 'select', 'textarea'].includes(el.tag)) return
      if (el.attrs['aria-hidden'] === 'true' || el.attrs['hidden'] !== undefined) return
      let inDetails = false
      let cur: typeof el.parent = el.parent
      while (cur && cur.tag !== '#root') {
        if (cur.tag === 'details' || cur.tag === 'template') { inDetails = true; break }
        cur = cur.parent
      }
      if (inDetails) return
      if (el.classes.some((c) => REVEAL_CLASS.test(c))) return
      const op = opacity(el, ctx)
      const vis = visibility(el, ctx)
      const disp = display(el, ctx)
      const tr = transform(el, ctx)
      const offscreen = tr ? /translate\(-?\d{3,}px|translateX\(-?\d{3,}px|translateY\(-?\d{3,}px|scale\(0(\.\d+)?\)/.test(tr) : false
      if ((op !== null && op < 0.1) || vis === 'hidden' || disp === 'none' || offscreen) {
        out.push(finding(
          'content-invisible-at-rest', 'P0', 'layout', pathOf(el), el.line,
          `Content invisible at rest (${op !== null && op < 0.1 ? `opacity ${op}` : vis === 'hidden' ? 'visibility hidden' : disp === 'none' ? 'display none' : 'offscreen transform'}).`,
          snippet(textContent(el), 60),
        ))
      }
    })
    return out
  },
}
