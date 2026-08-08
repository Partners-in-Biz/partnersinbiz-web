/**
 * Design-system-drift rules. These only run when a per-client Design Context
 * (DESIGN.md or .impeccable/design.json) is supplied — "Personalized" checks
 * in the Impeccable detector. Each flags usage that falls outside the
 * documented system so the drift is an intentional decision, not an accident.
 */

import type { Finding, Rule, RuleContext } from '../types'
import { pathOf, walk } from '../parser'
import {
  borderRadiusPx, colorOf, fontFamilies, fontSizePx, parseCssBlocks, splitFontFamilies,
} from '../style-utils'
import { colorInPalette, fontInStack, fontSizeInScale, radiusInScale } from '../design-context'
import { finding } from '../find'

const GENERIC_FONT = /^(sans-serif|serif|monospace|cursive|fantasy|system-ui|inherit|initial|unset|default|-apple-system|ui-sans-serif|ui-serif|ui-monospace|ui-rounded|blinkmacsystemfont|segoe ui|helvetica neue|arial|calibri)$/i

export const fontOutsideDesignRule: Rule = {
  id: 'font-outside-design',
  severity: 'P1',
  scope: 'type',
  description: 'A font family falls outside the documented DESIGN.md type stack.',
  check(ctx: RuleContext): Finding[] {
    if (!ctx.designSystem || ctx.designSystem.fonts.length === 0) return []
    const design = ctx.designSystem
    const out: Finding[] = []
    const seen = new Set<string>()
    walk(ctx.doc.root, (el) => {
      for (const family of fontFamilies(el, ctx)) {
        if (GENERIC_FONT.test(family)) continue
        if (fontInStack(design, family)) continue
        const key = family.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        out.push(finding(
          'font-outside-design', 'P1', 'type', pathOf(el), el.line,
          `Font "${family}" is not in the documented type stack.`,
          family,
          family,
        ))
      }
    })
    for (const css of parseCssBlocks(ctx.doc.styleBlocks)) {
      for (const family of splitFontFamilies(css.declarations['font-family'] ?? '')) {
        if (GENERIC_FONT.test(family)) continue
        if (fontInStack(design, family)) continue
        const key = family.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        out.push(finding(
          'font-outside-design', 'P1', 'type', `style@${css.line}`, css.line,
          `Font "${family}" is not in the documented type stack.`,
          family,
          family,
        ))
      }
    }
    return out
  },
}

export const colorOutsideDesignRule: Rule = {
  id: 'color-outside-design',
  severity: 'P1',
  scope: 'layout',
  description: 'A literal color falls outside the documented DESIGN.md palette.',
  check(ctx: RuleContext): Finding[] {
    if (!ctx.designSystem || ctx.designSystem.palette.length === 0) return []
    const design = ctx.designSystem
    const out: Finding[] = []
    const seen = new Set<string>()
    walk(ctx.doc.root, (el) => {
      for (const prop of ['color', 'background-color', 'border-color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color']) {
        const value = colorOf(el, prop, ctx)
        if (!value) continue
        if (/^(transparent|currentcolor|inherit|initial|unset)$/i.test(value)) continue
        if (/gradient/.test(value)) continue
        if (colorInPalette(design, value)) continue
        const key = value.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        out.push(finding(
          'color-outside-design', 'P1', 'layout', pathOf(el), el.line,
          `Color ${value} is not in the documented palette.`,
          value,
          value,
        ))
      }
    })
    for (const css of parseCssBlocks(ctx.doc.styleBlocks)) {
      for (const prop of ['color', 'background-color', 'border-color']) {
        const value = css.declarations[prop]
        if (!value) continue
        if (/^(transparent|currentcolor|inherit|initial|unset)$/i.test(value)) continue
        if (/gradient/.test(value)) continue
        if (colorInPalette(design, value)) continue
        const key = value.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        out.push(finding(
          'color-outside-design', 'P1', 'layout', `style@${css.line}`, css.line,
          `Color ${value} is not in the documented palette.`,
          value,
          value,
        ))
      }
    }
    return out
  },
}

export const radiusOutsideDesignRule: Rule = {
  id: 'radius-outside-design',
  severity: 'P2',
  scope: 'layout',
  description: 'A corner radius falls outside the documented shape scale.',
  check(ctx: RuleContext): Finding[] {
    if (!ctx.designSystem || ctx.designSystem.radii.length === 0) return []
    const design = ctx.designSystem
    const out: Finding[] = []
    walk(ctx.doc.root, (el) => {
      const radius = borderRadiusPx(el, ctx)
      if (radius === null || radius === 0 || radius > 900) return
      if (radiusInScale(design, radius)) return
      out.push(finding(
        'radius-outside-design', 'P2', 'layout', pathOf(el), el.line,
        `Border radius ${radius}px is not in the documented radii scale.`,
        el.rawStyle.slice(0, 70) || el.classes.join(' '),
        String(radius),
      ))
    })
    for (const css of parseCssBlocks(ctx.doc.styleBlocks)) {
      const value = css.declarations['border-radius']
      const radius = value ? parseFloat(value) : NaN
      if (!Number.isFinite(radius) || radius === 0 || radius > 900) continue
      if (radiusInScale(design, radius)) continue
      out.push(finding(
        'radius-outside-design', 'P2', 'layout', `style@${css.line}`, css.line,
        `Border radius ${radius}px is not in the documented radii scale.`,
        css.selector.slice(0, 70),
        String(radius),
      ))
    }
    return out
  },
}

export const fontSizeOutsideDesignRule: Rule = {
  id: 'font-size-outside-design',
  severity: 'P2',
  scope: 'type',
  description: 'A font size falls between (outside) the documented type-scale steps.',
  check(ctx: RuleContext): Finding[] {
    if (!ctx.designSystem || ctx.designSystem.fontSize.length === 0) return []
    const design = ctx.designSystem
    const out: Finding[] = []
    walk(ctx.doc.root, (el) => {
      const size = fontSizePx(el, ctx)
      if (size === null || size === 0) return
      if (fontSizeInScale(design, size)) return
      out.push(finding(
        'font-size-outside-design', 'P2', 'type', pathOf(el), el.line,
        `Font size ${size}px is not a documented type-scale step.`,
        el.rawStyle.slice(0, 70) || el.tag,
        String(size),
      ))
    })
    for (const css of parseCssBlocks(ctx.doc.styleBlocks)) {
      const value = css.declarations['font-size']
      const size = value ? parseFloat(value) : NaN
      if (!Number.isFinite(size) || size === 0) continue
      if (fontSizeInScale(design, size)) continue
      out.push(finding(
        'font-size-outside-design', 'P2', 'type', `style@${css.line}`, css.line,
        `Font size ${size}px is not a documented type-scale step.`,
        css.selector.slice(0, 70),
        String(size),
      ))
    }
    return out
  },
}
