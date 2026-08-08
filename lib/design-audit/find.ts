import type { Finding, RuleScope, Severity } from './types'

export function finding(
  rule: string,
  severity: Severity,
  scope: RuleScope,
  ref: string,
  line: number,
  message: string,
  snippet: string,
  value?: string,
): Finding {
  return { rule, severity, scope, ref, line, snippet, message, value }
}

/** Regex to extract color tokens (hex, rgb/rgba/hsl/hsla, named) from a CSS value. */
export const COLOR_TOKEN_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|[a-zA-Z]{3,}/g

export function colorsFromCss(value: string): string[] {
  const out: string[] = []
  const matches = value.match(COLOR_TOKEN_RE)
  if (!matches) return out
  for (const m of matches) {
    if (/^(solid|dashed|dotted|none|transparent|currentcolor|inherit|initial|unset|inset|linear-gradient|radial-gradient|conic-gradient|repeating-linear-gradient|repeating-radial-gradient|at|from|to|via|calc|var)$/i.test(m)) continue
    out.push(m)
  }
  return out
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}
