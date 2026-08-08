/**
 * Design Audit engine: runs the rule set over parsed source, applies scope
 * narrowing, inline/attribute/option ignores, groups findings P0-P3, and
 * computes the deterministic exit code (0 clean / 2 findings / 1 failure).
 */

import type { AuditOptions, AuditResult, DocumentNode, Finding, Rule, RuleContext, Severity } from './types'
import { parseHtml, pathOf } from './parser'
import { walkElements } from './style-utils'
import {
  findingIgnored, isFileIgnored,
  lineDisabled, resolveIgnores,
} from './ignores'
import { ALL_RULES, isDriftRule } from './rules'

const SEVERITY_ORDER: Record<Severity, number> = { P0: 0, P1: 1, P2: 2, P3: 3 }

const EMPTY_SUMMARY = (): AuditResult['summary'] => ({
  total: 0,
  bySeverity: { P0: 0, P1: 0, P2: 0, P3: 0 },
  byScope: {},
})

function scopeMatches(rule: Rule, scope: AuditOptions['scope']): boolean {
  if (!scope || scope === 'all') return true
  if (rule.scope === 'any') return true
  return rule.scope === scope
}

function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const sev = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    if (sev !== 0) return sev
    if (a.rule !== b.rule) return a.rule.localeCompare(b.rule)
    if (a.line !== b.line) return a.line - b.line
    return a.ref.localeCompare(b.ref)
  })
}

/**
 * Build the element-attribute ignore map: path -> set of disabled rule ids
 * ('*' = all) from `data-impeccable-disable` on the element or any ancestor.
 */
function buildAttributeIgnoreMap(doc: DocumentNode): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()
  walkElements(doc.root, (el) => {
    const value = el.attrs['data-impeccable-disable']
    if (value === undefined || value === null) return
    const rules = value && value.trim() ? value.split(/[\s,]+/).map((r) => r.trim().toLowerCase()).filter(Boolean) : ['*']
    const stack: Array<typeof el> = [el]
    while (stack.length) {
      const cur = stack.pop()!
      if (cur.tag === '#root') continue
      const key = pathOf(cur)
      const set = map.get(key) ?? new Set<string>()
      for (const r of rules) set.add(r)
      map.set(key, set)
      stack.push(...cur.children)
    }
  })
  return map
}

export function runAudit(source: string, options: AuditOptions = {}): AuditResult {
  const started = Date.now()
  const errors: string[] = []
  const notes: string[] = []
  const fileName = options.fileName ?? '<input>'

  const fileIgnored = isFileIgnored(fileName, options.ignore)
  const doc = parseHtml(source)
  const resolution = resolveIgnores(doc, options.ignore)
  const designSystem = options.designSystemEnabled === false ? null : options.designSystem ?? null
  const attributeIgnores = buildAttributeIgnoreMap(doc)

  const ctx: RuleContext = {
    doc,
    designSystem,
    runtimeErrors: options.runtimeErrors ?? [],
    computedStyles: options.computedStyles ?? {},
    fileName,
  }

  const findings: Finding[] = []
  const rulesRun: string[] = []
  const rulesIgnored: string[] = []
  const maxPerRule = options.maxFindingsPerRule ?? 50

  for (const rule of ALL_RULES) {
    if (!scopeMatches(rule, options.scope)) continue
    if (isDriftRule(rule.id) && !designSystem) {
      rulesIgnored.push(rule.id)
      continue
    }
    if (resolution.ruleIgnored.includes(rule.id) || fileIgnored) {
      rulesIgnored.push(rule.id)
      continue
    }
    rulesRun.push(rule.id)
    let ruleFindings: Finding[]
    try {
      ruleFindings = rule.check(ctx)
    } catch (err) {
      errors.push(`rule ${rule.id}: ${err instanceof Error ? err.message : String(err)}`)
      continue
    }
    const kept: Finding[] = []
    for (const f of ruleFindings) {
      if (findingIgnored(f, resolution, options.ignore)) continue
      const refRules = attributeIgnores.get(f.ref)
      if (refRules && (refRules.has('*') || refRules.has(f.rule.toLowerCase()))) continue
      if (lineDisabled(resolution.directives, f.rule.toLowerCase(), f.line)) continue
      kept.push(f)
    }
    if (kept.length > maxPerRule) {
      notes.push(`rule ${rule.id}: truncated to ${maxPerRule} findings (${kept.length} total)`)
      kept.length = maxPerRule
    }
    findings.push(...kept)
  }

  const sorted = sortFindings(findings)
  const summary = EMPTY_SUMMARY()
  summary.total = sorted.length
  for (const f of sorted) {
    summary.bySeverity[f.severity]++
    summary.byScope[f.scope] = (summary.byScope[f.scope] ?? 0) + 1
  }

  return {
    schema: 'pib-design-audit/v1',
    exitCode: sorted.length ? 2 : 0,
    summary,
    findings: sorted,
    rulesRun,
    rulesIgnored,
    designSystem: { present: !!designSystem, source: designSystem?.source },
    notes,
    errors,
    durationMs: Date.now() - started,
  }
}

/** Merge per-file results into one result (CLI multi-file mode). */
export function mergeResults(results: AuditResult[]): AuditResult {
  const started = Date.now()
  const errors: string[] = []
  const notes: string[] = []
  const findings: Finding[] = []
  const rulesRun = new Set<string>()
  const rulesIgnored = new Set<string>()
  let designPresent = false
  let designSource: string | undefined
  for (const r of results) {
    findings.push(...r.findings)
    for (const id of r.rulesRun) rulesRun.add(id)
    for (const id of r.rulesIgnored) rulesIgnored.add(id)
    errors.push(...r.errors)
    notes.push(...r.notes)
    if (r.designSystem.present) {
      designPresent = true
      designSource = r.designSystem.source
    }
  }
  const sorted = sortFindings(findings)
  const summary = EMPTY_SUMMARY()
  summary.total = sorted.length
  for (const f of sorted) {
    summary.bySeverity[f.severity]++
    summary.byScope[f.scope] = (summary.byScope[f.scope] ?? 0) + 1
  }
  return {
    schema: 'pib-design-audit/v1',
    exitCode: sorted.length ? 2 : 0,
    summary,
    findings: sorted,
    rulesRun: [...rulesRun],
    rulesIgnored: [...rulesIgnored],
    designSystem: { present: designPresent, source: designSource },
    notes,
    errors,
    durationMs: Date.now() - started,
  }
}

/** Re-export the core registry for programmatic callers (T2 audit card). */
export { CORE_RULES, DRIFT_RULES, ALL_RULES, isDriftRule } from './rules'
export { ruleById } from './rules'
