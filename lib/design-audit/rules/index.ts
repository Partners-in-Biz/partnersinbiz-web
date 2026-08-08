/**
 * Rule registry — the deterministic Design Audit rule set.
 *
 * 30 core rules (AI-slop tells + WCAG contrast + quality basics) plus 4
 * design-system-drift rules that only activate when a per-client Design
 * Context (DESIGN.md / design.json) is supplied.
 */

import type { Rule } from '../types'
import {
  borderAccentRoundedRule, bounceEasingRule, buzzwordsRule, darkGlowRule,
  emDashOveruseRule, flatTypeHierarchyRule, glassmorphismRule, gradientTextRule,
  iconTileStacksRule, italicSerifHeroRule, kickerEyebrowRule, nestedCardsRule,
  overusedFontsRule, purpleGradientsRule, sideTabBordersRule,
} from './slop'
import {
  brokenImagesRule, contentInvisibleAtRestRule, crampedPaddingRule,
  justifiedTextRule, longLineLengthRule, missingAltRule, missingDocumentLangRule,
  scriptErrorsRule, tightLineHeightRule, unlabeledControlsRule, wideLetterSpacingRule,
} from './quality'
import {
  lowContrastTextRule, skippedHeadingLevelsRule, tinyBodyTextRule,
  undersizedFunctionalTextRule,
} from './a11y'
import {
  colorOutsideDesignRule, fontOutsideDesignRule, fontSizeOutsideDesignRule,
  radiusOutsideDesignRule,
} from './drift'

export const CORE_RULES: Rule[] = [
  // AI-slop tells
  purpleGradientsRule,
  glassmorphismRule,
  gradientTextRule,
  darkGlowRule,
  bounceEasingRule,
  sideTabBordersRule,
  borderAccentRoundedRule,
  nestedCardsRule,
  iconTileStacksRule,
  kickerEyebrowRule,
  italicSerifHeroRule,
  overusedFontsRule,
  flatTypeHierarchyRule,
  emDashOveruseRule,
  buzzwordsRule,
  // Quality basics
  missingDocumentLangRule,
  brokenImagesRule,
  missingAltRule,
  unlabeledControlsRule,
  scriptErrorsRule,
  contentInvisibleAtRestRule,
  crampedPaddingRule,
  longLineLengthRule,
  tightLineHeightRule,
  wideLetterSpacingRule,
  justifiedTextRule,
  // WCAG + a11y
  lowContrastTextRule,
  skippedHeadingLevelsRule,
  tinyBodyTextRule,
  undersizedFunctionalTextRule,
]

export const DRIFT_RULES: Rule[] = [
  fontOutsideDesignRule,
  colorOutsideDesignRule,
  radiusOutsideDesignRule,
  fontSizeOutsideDesignRule,
]

export const ALL_RULES: Rule[] = [...CORE_RULES, ...DRIFT_RULES]

export const DRIFT_RULE_IDS = new Set(DRIFT_RULES.map((r) => r.id))

export function ruleById(id: string): Rule | undefined {
  return ALL_RULES.find((r) => r.id === id)
}

export function isDriftRule(id: string): boolean {
  return DRIFT_RULE_IDS.has(id)
}
