/**
 * Design Audit engine — public API.
 *
 * Deterministic anti-slop / WCAG / quality / design-system-drift lint modelled
 * on the Apache-2.0 Impeccable detector. See README.md in this directory for
 * the rule catalogue, CLI usage, ignore syntax, and DESIGN.md context format.
 */

export * from './types'
export { runAudit, mergeResults } from './engine'
export { CORE_RULES, DRIFT_RULES, ALL_RULES, isDriftRule, ruleById } from './rules'
export { parseHtml, pathOf, textContent, walk, snippet, isHeading } from './parser'
export {
  parseDesignMd, parseDesignJson, designSystemIsEmpty,
  colorInPalette, fontInStack, radiusInScale, fontSizeInScale,
} from './design-context'
export {
  normalizeColor, contrastRatio, contrastRatioFromCss, isReadable,
  relativeLuminance, isPurpleish, hueOf,
} from './contrast'
