/**
 * Design Audit engine types.
 *
 * Deterministic anti-slop + quality + a11y rule engine for Partners in Biz,
 * modelled on the Apache-2.0 Impeccable detector (impeccable.style).
 */

export type Severity = 'P0' | 'P1' | 'P2' | 'P3'

/** What a rule checks. 'type' = typography / text-level, 'layout' = geometry / surface-level. */
export type RuleScope = 'type' | 'layout' | 'any'

/** CLI / engine narrowing: --scope type|layout runs rules tagged 'any' too. */
export type AuditScope = 'type' | 'layout' | 'all'

export interface Finding {
  /** Rule id, e.g. 'purple-gradients'. */
  rule: string
  severity: Severity
  scope: RuleScope
  /** CSS-ish element path, e.g. `body > main > section:nth-of-type(2) > div.card:nth-of-type(1)`. */
  ref: string
  /** 1-based source line. 0 when unknown (e.g. computed-only checks). */
  line: number
  /** Short human-readable excerpt of the offending source. */
  snippet: string
  message: string
  /** Machine-ignorable value (font name, color, radius…) for ignore-values support. */
  value?: string
}

export interface DesignSystem {
  /** Normalized lowercase hex palette, e.g. ['#0f172a']. */
  palette: string[]
  /** Font family names as documented, e.g. ['Inter', 'Space Grotesk']. */
  fonts: string[]
  /** Documented corner radii in px, e.g. [4, 8, 12]. */
  radii: number[]
  /** Documented type-scale steps in px, e.g. [12, 14, 16, 20, 24, 30]. */
  fontSize: number[]
  source: string
}

export interface IgnoreOptions {
  /** Rule ids to skip entirely (detector.ignoreRules equivalent). */
  rules?: string[]
  /** 'rule:value' or bare-value matches against finding.value (detector.ignoreValues equivalent). */
  values?: string[]
  /** Glob patterns matched against the file name (detector.ignoreFiles equivalent). */
  files?: string[]
  /** Honor inline `impeccable-disable*` comments + `data-impeccable-disable` attributes. Default true. */
  inline?: boolean
}

export interface AuditOptions {
  /** --scope narrowing. Default 'all'. */
  scope?: AuditScope
  ignore?: IgnoreOptions
  /** Parsed DESIGN.md / design.json context. When present, drift rules run. */
  designSystem?: DesignSystem | null
  /** Set false to skip design-system-drift rules even when context exists (--no-design-system). */
  designSystemEnabled?: boolean
  /** File name for ignoreFiles glob matching and reporting. */
  fileName?: string
  /** Browser-mode console errors, e.g. ['TypeError: x is undefined (main.js:12)']. */
  runtimeErrors?: string[]
  /** Browser-mode computed styles keyed by element path, e.g. { 'p:nth-of-type(1)': { 'font-size': '11px' } }. */
  computedStyles?: Record<string, Record<string, string>>
  /** Safety cap per rule to keep pathological pages bounded. Default 50. */
  maxFindingsPerRule?: number
}

export interface AuditSummary {
  total: number
  bySeverity: Record<Severity, number>
  byScope: Partial<Record<RuleScope, number>>
}

export interface AuditResult {
  schema: 'pib-design-audit/v1'
  exitCode: 0 | 1 | 2
  summary: AuditSummary
  findings: Finding[]
  rulesRun: string[]
  rulesIgnored: string[]
  designSystem: { present: boolean; source?: string }
  notes: string[]
  errors: string[]
  durationMs: number
}

export interface RuleContext {
  doc: DocumentNode
  designSystem: DesignSystem | null
  runtimeErrors: string[]
  computedStyles: Record<string, Record<string, string>>
  fileName: string
}

export interface Rule {
  id: string
  severity: Severity
  scope: RuleScope
  description: string
  check: (ctx: RuleContext) => Finding[]
}

/** Minimal tolerant DOM used by the engine (dependency-free; source scanning). */
export interface ElementNode {
  tag: string
  /** Lowercased attribute name -> value (null for boolean attributes). */
  attrs: Record<string, string | null>
  classes: string[]
  /** Parsed inline style map (lowercased props). Empty for JSX object styles. */
  style: Record<string, string>
  rawStyle: string
  /** Direct (non-recursive) text content, entity-decoded. */
  text: string
  children: ElementNode[]
  parent: ElementNode | null
  /** 1-based line of the start tag. */
  line: number
}

export interface StyleBlock {
  css: string
  line: number
}

export interface ScriptBlock {
  js: string
  line: number
}

export interface CommentNode {
  text: string
  line: number
}

export interface DocumentNode {
  root: ElementNode
  comments: CommentNode[]
  styleBlocks: StyleBlock[]
  scriptBlocks: ScriptBlock[]
}
